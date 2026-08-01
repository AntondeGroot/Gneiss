import type { FileInfo, ReaddirResult, ReadFileResult } from "@capacitor/filesystem";

import { VaultService } from "./vault.service";

// Hoisted so the mock factory can close over them. Holding the mock functions
// directly, rather than reaching through `Filesystem.readdir`, keeps every
// reference a plain function — a detached method would trip unbound-method.
const { readdir, readFile } = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn() }));

// Stubbed outright rather than spread over the real module: `importOriginal`
// with an inline `typeof import(...)` is sensitive to hoisting order. The service
// only touches these three exports, so naming them keeps the mock honest.
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { readdir, readFile },
  Directory: { Documents: "DOCUMENTS" },
  Encoding: { UTF8: "utf8" },
}));

const VAULT_PATH = "Vault";

function entry(name: string, type: "file" | "directory"): FileInfo {
  return { name, type, size: 0, mtime: 0, uri: `/${name}` };
}

/** Serves a fake vault: folder listings by path, file contents by path. */
function givenVault(folders: Record<string, FileInfo[]>, contents: Record<string, string> = {}) {
  readdir.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve<ReaddirResult>({ files: folders[path] ?? [] }),
  );
  readFile.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve<ReadFileResult>({ data: contents[path] ?? "" }),
  );
}

describe("VaultService", () => {
  let service: VaultService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new VaultService();
  });

  it("never walks into a dotfolder such as .obsidian", async () => {
    givenVault(
      {
        Vault: [entry(".obsidian", "directory"), entry("grep.md", "file")],
        "Vault/.obsidian": [entry("workspace.json", "file"), entry("plugins", "directory")],
      },
      { "Vault/grep.md": "What does grep do? :: search text\n\n#flashcards/shell\n" },
    );

    const notes = await service.readNotes(VAULT_PATH);

    expect(notes.map((note) => note.note)).toEqual(["grep.md"]);
    expect(readdir).not.toHaveBeenCalledWith(expect.objectContaining({ path: "Vault/.obsidian" }));
  });

  it("descends through nested folders, identifying notes by path rather than filename", async () => {
    const card = "Question? :: Answer\n\n#flashcards/lang\n";
    givenVault(
      {
        Vault: [entry("grep.md", "file"), entry("Java", "directory")],
        "Vault/Java": [entry("generics.md", "file"), entry("Streams", "directory")],
        "Vault/Java/Streams": [entry("reduce.md", "file")],
      },
      {
        "Vault/grep.md": card,
        "Vault/Java/generics.md": card,
        "Vault/Java/Streams/reduce.md": card,
      },
    );

    const notes = await service.readNotes(VAULT_PATH);

    expect(notes.map((note) => note.note)).toEqual([
      "grep.md",
      "Java/generics.md",
      "Java/Streams/reduce.md",
    ]);
  });

  it("reads only markdown, whatever the case, and never opens other attachments", async () => {
    const card = "Question? :: Answer\n\n#flashcards/lang\n";
    givenVault(
      {
        Vault: [
          entry("grep.md", "file"),
          entry("README.MD", "file"),
          entry("Mockito_Guide.pdf", "file"),
          entry("diagram.png", "file"),
          entry("board.canvas", "file"),
        ],
      },
      { "Vault/grep.md": card, "Vault/README.MD": card },
    );

    const notes = await service.readNotes(VAULT_PATH);

    expect(notes.map((note) => note.note)).toEqual(["grep.md", "README.MD"]);
    // Not merely filtered from the result — the attachments were never read.
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("parses file contents into cards, carrying existing review state through", async () => {
    givenVault(
      { Vault: [entry("grep.md", "file")] },
      {
        "Vault/grep.md": `What does \`grep -v\` do?
?
Prints only the lines that do NOT match.
<!--SR:!2026-08-21,3,250-->

Case-insensitive search? :: grep -i "pattern" file

#flashcards/shell
#core
`,
      },
    );

    const [note] = await service.readNotes(VAULT_PATH);

    expect(note).toEqual({
      note: "grep.md",
      topicTags: ["#flashcards/shell"],
      tierOverride: "core",
      cards: [
        {
          front: "What does `grep -v` do?",
          back: "Prints only the lines that do NOT match.",
          review: { due: "2026-08-21", interval: 3, ease: 2.5 },
        },
        { front: "Case-insensitive search?", back: 'grep -i "pattern" file' },
      ],
    });
  });

  it("decodes the Blob that readFile hands back on the web platform", async () => {
    givenVault({ Vault: [entry("grep.md", "file")] });
    // Native returns a string; the web implementation returns a Blob instead.
    readFile.mockResolvedValue({
      data: new Blob(["Case-insensitive search? :: grep -i\n\n#flashcards/shell\n"]),
    } satisfies ReadFileResult);

    const [note] = await service.readNotes(VAULT_PATH);

    expect(note?.cards).toEqual([{ front: "Case-insensitive search?", back: "grep -i" }]);
  });
});

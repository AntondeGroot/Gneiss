import { Directory } from "@capacitor/filesystem";
import type { FileInfo, ReaddirResult, ReadFileResult } from "@capacitor/filesystem";

import { VaultService } from "./vault.service";

// Hoisted so the mock factory can close over them. Holding the mock functions
// directly, rather than reaching through `Filesystem.readdir`, keeps every
// reference a plain function — a detached method would trip unbound-method.
const { readdir, readFile } = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn() }));

vi.mock("@capacitor/filesystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capacitor/filesystem")>()),
  Filesystem: { readdir, readFile },
}));

const LOCATION = { path: "Vault", directory: Directory.Documents };

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

    const notes = await service.readNotes(LOCATION);

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

    const notes = await service.readNotes(LOCATION);

    expect(notes.map((note) => note.note)).toEqual([
      "grep.md",
      "Java/generics.md",
      "Java/Streams/reduce.md",
    ]);
  });
});

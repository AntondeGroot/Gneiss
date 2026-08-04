import { DEFAULT_CONFIG } from "../../vault";

const { pick, reopen, readNotes, readFile, writeFile } = vi.hoisted(() => ({
  pick: vi.fn(),
  reopen: vi.fn(),
  readNotes: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({ pick, reopen, readNotes, readFile, writeFile }),
  Capacitor: { getPlatform: () => "android" },
}));

const { AndroidVaultSource } = await import("./android-vault.source");

const VAULT = "content://com.android.externalstorage/tree/primary%3AObsidian";
const NOTE = "What does grep do? :: search text\n\n#flashcards/shell\n";

async function opened() {
  const source = new AndroidVaultSource();
  pick.mockResolvedValue({ uri: VAULT, name: "Obsidian", available: true });
  await source.open("");
  return source;
}

/** Stubbed rather than assumed: the test runner has no DOM storage of its own. */
const store = new Map<string, string>();

describe("AndroidVaultSource", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
  });

  it("reopens a remembered folder instead of prompting again", async () => {
    const source = new AndroidVaultSource();
    reopen.mockResolvedValue({ uri: VAULT, name: "Obsidian", available: true });

    await source.open(VAULT);

    // A prompt nobody asked for is how the wrong folder gets picked.
    expect(reopen).toHaveBeenCalledWith({ uri: VAULT });
    expect(pick).not.toHaveBeenCalled();
  });

  it("says so when a remembered grant has been withdrawn", async () => {
    const source = new AndroidVaultSource();
    reopen.mockResolvedValue({ uri: "", name: "", available: false });

    await expect(source.open(VAULT)).rejects.toThrow(/pick it again/);
  });

  it("remembers the picked folder, so the vault is chosen once", async () => {
    const source = await opened();

    expect(source.remembered()).toBe(VAULT);
    expect(source.vaultName()).toBe("Obsidian");
  });

  it("parses the notes the native walk returns", async () => {
    const source = await opened();
    readNotes.mockResolvedValue({ notes: [{ path: "Shell/grep.md", contents: NOTE }] });

    const notes = await source.readNotes();

    // The path from the walk is the note's identity, subfolders included.
    expect(notes[0]?.note).toBe("Shell/grep.md");
    expect(notes[0]?.cards[0]?.front).toBe("What does grep do?");
  });

  it("falls back to defaults when the vault holds no config yet", async () => {
    const source = await opened();
    readFile.mockResolvedValue({ contents: "", found: false });

    expect(await source.readConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("edits a note by reading it first, so edits made elsewhere survive", async () => {
    const source = await opened();
    readFile.mockResolvedValue({ contents: NOTE, found: true });

    await source.editNote("Shell/grep.md", (md) => md.replace("grep do", "grep really do"));

    // Read-modify-write against the file as it is on disk now, not a cached copy
    // — the vault is shared with Obsidian and changes under the app.
    expect(writeFile).toHaveBeenCalledWith({
      uri: VAULT,
      path: "Shell/grep.md",
      contents: "What does grep really do? :: search text\n\n#flashcards/shell\n",
    });
  });

  it("refuses to touch anything before a folder is open", async () => {
    const source = new AndroidVaultSource();

    await expect(source.readNotes()).rejects.toThrow(/no vault folder is open/);
  });
});

import { DEFAULT_CONFIG } from "../../vault";

const {
  pick,
  reopen,
  readNotes,
  readFile,
  writeFile,
  readAttachment,
  addListener,
  emit,
  emitAttachments,
} = vi.hoisted(() => {
  type NoteHandler = (payload: { notes: { path: string; contents: string }[] }) => void;
  type IndexHandler = (payload: { attachments: Record<string, string> }) => void;

  const handlers: NoteHandler[] = [];
  const indexHandlers: IndexHandler[] = [];

  return {
    pick: vi.fn(),
    reopen: vi.fn(),
    readNotes: vi.fn().mockResolvedValue({ total: 0 }),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readAttachment: vi.fn(),
    addListener: vi.fn((event: string, handler: NoteHandler | IndexHandler) => {
      if (event === "vaultAttachments") indexHandlers.push(handler as IndexHandler);
      else handlers.push(handler as NoteHandler);

      return Promise.resolve({
        remove: () => {
          handlers.splice(0);
          indexHandlers.splice(0);
          return Promise.resolve();
        },
      });
    }),
    /** Stands in for the native walk emitting a batch mid-read. */
    emit: (notes: { path: string; contents: string }[]) => {
      for (const handler of handlers) handler({ notes });
    },
    /** The index the walk sends as soon as it has listed the vault. */
    emitAttachments: (attachments: Record<string, string>) => {
      for (const handler of indexHandlers) handler({ attachments });
    },
  };
});

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    pick,
    reopen,
    readNotes,
    readFile,
    writeFile,
    readAttachment,
    addListener,
  }),
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

// File scope, so every block below starts from clean mocks and empty storage —
// scoped to one describe, the others inherit whichever calls came before.
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

describe("AndroidVaultSource", () => {
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

  it("parses the notes the native walk emits", async () => {
    const source = await opened();
    readNotes.mockImplementation(() => {
      emit([{ path: "Shell/grep.md", contents: NOTE }]);
      return Promise.resolve({ total: 1 });
    });

    const notes = await source.readNotes();

    // The path from the walk is the note's identity, subfolders included.
    expect(notes[0]?.note).toBe("Shell/grep.md");
    expect(notes[0]?.cards[0]?.front).toBe("What does grep do?");
  });

  it("hands over each batch as it arrives rather than only at the end", async () => {
    const source = await opened();
    const seen: number[] = [];
    readNotes.mockImplementation(() => {
      emit([{ path: "a.md", contents: NOTE }]);
      emit([{ path: "b.md", contents: NOTE }]);
      return Promise.resolve({ total: 2 });
    });

    await source.readNotes((batch) => seen.push(batch.length));

    // Two batches, not one delivery of two — this is what stops a large vault
    // showing an empty screen while it reads.
    expect(seen).toEqual([1, 1]);
  });

  it("removes its listener even when the walk fails", async () => {
    const source = await opened();
    readNotes.mockRejectedValueOnce(new Error("grant withdrawn"));
    readNotes.mockResolvedValue({ total: 0 });

    await expect(source.readNotes()).rejects.toThrow(/grant withdrawn/);

    // A listener left behind would double every note on the next read. Two go on
    // per read: one for the notes, one for the attachment index.
    await source.readNotes();
    expect(addListener).toHaveBeenCalledTimes(4);
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

describe("AndroidVaultSource attachments", () => {
  it("can find an image before the notes have finished reading", async () => {
    const source = await opened();
    readNotes.mockImplementation(() => {
      // The index goes out once the vault is listed, long before it is read.
      emitAttachments({ "shot.png": "ProgrammingSync/shot.png" });
      return new Promise((resolve) => setTimeout(() => resolve({ total: 0 }), 20));
    });
    readFile.mockResolvedValue({ contents: "", found: false });
    readAttachment.mockResolvedValue({ dataUrl: "data:image/png;base64,AA", found: true });

    const reading = source.readNotes();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const url = await source.readAttachment("shot.png");
    await reading;

    // Resolved through the index, so the path includes the folder it lives in —
    // looking for a bare name at the vault root is what used to miss.
    expect(readAttachment).toHaveBeenCalledWith({
      uri: VAULT,
      path: "ProgrammingSync/shot.png",
    });
    expect(url).toBe("data:image/png;base64,AA");
  });

  it("hands back an external address without asking the vault", async () => {
    const source = await opened();

    expect(await source.readAttachment("https://example.com/x.png")).toBe(
      "https://example.com/x.png",
    );
    expect(readAttachment).not.toHaveBeenCalled();
  });
});

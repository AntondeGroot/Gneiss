import { DEFAULT_CONFIG } from "../../vault";
import { DeckCacheService } from "./deck-cache.service";
import type { DeckCard } from "./deck.service";

const store = new Map<string, string>();

function card(id: string, due: string): DeckCard {
  return {
    id,
    note: "git.md",
    front: `Q ${id}`,
    back: "A",
    tier: "core",
    topicTags: ["#flashcards/git"],
    review: { due, interval: 5, ease: 2.5 },
  };
}

describe("DeckCacheService", () => {
  let cache: DeckCacheService;

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    cache = new DeckCacheService();
  });

  it("gives back the deck it was handed", () => {
    const config = { ...DEFAULT_CONFIG, spread: 0.4, newPerSession: 3 };
    cache.save("Obsidian", config, [card("a", "2026-08-01")], ["#flashcards/git"]);

    const loaded = cache.load("Obsidian");

    expect(loaded?.cards.map((c) => c.id)).toEqual(["a"]);
    expect(loaded?.topics).toEqual(["#flashcards/git"]);
    // Config round-trips through the same markdown the vault uses.
    expect(loaded?.config.spread).toBe(0.4);
    expect(loaded?.config.newPerSession).toBe(3);
  });

  it("keeps the most overdue cards when the deck is larger than the slice", () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      card(`c${i}`, `2026-${String((i % 12) + 1).padStart(2, "0")}-01`),
    );

    cache.save("Obsidian", DEFAULT_CONFIG, many, []);

    const kept = cache.load("Obsidian")?.cards ?? [];
    // A slice, not the vault — and the slice a session would serve first.
    expect(kept.length).toBeLessThan(many.length);
    expect(kept[0]?.review.due).toBe("2026-01-01");
  });

  it("refuses a deck cached from a different vault", () => {
    cache.save("Obsidian", DEFAULT_CONFIG, [card("a", "2026-08-01")], []);

    // Serving another vault's cards would be worse than a slow start.
    expect(cache.load("SomeOtherVault")).toBeNull();
  });

  it("refuses cards that are missing what the scheduler needs", () => {
    const broken = JSON.stringify({
      vault: "Obsidian",
      config: "",
      topics: [],
      // A card written by an older build, without review state.
      cards: [{ id: "a", note: "git.md", front: "Q", back: "A", tier: "core", topicTags: [] }],
    });
    store.set("gneiss.deck", broken);

    expect(cache.load("Obsidian")).toBeNull();
  });

  it("survives a cache that is not JSON at all", () => {
    store.set("gneiss.deck", "{half-written");

    expect(cache.load("Obsidian")).toBeNull();
  });

  it("stores nothing when the vault cannot be named", () => {
    cache.save("", DEFAULT_CONFIG, [card("a", "2026-08-01")], []);

    expect(store.size).toBe(0);
  });
});

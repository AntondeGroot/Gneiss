# Gneiss

A spaced-repetition flashcard app that builds its deck from an **Obsidian vault**. Cards
are graded **Difficult / Medium / Easy**, and every note resolves to a *tier* that controls
how aggressively its cards resurface.

> **Status:** early prototype. `prototype/gneiss-prototype.jsx` is a clickable single-file React
> prototype — the design and logic reference, not production code. See [`CLAUDE.md`](./CLAUDE.md)
> for the full project context and open questions.

## Why it exists

Standard spaced-repetition systems treat every card equally. But not all knowledge is worth
the same review budget:

- Day-to-day tooling (`grep`, `git`) needs to stay in recall memory — it's used constantly
  and looking it up mid-flow is friction.
- Other knowledge (e.g. Java generics) is worth knowing but cheap to look up, so it doesn't
  deserve the same rehearsal.

Gneiss makes that difference a first-class knob.

## The tier model (the core idea)

Three tiers, applied as a growth multiplier on the review interval:

| Tier       | Example notes            | Behaviour                                   |
| ---------- | ------------------------ | ------------------------------------------- |
| `core`     | `grep.md`, `git.md`      | intervals grow slowly → comes back often    |
| `standard` | `docker.md`, `vim.md`    | normal SM-2-ish pace                        |
| `optional` | `java-generics.md`       | intervals grow fast → drifts out of rotation|

A global **core emphasis** slider (`spread`, 0..1) in Settings controls how far the tiers
diverge. At `spread = 0` every tier behaves identically — a useful sanity check; at `1`, core
resurfaces far sooner than optional. This is the knob behind "grep matters more than Java."

## Assigning tiers

Tier is **not** hand-set per note. It resolves in three steps, first match wins:

1. **Per-note override** — an inline `#core` / `#optional` tag in the note body.
2. **Tag → tier mapping** — a table in Settings mapping an existing `#flashcards/<topic>` tag
   to a tier, longest-prefix match, so `#flashcards/lang/certexam` beats `#flashcards/lang`.
3. **Default** — `standard`.

The mapping is the primary mechanism; per-note tags are for exceptions. Topic tags in a real
vault already cluster the way tiers would be assigned, so one row per topic replaces an edit
per note, touches no notes, and makes tier retunable — passing an exam demotes a whole topic
by changing one row.

Only `#core` and `#optional` exist as note-level tags: **`standard` is the absence of a tag**,
so the common case needs no edit. Both are top-level tags, deliberately not nested under
`#flashcards/` — that namespace is the *topic* axis, tier is an orthogonal *importance* axis,
and the Obsidian SR plugin treats every `#flashcards/` subtag as a separate deck.

**Gneiss never opts a note into the deck.** Tiering applies only to notes already tagged
`#flashcards*`; any other note is left byte-for-byte untouched rather than having a tag
written into it.

## Markdown is the source of truth

Notes are plain Obsidian markdown. The parser (`parseNote`) reads:

- **Inline cards:** `Question :: Answer`
- **Block cards:** a question, then a line containing only `?`, then the answer
  (multi-line answers and fenced code blocks supported)
- **Tier override:** an inline `#core` / `#optional` tag (see [Assigning tiers](#assigning-tiers))
- **Review state:** the SR plugin's `<!--SR:!YYYY-MM-DD,<interval>,<ease>-->` comment after each
  card, so existing history is imported rather than reset

These match the conventions of the existing Obsidian **Spaced Repetition** community plugin, so
real vaults written for it should parse. Setting a per-note tier override in the UI rewrites the
note's **trailing tag block** rather than storing a flag in app state — the markdown stays
authoritative. Vaults written for the SR plugin keep tags in a block at the bottom of the note
and use frontmatter rarely or not at all, so writing frontmatter would impose a convention the
vault doesn't use.

## Screens

- **Today** — due count as a tier-segmented ring, streak, and Start review.
- **Review** — question → Show answer → grade. Each grade button previews when the card will
  next appear, computed live from the current emphasis.
- **Vault** — open a vault folder, then a notes list showing each note's resolved tier; tap a
  note to see its cards parsed live with their review state.
- **Settings** — reminder + time, new-cards-per-day cap, the core-emphasis slider with a
  live interval preview, and a tag→tier table with a row per topic tag in the vault.

## Running the prototype

The prototype runs under Vite:

```bash
npm install
npm run prototype        # dev server at http://localhost:5173
npm run prototype:build  # production build to dist/
```

Note that `npm start` and `npm run build` belong to the **Angular app**, not the prototype —
the prototype's scripts are the `prototype*` ones above. `prototype:build` empties `dist/`,
which deletes the Angular app's `dist/gneiss` output; run `npm run build` again to restore it.

`prototype/gneiss-prototype.jsx` is the single default-exported React component (`Gneiss`) — the
design/logic reference; `prototype/src/main.jsx` is just the Vite entry point that mounts it, and
`index.html` at the repo root loads it. All state lives in memory; nothing persists across reload.

## Planned stack

The production app is a **standalone Angular mobile app** wrapped natively with **Capacitor**,
**local-first with no backend** for v1:

- **Vault content** is read (not owned) from the user's synced Obsidian folder — iCloud Drive /
  Dropbox / Obsidian Sync — via the Capacitor Filesystem API.
- **Review state** (interval / ease / due) is written back into each note as the SR plugin's
  per-card `<!--SR:...-->` comment — it is per *card*, not per note, so frontmatter can't hold it.
  This keeps *markdown the source of truth*, round-trips with the plugin, and makes cross-device
  sync ride on the vault's own sync — no server, no accounts, fully offline.
- **App config** (tag→tier mapping, `spread`, cram state) lives in `.gneiss/config.md` inside the
  vault, so it syncs the same way without being mistaken for a note.
- **Reminders** are on-device (Capacitor Local Notifications), so no push server.

A backend is deferred until there's a real need (syncing review state independently of the vault,
accounts, or server-driven push). See [`CLAUDE.md`](./CLAUDE.md) for the full rationale and the
routes that were rejected.

## Open questions

- **Scheduler** — the current `schedule()` is a hand-rolled SM-2 approximation; consider FSRS
  before real use. The tier multiplier is applied on top, so it should survive the swap.
- **Card identity** — review progress is currently matched on question text, so editing a
  question resets its history. A stable per-card ID would be more robust.
# Gneiss

A spaced-repetition flashcard app that builds its deck from an **Obsidian vault**. Cards
are graded **Difficult / Medium / Easy**, and each note carries a *tier* that controls how
aggressively its cards resurface.

> **Status:** early prototype. `gneiss-prototype.jsx` is a clickable single-file React
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

Three tiers, set per note, applied as a growth multiplier on the review interval:

| Tier       | Example notes            | Behaviour                                   |
| ---------- | ------------------------ | ------------------------------------------- |
| `core`     | `grep.md`, `git.md`      | intervals grow slowly → comes back often    |
| `standard` | `docker.md`, `vim.md`    | normal SM-2-ish pace                        |
| `optional` | `java-generics.md`       | intervals grow fast → drifts out of rotation|

A global **core emphasis** slider (`spread`, 0..1) in Settings controls how far the tiers
diverge. At `spread = 0` every tier behaves identically — a useful sanity check; at `1`, core
resurfaces far sooner than optional. This is the knob behind "grep matters more than Java."

## Markdown is the source of truth

Notes are plain Obsidian markdown. The parser (`parseNote`) reads:

- **Inline cards:** `Question :: Answer`
- **Block cards:** a question, then a line containing only `?`, then the answer
  (multi-line answers and fenced code blocks supported)
- **Tier:** `tier: core` in YAML frontmatter, or an inline `#core` / `#standard` / `#optional` tag

These match the conventions of the existing Obsidian **Spaced Repetition** community plugin, so
real vaults written for it should parse. Changing a note's tier in the UI rewrites the note's
frontmatter rather than storing a flag in app state — the markdown stays authoritative.

## Screens

- **Today** — due count as a tier-segmented ring, streak, and Start review.
- **Review** — question → Show answer → grade. Each grade button previews when the card will
  next appear, computed live from the current emphasis.
- **Vault** — notes list with per-note tier buttons; tap a note to edit its raw markdown and
  see cards parsed live.
- **Settings** — reminder + time, new-cards-per-day cap, and the core-emphasis slider with a
  live interval preview.

## Running the prototype

`gneiss-prototype.jsx` is a single default-exported React component (`Gneiss`). It has no build
tooling of its own yet — drop it into any React 18+ sandbox (Vite, CodeSandbox, etc.) and render
`<Gneiss />`. All state lives in memory; nothing persists across reload.

## Open questions

Decided in [`CLAUDE.md`](./CLAUDE.md); the big unresolved ones:

- **Vault access on mobile** — the requirement is reading Obsidian notes *on a phone*. Leading
  option is an Obsidian plugin (direct `vault.read()` access, no sync plumbing) over a
  standalone app on a synced folder. This decides the whole stack and must be settled before
  production code.
- **Scheduler** — the current `schedule()` is a hand-rolled SM-2 approximation; consider FSRS
  before real use. The tier multiplier is applied on top, so it should survive the swap.
- **Card identity** — review progress is currently matched on question text, so editing a
  question resets its history. A stable per-card ID would be more robust.
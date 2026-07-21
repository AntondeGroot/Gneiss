# Gneiss — project context

A spaced-repetition flashcard app that builds its deck from an Obsidian vault.
Cards are graded **Difficult / Medium / Easy**, and each note carries a *tier* that
controls how aggressively its cards resurface.

`gneiss-prototype.jsx` is a clickable single-file React prototype — the design and
logic reference, not production code. Everything below is decided; anything marked
**OPEN** is not.

---

## Why it exists

Day-to-day tooling knowledge (`grep`, `git`) needs to stay in recall memory — it's
used constantly and looking it up mid-flow is friction. Other knowledge (e.g. Java
generics) is worth knowing but cheap to look up, so it doesn't deserve the same
review budget. Standard SRS treats all cards equally; this app doesn't.

## The tier model (the core idea)

Three tiers, set per note:

| Tier | Example notes | Behaviour |
|---|---|---|
| `core` | grep.md, git.md | intervals grow slowly → comes back often |
| `standard` | docker.md, vim.md | normal SM-2-ish pace |
| `optional` | java-generics.md | intervals grow fast → drifts out of rotation |

Implemented as a growth multiplier on the interval, driven by a global
**core emphasis** slider (`spread`, 0..1) in Settings:

```js
tierGrowth(tier, spread):
  standard → 1.0
  core     → 1 - 0.45 * spread   // 1.0 (flat) … 0.55 (aggressive)
  optional → 1 + 0.80 * spread   // 1.0 (flat) … 1.80
```

`spread = 0` makes all tiers behave identically — a useful sanity check.

Scheduling itself is deliberately simple (see `schedule()`): ease starts at 2.3,
Difficult resets interval to 1 and drops ease, Medium multiplies by `ease * growth`,
Easy multiplies harder. **OPEN:** this is a hand-rolled approximation. Consider
swapping in FSRS before real use — the tier multiplier should survive that change
since it's applied on top of whatever the scheduler returns.

## Markdown is the source of truth

`parseNote(md, filename)` is a pure function with no app dependencies — it's meant to
be lifted straight out into the real implementation. It reads:

- **Inline cards:** `Question :: Answer`
- **Block cards:** a question, then a line containing only `?`, then the answer
  (multi-line answers supported; fenced code blocks are passed through intact)
- **Tier:** `tier: core` in YAML frontmatter, or an inline `#core` / `#standard` /
  `#optional` tag

These match the conventions of the existing Obsidian "Spaced Repetition" community
plugin, so real vaults written for it should parse.

Changing a note's tier in the UI **rewrites the note's frontmatter** (`withTier()`)
rather than storing a flag in app state — the markdown stays authoritative.

`reconcileNote()` re-parses a note after an edit and preserves review progress for
cards whose *question text* is unchanged. **OPEN:** matching on question text means
editing a question resets its history. A stable per-card ID in the note
(e.g. an appended `^cardid` block ref, which is what the Obsidian SR plugin does)
would be more robust.

## Screens

- **Today** — due count as a tier-segmented ring, streak, Start review. Gear icon
  (top right) → Settings.
- **Review** — question → Show answer → grade. Each grade button previews when the
  card will next appear, computed live from the current `spread`.
- **Vault** — notes list with per-note tier buttons. Tap a note to open an editor
  showing raw markdown above and live-parsed cards below.
- **Settings** — reminder + time, new-cards-per-day cap, core emphasis slider with
  a live preview of resulting intervals.

Navigation: bottom tab bar has only Today and Vault. Settings is intentionally
*not* a tab — it's config touched monthly, and the bar's slots are reserved for the
daily loop. Review and Settings both hide the tab bar.

## The unresolved question: vault access on mobile

The requirement is that it reads Obsidian notes **on a phone**. Three routes:

1. **Obsidian plugin** *(recommended)* — Obsidian runs on iOS/Android, plugins get
   direct vault access via `vault.read()` / `TFile`, no sync plumbing. Cost: you live
   inside Obsidian's plugin API and UI constraints. Prior art: the community
   Spaced Repetition plugin.
2. **Standalone app over a synced folder** — iCloud Drive / Dropbox / Obsidian Sync.
   Full control of the experience; inherits sync-conflict handling and fiddly iOS
   file permissions.
3. **Local REST API plugin** — desktop only. Fails the mobile requirement.

**OPEN — decide this before writing production code**, it determines the whole stack.

## Prototype-only shortcuts

- `due` is an integer day offset, not a real date. Real version needs timestamps.
- All state is in React memory; nothing persists across reload.
- The vault is five hardcoded markdown strings in `SEED`.
- Streak is a plain counter with no date logic.

## Next steps discussed

- **Format detection** — sample a real vault and adapt, since existing notes are
  unlikely to already use `::` / `?` conventions.
- **Cloze deletions** — `the {{c1::--staged}} flag unstages`, common in dev notes.
- Adaptive daily mix (how much core vs. optional to serve per session).

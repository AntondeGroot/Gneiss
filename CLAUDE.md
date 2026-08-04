# Gneiss — project context

A spaced-repetition flashcard app that builds its deck from an Obsidian vault.
Cards are graded **Difficult / Medium / Easy**, and each note carries a *tier* that
controls how aggressively its cards resurface.

`prototype/gneiss-prototype.jsx` is a clickable single-file React prototype — the design and
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

## Assigning tiers (DECIDED)

Tier is **not** hand-set per note. It resolves in three steps, first match wins:

1. **Per-note override** — an inline `#core` / `#optional` tag in the note body.
2. **Tag → tier mapping** — a table in Settings mapping an existing `#flashcards/<topic>`
   tag to a tier. Longest-prefix match, so `#flashcards/Java/OCP` beats `#flashcards/Java`.
3. **Default** — `standard`.

The mapping is the primary mechanism; per-note tags are for exceptions. Rationale: topic
tags in a real vault already cluster the way tiers would be assigned, so a table with a
row per topic replaces an edit per note, touches no notes, and matches how the material
is actually thought about. It also makes tier **retunable** — passing an exam demotes a
whole topic by changing one row.

Shape of the mapping:

```
#flashcards/git           → core       # used daily, lookup mid-flow is friction
#flashcards/shell         → core
#flashcards/lang          → standard
#flashcards/lang/certexam → standard   # crammed before the exam, retained after
```

**OPEN:** `optional`'s lifecycle is undecided and deliberately parked. It is currently a
one-way trapdoor — material demoted to `optional` drifts out of rotation and nothing ever
asks whether that was right. Whether Gneiss should prompt to revisit a long-dormant topic,
and whether topics should ever be retired outright, is unresolved. `exam` was considered as
a fourth tier and **rejected**: a tier's job is to produce one interval multiplier, and an
exam tier's would be 1.0 — identical to `standard`. Exam-ness is a deadline, which cram
mode already models, not a distinct long-term pace.

**Gneiss never opts a note into the deck.** Tiering only applies to notes the user has
already tagged `#flashcards*`; `withTier()` leaves any other note byte-for-byte untouched
rather than writing a tag into a note the app doesn't own. A note holding cards but no
`#flashcards` tag is surfaced in the Vault screen as a gap for the user to resolve, not
silently adopted.

Only `#core` and `#optional` exist as note-level tags — **`standard` is the absence of a
tag**, so the common case needs no edit. Both are **top-level tags, deliberately not
nested** under `#flashcards/`: that namespace is the *topic* axis, tier is an orthogonal
*importance* axis, and the Obsidian SR plugin treats every `#flashcards/` subtag as a
separate deck — `#flashcards/core` would spawn a junk deck in the plugin the vault may
still be used with.

## Cram mode (DECIDED)

Temporary, deadline-scoped focus on one topic — e.g. the weeks before an exam.

**Cram is app state, not vault state.** Tier is a durable property of *the material*;
cram is a transient property of *the user*. Different lifetimes, different storage. A
rejected alternative was find-and-replacing a tag (`#exam` → `#examcram`) to mark focus:
it bakes transient state into permanent files, requires an inverse edit that depends on
human discipline to remember, silently moves notes between SR-plugin decks, and destroys
the original tag. No new tag is needed anyway — an exam's scope is typically *already* its
own topic tag; cram just points at an existing tag.

Cram mode is **a tag plus an exam date**, applied as a clamp on top of whatever the
scheduler returns — the same shape as `tierGrowth`, and likewise expected to survive an
FSRS swap:

```js
function cramClamp(interval, tag, cram, today) {
  if (!cram.active || !tag.startsWith(cram.scope)) return interval
  const daysLeft = cram.examDate - today
  if (daysLeft <= 0) return interval          // expired → falls back to tier
  return Math.min(interval, Math.max(1, Math.floor(daysLeft * 0.4)))
}
```

Two properties are why the date is part of the design:

- **Focus intensifies on its own.** Nothing can schedule past the exam, so intervals
  compress automatically as the date nears — no separate "intensity" knob.
- **The exam date is the off-switch.** The day after, the clamp stops applying and the
  topic reverts to its mapped tier, with **no manual reset step**. Note that this tier is
  normally `standard` or `core`: sitting an exam is evidence the material matters, so
  passing it is not a reason to discard the knowledge. Cram supplies urgency before a
  deadline; it does not change what the material is worth afterwards.

While cram is active, its scope also overrides the new-cards-per-session portion, and the Today
screen leads with `<topic> · 12 days · 34 due` instead of the normal tier ring.

### Report the pace, never ration the cards (DECIDED)

**Gneiss does not withhold cards.** An earlier version of this design held back unseen cards
once the exam was too close to learn them properly. That was **rejected**: withholding treats
the learner as the problem, when the app's actual job is to say what the deadline costs per
day and let them decide. A pace that is too slow is *reported*, not enforced.

So a cram carries its own **pace** (`cram.perSession`) — the intensity knob, gentle to
intensive — which replaces the ordinary `newPerSession` portion for its topic. It is a portion
for one sitting, not a wall: nothing stops starting another session, so anything not reached
now is simply next in line rather than withheld.

Today then shows, for the crammed topic:

- a **progress bar and percentage** — cards *met at least once*, out of the topic's total
- the **pace the deadline demands**, and whether the chosen one still gets there:
  `One session of 3 a day will not finish 60 in time. You need 10 a day — raise the pace in
  Settings, or sit more than one session.`

Note the two figures are in different units: `requiredPerDay` is genuinely per day, while
`targetPerSession` is per sitting. `onTrack` compares them, which **assumes one session a
day** — and that assumption is why falling behind has two cures, both offered in the copy.

Progress counts cards **met**, not passes completed, because that is what the vault can
actually tell us: the SR comment stores `due,interval,ease` and no tally of passes. Inventing
one would break round-trip with the Obsidian plugin, which is a core constraint.

### The clamp cannot make a card learnable (DECIDED)

Learning needs repetition, so a card first met the day before an exam is not learned — it is
merely seen. **The clamp cannot fix this, and tuning `RUNWAY_FRACTION` is the wrong lever.**
Tracing exposure counts shows why: the clamp already bottoms out at a one-day interval near
the deadline, so a card introduced with one day left gets exactly one look no matter what
fraction is used. Exposure count is dominated by *when a card is first introduced*, not by
how the interval is capped.

| Card first seen | 0.4 runway | guarantee-3 | guarantee-4 |
|---|---|---|---|
| 10 days out | 6 exposures | 6 | 7 |
| 3 days out | 3 | 3 | 3 |
| 1 day out | **1** | **1** | **1** |

This is why `cramMinPasses` exists, but note what it is *not* used for: it withholds nothing.
It sets how late a card can still be **usefully started**, which is what makes the required
pace honest. `cramPlan` counts only `daysLeft - minPasses + 2` days as available for new
material — treating the final days as usable would quietly understate how much there is to do
each day, which is precisely the number the user is relying on.

`cramMinPasses` is **configurable in Settings** (default 3) and lives at the top level of
`.gneiss/config.md`, not inside the `cram:` block: how much repetition you need to learn
something is a property of *you*, and outlives any single exam. `cram.perSession` sits inside the
block instead, because the intensity you pick is a property of *that exam*.

**OPEN:** `reviewsPerSession` is untouched by cram, so a crammed topic's cards already in rotation
still compete for the ordinary review ceiling. Only the *new*-card ceiling is replaced.

**RESOLVED:** "start another session to practise more" is the escape hatch that makes the pace
a target rather than a wall, and the Review screen now offers it — finishing a session re-reads
what is due and offers **Another session** whenever more is ready. See *Importing existing SR
state* for why this needed almost no machinery: the cap was never a daily lockout.

**Where cram state lives:** a `.gneiss/config.md` file *inside the vault*, alongside the
tag→tier mapping and `spread`. It is app config, not note content, so it stays out of the
notes — but putting it in the vault means it rides the existing vault sync for free,
preserving the no-backend decision. Without this, config set on the laptop never reaches
the phone.

## Markdown is the source of truth

`parseNote(md, filename)` is a pure function with no app dependencies — it's meant to
be lifted straight out into the real implementation. It reads:

- **Inline cards:** `Question :: Answer`
- **Block cards:** a question, then a line containing only `?`, then the answer
  (multi-line answers supported; fenced code blocks are passed through intact)
- **Tier:** an inline `#core` / `#optional` tag (see *Assigning tiers* above; the
  prototype also accepts `tier: core` frontmatter, but tags are the supported path —
  see *Vault conventions this assumes* below)

These match the conventions of the existing Obsidian "Spaced Repetition" community
plugin, so real vaults written for it should parse.

Setting a per-note tier override in the UI **rewrites the note's tag block**
(`withTier()`) rather than storing a flag in app state — the markdown stays
authoritative. **CORRECTED:** this previously specified rewriting YAML frontmatter.
Vaults written for the SR plugin typically keep tags in a block at the *bottom* of the
note and use frontmatter rarely or not at all, so writing frontmatter would impose a
convention the vault doesn't use. `withTier()` edits the trailing tag block, and
creates one if absent.

`reconcileNote()` re-parses a note after an edit and preserves review progress for
cards whose *question text* is unchanged. **OPEN:** matching on question text means
editing a question resets its history. A stable per-card ID in the note
(e.g. an appended `^cardid` block ref, which is what the Obsidian SR plugin does)
would be more robust.

## Vault conventions this assumes

These come from surveying an existing SR-plugin vault and are what the decisions above
rest on. No real vault data lives in this repo — the prototype's `SEED` is invented.

- **The block card format is already in use.** Question / bare `?` / multi-line answer,
  with fenced code passed through, is what SR-plugin users actually write — so
  `parseNote()` needs no format migration. This retires the earlier worry that existing
  notes were "unlikely to already use `::` / `?`".
- **Tags sit in a block at the bottom of the note, not in frontmatter.** Frontmatter is
  rare to absent. This is what drives the tag-based tier decision above.
- **Topic tags are hierarchical** (`#flashcards/<topic>/<subtopic>`), which makes them the
  natural key for the tag→tier mapping, with longest-prefix match.
- **Review state already exists**, as an SR-plugin HTML comment after each card:
  `<!--SR:!YYYY-MM-DD,<interval>,<ease>-->`. Import it rather than resetting it.
- **Expect two data-hygiene gaps**, and surface them in the Vault screen rather than
  silently skipping: notes containing cards but carrying no `#flashcards` tag (invisible
  to the deck), and tagged notes containing zero cards (tagged as intent, never filled in).
- **A vault may be stale.** Stored due dates can predate first run by years, so a naive
  import makes the whole deck overdue at once — see *Next steps*.

## Screens

- **Today** — due count as a tier-segmented ring, streak, Start review. Gear icon
  (top right) → Settings.
- **Review** — question → Show answer → grade. Each grade button previews when the
  card will next appear, computed live from the current `spread`.
- **Vault** — notes list with per-note tier buttons. Tap a note to open an editor
  showing raw markdown above and live-parsed cards below.
- **Settings** — reminder + time, new-cards-per-session portion, core emphasis slider with
  a live preview of resulting intervals, and the tag→tier table: a row per topic tag
  found in the vault, each offering **Inherit / Core / Standard / Optional**. Inherit is
  a fourth state, not a synonym for `standard` — clearing a row lets a subtopic fall back
  to its parent, whereas an explicit `standard` row *overrides* a parent mapped to `core`.
  Rows also appear for mapped tags the vault no longer carries, so a stale rule can be
  cleared rather than silently applying with nothing in the table to remove it. Saving
  re-tiers the loaded deck, so an edit bites on the current session and not just the next
  load.

Navigation: bottom tab bar has **Today, Vault and Settings**. Only Review hides it —
nothing should compete with the card being recalled.

**CHANGED:** Settings was originally kept *out* of the tab bar, on the reasoning that
it is config touched monthly and the slots belonged to the daily loop. Reversed in
use: with only two tabs the bar looked sparse, and reaching Settings through a corner
link on Today was less discoverable than the argument assumed. Three tabs still leaves
the bar uncrowded. The Today header link and the Settings back link were both dropped
as duplicates once the tab existed.

## Stack decision (DECIDED)

Target is a **standalone Angular mobile app**, wrapped natively with **Capacitor**
(Angular is web-only; Capacitor gives the native iOS/Android shell and file access).

**Local-first, no backend for v1.** The app has only two kinds of state:

1. **Vault content** — the markdown notes. Already live in Obsidian and sync via the
   user's existing mechanism (iCloud Drive / Dropbox / Obsidian Sync). Gneiss only *reads*
   them, via the Capacitor Filesystem API over the synced folder.
2. **Review state** — per-card interval / ease / due. **Written back into each note**, the
   same way the Obsidian SR plugin does. This keeps *markdown the source of truth* (already
   a core principle above) and makes cross-device sync **free** — the vault's own sync
   carries the scheduling data too. No server, no accounts, fully offline.
   **CORRECTED:** this previously said "YAML frontmatter", which can't work — review state
   is *per card*, not per note. The SR plugin writes an HTML comment after each card
   (`<!--SR:!YYYY-MM-DD,<interval>,<ease>-->`), and real vaults already contain these.
   Match that format: it round-trips with the plugin and preserves existing history.

App config (tag→tier mapping, `spread`, cram state) is a third kind of state and lives in
`.gneiss/config.md` in the vault — see *Cram mode*.

Reminders are **on-device** (Capacitor Local Notifications) — no push server.

### Native build setup

`capacitor.config.ts` points `webDir` at `dist/gneiss/browser`, so the Angular app must
be built before syncing. `npm run cap:sync` does both; `cap:android` / `cap:ios` sync and
then open the native IDE.

**`npm run android:install` builds and installs onto a connected phone** — sync, Gradle, adb,
in that order. Each step has a quiet failure the script exists to prevent: skipping `cap:sync`
packages the *previous* web bundle, so a fix appears not to work; Gradle picks the newest JDK
and fails on class file version, which reads as a project problem rather than a toolchain one;
and adb is not on the PATH, while an attached phone can still be `unauthorized`. It checks for
a usable device *before* building, so a missing phone costs a second rather than a full Gradle
run, and takes `--skip-build` to reinstall the existing APK.

- **Android needs JDK 21**, not the newest installed JDK. Gradle 8.14.3 (what the Capacitor
  template ships) cannot read class file major version 69+, so a default `JAVA_HOME` of
  JDK 25/26 fails at settings evaluation with *"Unsupported class file major version"*.
  Run Gradle with `JAVA_HOME=$(/usr/libexec/java_home -v 21)`, or set `org.gradle.java.home`
  in `~/.gradle/gradle.properties` — user-level, so no machine-specific path is committed.
- **iOS needs full Xcode plus CocoaPods**, not just the Command Line Tools. The platform is
  not added yet for that reason.

### Reading the vault on Android (DECIDED)

The hard part named above, now built. `Directory.Documents` in Capacitor's Filesystem maps to
`Environment.getExternalStoragePublicDirectory(DIRECTORY_DOCUMENTS)` — real shared storage, not
an app sandbox — but since Android 11 an app cannot read it without a grant, and the app's
manifest carries only `INTERNET`. So on a phone, "Read vault" against a path returns nothing.

Two ways out, and **the folder picker won**:

| | Storage Access Framework | `MANAGE_EXTERNAL_STORAGE` |
|---|---|---|
| Permission | none; one folder, chosen by the user | "All files access" |
| Play Store | fine | restricted to file managers |
| Cost | a native plugin — Capacitor cannot read tree URIs | one manifest line |

**Rejected:** all-files access. It would have worked unchanged with `VaultService`, but it
asks for the whole device to read one folder, and closes the door on ever shipping to Play.

`VaultAccessPlugin.kt` implements the picker half in Kotlin: `pick` (folder chooser, with the
grant persisted so the vault is chosen once, not daily), `reopen`, `readNotes`, `readFile`,
`writeFile`. Two details in there are load-bearing:

- **The walk uses a `DocumentsContract` cursor, not `DocumentFile`.** `DocumentFile.listFiles()`
  issues a query per entry, which turns a real vault into a long wait.
- **`readNotes` returns every note in one call.** Each hop across the bridge costs, and a
  listing followed by a read per file would pay that hundreds of times.

`AndroidVaultSource` is the TypeScript half, and is just another `VaultSource` — the same
"pick your vault once" bargain `BrowserVaultSource` already strikes with the File System
Access API, which is why the screens needed almost no change.

**Adding Kotlin to the app module** meant `ext.kotlin_version` in `android/build.gradle` and
`apply plugin: 'kotlin-android'` in `android/app/build.gradle`. The version matches what the
Capacitor plugins already build against, so the build does not pull two Kotlin toolchains.
`MainActivity` registers the plugin **before** `super.onCreate`, which is when the bridge
builds its registry — after is too late and the call fails at runtime.

**OPEN:** iOS needs its own source. The document picker gives security-scoped bookmarks, which
is the same shape again, so `VaultSource` should absorb it without changing.

### Reading a vault streams (DECIDED)

`readNotes(onBatch?)` hands notes over **as they are found**, rather than resolving once with
the lot. On a phone a real vault takes long enough that a screen showing nothing reads as a
hang — the app looked stuck while it was working perfectly.

The contract: every note reaches `onBatch` exactly once, the batches together are the whole
vault, and the resolved array is the same set for callers that would rather wait. `DeckService`
appends each batch, so **cards become reviewable while the rest is still loading**, and exposes
`reading` so the Vault screen can count up instead of sitting still.

All three sources stream, since all three walk a tree:

- **Android** emits a `vaultNotes` event per batch from the native walk. Batched at 25, not one
  event per note: each bridge hop costs, and a few hundred single-note events would spend more
  time crossing than reading.
- **Browser** emits as its directory walk descends.
- **Device** reads in batches instead of one `Promise.all` over every path.

Note the Android listener is attached *after* the open-vault check and removed in a `finally` —
a listener left behind by a failed walk would double every note on the next read.
- `android/` and `ios/` are generated and hold a copy of the built web bundle, so both are
  excluded from lint and formatting.

### The trade this accepts

This is route 2 below. It deliberately gives up the *easiest* vault access (route 1, the
Obsidian plugin) in exchange for a fully branded, standalone experience. The cost is the
hard part: reading a synced folder on iOS/Android (Capacitor Filesystem + iOS's
document-picker / permission model, plus sync-conflict handling). Accepted knowingly.

### Routes considered

1. **Obsidian plugin** — direct vault access via `vault.read()` / `TFile`, no sync plumbing.
   **Rejected:** a plugin can't be Angular; it lives inside Obsidian's plugin API and UI.
2. **Standalone app over a synced folder** — **CHOSEN.** Full control of the experience.
3. **Local REST API plugin** — desktop only. Fails the mobile requirement.

### When a backend would later be justified (not v1)

- Syncing review state across devices *without* relying on the user's vault sync.
- Accounts / cross-user features.
- Server-driven push notifications (vs. on-device local reminders).

## Prototype-only shortcuts

- `due` is an integer day offset, not a real date. Real version needs timestamps.
- All state is in React memory; nothing persists across reload.
- The vault is five hardcoded markdown strings in `SEED`.
- Streak is a plain counter with no date logic.

## Images on cards (OPEN, not built)

Anticipated, and the current design accommodates it — recorded so the constraints aren't
rediscovered later.

Obsidian embeds images as `![[diagram.png]]` (wikilink) or `![alt](assets/diagram.png)`
(standard markdown). Both are plain text inside a card's answer, and `parseNote` already
passes them through untouched, the same way it passes through fenced code. So a card
*carries* an image reference today; only rendering is missing.

`VaultService` deliberately does **not** read non-markdown files during the walk, and that
stays right once images are supported: an image should load when the card referencing it is
shown, not by pulling every attachment in the vault through the filesystem bridge at
startup. Eager reading would be the bug, not the fix.

Two things are needed to actually display one:

- **Rewrite embeds into loadable URLs** at render time, via `Capacitor.convertFileSrc(uri)`.
  It hands the webview a native file path directly — no base64, and the bytes never enter
  JS memory.
- **Resolve the attachment path.** `![[diagram.png]]` names a file without saying where it
  is; Obsidian resolves it by searching the whole vault. That needs a map of
  attachment filename → path.

**The one decision with a cost attached:** that map is cheapest to build during the
directory walk that already exists, since every listing is read there anyway. Collecting it
later means either a second full traversal or reworking the walk. Deferred deliberately —
the walk is small and well covered, so adding a second return value to `readNotes` is a
contained change when it's actually needed.

## Next steps discussed

- ~~**Format detection**~~ — **RESOLVED**, see *Vault conventions this assumes*: real
  notes already use the block `?` format, so no migration is needed.
- ~~**Importing existing SR state**~~ — **RESOLVED.** `<!--SR:...-->` comments parse on
  read, and the years-old-backlog problem is handled by `selectDue()` rather than by
  rewriting due dates.

  **Nothing is rescheduled.** A card scheduled in 2024 genuinely is overdue, and moving
  its date would be Gneiss lying about the user's own data — and would mean writing to
  every note on first run. Instead a *session* is portioned: `reviewsPerSession` for cards
  in rotation, `newPerSession` for unseen ones, counted separately so a backlog cannot eat
  the sitting's new material. The Today screen says how much is beyond the portion rather
  than hiding it.

  **CORRECTED:** this previously said "the backlog drains a day at a time", which is not
  what the code does and was never what it did. `selectDue` caps *the queue in view at
  any moment*, not the day — grading a card schedules it forward, so it leaves the due
  set and the next one slides into the cap. Measured on a 100-card backlog with
  `reviewsPerSession: 30`, all 100 can be graded in one sitting.

  That behaviour is **kept, and now made explicit** rather than closed off, because it is
  the same principle as *Report the pace, never ration the cards*: a daily figure is a
  sensible default portion, not a lockout. The Review screen offers **Another session**
  when more is ready, and both screens call the figure a portion rather than a limit.

  **RESOLVED:** these were once `reviewsPerDay` / `newPerDay` / `cram.perDay`, which was
  simply wrong — they size a session, not a day. Renamed to `reviewsPerSession` /
  `newPerSession` / `cram.perSession`, with **no back-compatibility shim**: the app has no
  users yet, so the config format is written as intended rather than carrying a fallback for
  files nobody has. Once it ships, renaming a key in `.gneiss/config.md` stops being free —
  the file lives in the user's own vault, so a silent reset would be Gneiss losing their
  settings.

  Ordering happens **before** the cap — core tier first, then longest-overdue first —
  otherwise the cap keeps an arbitrary slice and the cards that matter never surface.
- **Cloze deletions** — `the {{c1::--staged}} flag unstages`, common in dev notes.
- Adaptive daily mix (how much core vs. optional to serve per session).
- **OPEN:** whether cram mode should also be able to *promote* rather than only clamp —
  i.e. pull a crammed topic's cards forward past their due date, not just cap the interval.

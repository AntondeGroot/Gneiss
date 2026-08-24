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

**Gneiss never opts a note into the deck.** Only notes tagged `#flashcards*` produce cards,
and `withTier()` leaves any other note byte-for-byte untouched rather than writing a tag into
a note the app doesn't own.

**CORRECTED:** this was stated as a principle but never enforced. `isFlashcardNote` existed and
was only called by `withTier`, so *every* markdown file holding a `::` or a bare `?` became
cards — and removing a `#flashcards` tag in Obsidian changed nothing, because the tag was never
what put the cards there. `DeckService` now filters to tagged notes, which makes the tag mean
what it says in both directions: adding it opts a note in, removing it takes the cards out. A note holding cards but no
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
screen leads with `<topic> · 12 days · 34 due` instead of the normal tier ring — one such line
per running exam, soonest first, so an exam week reads as the week it is.

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

### Several exams at once (DECIDED)

An exam week is the ordinary case, not the exotic one, so `crams` is a **list**, not a single
block. Two exams may fall on the same day, and their scopes may overlap.

Where two apply to the same card, **the earlier deadline governs**. This needs no precedence
rule of its own — the card has to be ready for the first exam that asks for it, so taking the
tightest clamp is only what the dates already say. When that exam is sat, the next one takes
over on its own, the same way a single cram already expires.

Each exam keeps **its own `perSession` portion of new cards**, served side by side rather than
pooled: pooling would let a distant exam eat the runway of one that is days away, or the
reverse. A card two exams share is served against the sooner one only, so shared material is
not dealt twice in a sitting — but it is *counted* in both progress bars, because it genuinely
is part of both, and the two required paces are therefore not additive.

**Deleting replaces the on/off switch.** With a list, an exam that is off is just an exam that
is not there, so `CramState.active` is gone. Sitting the exam still ends it without any action;
deletion is for the one cancelled, moved, or typed in by mistake.

### An exam is made in a dialog, and checked before it counts (DECIDED)

Adding or editing an exam opens a **dialog**, not a row of fields in the list. An exam typed
straight into a list fails quietly, in ways found out about weeks later by not being ready: a
scope with a typo clamps nothing, and an entry without a date is dropped on the next read. So
the three questions are asked together, somewhere they can be checked before anything is written:

- **The scope must be one the vault answers to**, tested with the same `isWithinScope` the
  clamp uses — so "valid here" and "clamps something there" cannot disagree. Free text rather
  than a picker, because a parent like `#flashcards/Java` is exactly how one exam covers its
  subtopics, and no note carries that tag.
- **The date must be at least a day away.** One today or past parses, saves and clamps nothing,
  since the day after is the off-switch — so the dialog is the only place that can catch it.
- **The tag is taken on trust when the vault has not been read.** There is nothing to check it
  against, and refusing then would block an exam over the app's own state, not a mistake.

The vault's tags are offered under the field, filtered by the segment being typed, so `vi` finds
`#flashcards/vim` without retyping the prefix every tag shares. **In the panel's own flow, not a
floating dropdown** — a `datalist` lands on top of the phone's keyboard, over the very field
being typed into. Empty fields say nothing until Add is pressed, and while matches are on offer
the scope holds its tongue too: being mid-way through typing a tag is not yet a mistake. Wrong
content, with nothing to suggest, says so as it is typed. Creating and editing are the **same**
dialog — the same three fields, and a second near-identical form would only drift.

Settings rows are therefore **summaries that open the dialog**, not forms: scope, date, how far
off it is, and its pace. A row for a date already passed says so rather than counting down, since
it applies to nothing and the row is the only place left that could mention it.

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

### A lone dot is a blank line (DECIDED)

A blank line is what *ends* a card, so a card's own text could never hold one — an answer
written with a paragraph break in it was read as a short answer followed by unrelated prose,
and half of it silently left the deck. **A line holding nothing but `.` is the break.**
Typing `<p>` was the alternative and was rejected as too much ceremony for something written
constantly; a dot is one keystroke and reads as a full stop, which is roughly what it is.

The marker is a **storage detail that stops at the edge of the vault.** `parse-note` expands it
into the blank line it stands for on the way in, `markBlankLines` puts it back on the way out.
Nothing in between meets one: it is not typed into the card editor and never shown on a card, so
it is seen only by someone editing the markdown directly — which is the one place it has to be
typed. It applies to questions as much as answers; a question is often context, a break, then
the ask.

Three rules fall out of round-tripping, and each is tested:

- **Inside a fenced block a dot is left alone.** There, a line reading `.` is the current
  directory in some `ls -a` output — swapping it for a blank line changes what the card claims a
  command prints. `countFences` is therefore shared (`fences.ts`) rather than counted twice: the
  reader and the writer disagreeing about which lines are code is a note that changes shape when
  it is saved.
- **A break at either edge is dropped, not marked.** It separates nothing, and parsing trims a
  card's edges anyway — so a dot there is punctuation written into the user's note that the next
  read throws straight away. The trim lives in `markBlankLines`, not in the editor that happens
  to call `.trim()` today.
- **An inline card whose text gains a line break is rewritten as a block card.** `::` holds one
  line, so keeping the form would leave everything after the first line lying in the note as
  loose prose — gone from the card. This narrows *a card keeps its shape through an edit* to
  where the shape can still hold it. Pre-existing, but blank lines make it easy to trigger.

**Known ambiguity, accepted:** a card whose prose really is a single full stop on its own line
comes back as a blank line. An escape would put a second convention into notes to buy back
something nobody writes.

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

  **CORRECTED:** the comment sits on the line *below* the card — for inline cards too, not
  only block ones. The plugin only writes it at the end of the card's own line when its
  `cardCommentOnSameLine` setting is on, which is off by default. Gneiss assumed the
  same-line form for inline cards, so in a real vault it read none of their state and
  **imported every one of them as never-seen**: 68 of 73 inline cards in the survey vault,
  learned over two years, arriving as new material with a fresh ease. Worse, grading one
  then wrote a second comment on the card's own line, leaving two schedules for one card
  with the stale one first — so the plugin, reading the same note, would see the older.
  A card's span therefore *includes* the comment line below it, which is also what lets an
  edit carry the state across and a deletion take it with the card.

  A card that carries both is the fossil of that bug rather than a case to support, so
  nothing in the reader or the writer accommodates it: the notes were repaired instead,
  keeping the entry from the **most recent review** (`due - interval`, longest interval
  breaking a tie) and writing it below.
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

### The backup reminder is scheduled, not conditional (DECIDED)

A second reminder (default 20:00) that **only arrives on a day you have not worked through a
session**.

Note what settles it: **finishing a session, not grading a card.** Opening the app, answering
one question and putting the phone down is precisely the day this reminder exists for, so
`lastSessionOn` is tracked separately from `lastReviewedOn` — one card still grades the day for
the streak, but only reaching the end of a session counts as having done the reviewing.

A local notification cannot ask a question when it fires — it is set ahead of time and goes off
regardless — so "only if you haven't reviewed" cannot be a property of the notification. It is
decided *when scheduling*, while the answer is known:

- `nextBackup(at, sessionDoneToday, now)` returns tonight when no session has been finished,
  and tomorrow when one has **or** tonight's time has already passed. Arriving at 20:01 to say
  the evening was missed helps nobody.
- It is a **single dated notification, not a repeat**, and `DeckService.syncReminders()` works
  the next one out again whenever the config loads or a session is completed.

Scheduling is fire-and-forget: a reminder that cannot be set — permission declined, system
notifications off — must never stop a review.

### A cached slice starts the session (DECIDED)

Streaming made a large vault *look* like it was working, but the first card still waited on
the first read. `DeckCacheService` keeps roughly four sessions' worth of the most urgent cards
on the device, so opening the app starts a review **immediately** and the vault read catches
up behind it.

- **The vault stays the source of truth.** This is a head start, not a copy. Grades go straight
  into the notes as always; the cache is never consulted for what a card's schedule *is*.
- **Restoring happens in `App`, not the Vault screen**, because the app can open on any tab and
  the point is that Today already has a session ready.
- **Cached cards are not streamed over.** With something already on screen, a second set
  arriving in batches would grow and reorder the queue under the reader, so a refresh stages
  its notes and swaps them in once. With nothing to show, streaming is still the point.
- **A grade given mid-read is re-applied afterwards.** The read may have started before that
  card was written, so the fresh copy can carry the old schedule and the card would come
  straight back. There is a test that fails without this.
- **What comes back off the device is validated, not trusted** — a cache from an older build
  could otherwise reach the scheduler as cards missing the fields it needs. One bad card drops
  the whole cache: a partly-loaded deck is harder to explain than a slow start.
- **Keyed by vault name**, so another vault's cards are never served. The name is stored beside
  the URI rather than derived from it, since how a tree URI maps to a name is the document
  provider's business.

**OPEN:** the cache is only reached for on Android, where the vault reopens without a prompt.
The browser needs a user gesture to regain its folder handle, so cards would appear that could
not yet be written back.

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

### Writing into a folder something else is syncing (DECIDED)

Every write Gneiss makes lands in a folder Obsidian Sync, Dropbox or Syncthing is watching,
and all of them keep **both** versions of a file whenever the two sides moved since the tool
last looked. Gneiss cannot stop the other side moving — the vault is not its to own. What it
can do is **not be a side that moved for no reason**, and it was one in three ways. All three
were found from a real conflicted copy on a phone, and the surprise was how much of it was
self-inflicted.

**A no-op counted as an edit.** `editNote` wrote `transform(contents)` unconditionally, and
the transforms hand the note straight back when no card carries that question —
`withReviewState`, `withEditedCard` and `withoutCard` all do, and a grade re-applied after a
vault read is often byte-identical. Writing those touched the file's timestamp with nothing
to show for it, which can only ever manufacture a conflict; it can never resolve one.

**A note written on Windows came back rewritten end to end.** The transforms work in `\n` and
normalise the whole file on the way in, so grading one card produced a diff across every line
of the note — a bigger conflict, and an unreadable one.

Both are the same mistake, writing more than was meant, so both are answered in one place:
`editedNote(original, transform)` returns the rewrite **in the note's own line endings**, or
`null` when nothing changed and the right thing to write is nothing at all. All three sources
call it, because it is the point that knows what the file said before.

**Two writes to one note could interleave.** Each is a read-modify-write against the file as
it is on disk, so two that overlap both read the note *before* either has written it — and
the second puts back a copy that never saw the first. A grade quietly undone by an edit that
landed at the same moment. `NoteWriter` chains them **per note**, so a write to one file is
not held up by a write to another. Its stored tail must never carry a rejection: one failed
write would otherwise settle every write queued behind it on that note without any being
attempted, and that note would stop being written to for the rest of the session. Failures
are recorded rather than thrown at the screen — the in-memory change is never rolled back,
because the user's action genuinely happened. `DeckService` delegates to it and no longer
carries that plumbing itself.

**The handoff to Obsidian is sequenced.** The "Open in Obsidian" link writes nothing — it is
an `obsidian://` href — but the app used to fire the save and forget it (`void
deck.editCard(…)`), closing the editor while the file was still being rewritten, with its own
link right there. Saving now waits for the note to be written before the editor closes, and
while a write is in flight the footer says *Saving to the note…* in place of the link. A file
two programs are inside at once is how they come to hold different versions of it.

**What this does not fix, and knowingly.** If Obsidian is open on that note anywhere while
Gneiss writes it, both sides genuinely have a version and the sync tool is right to keep both.
**OPEN:** Gneiss writes a note on *every grade*, which is far more often than a person edits
notes, so it is likely to be one side of any conflict. Holding grades in memory and flushing
per note at the end of a session would cut that by an order of magnitude — but it contradicts
*grades go straight into the notes* above, and is parked until a sync log says the other
writer is a second device rather than something still fixable here.

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

## What day it is, is a signal (CORRECTED)

`today()` was `new Date().toISOString().slice(0, 10)` — the **UTC** date, not the local one.
East of Greenwich that is yesterday's date for the width of the offset: in Amsterdam in summer
the day rolled over at 02:00, so a review at 00:30 counted towards the day before, and with it
the streak, the due set and every cram countdown. `localDate()` reads local calendar parts
instead. The date *arithmetic* in the vault (`addDays`, `daysBetween`) is deliberately left
anchored at `T00:00:00Z`: those operate on date-only strings, where UTC anchoring is what makes
the arithmetic timezone-independent.

Fixing the value was only half of it. `today()` was called inside `computed()`s, which recompute
only when a **signal** they read changes — so nothing noticed a rollover at all, and an app left
open overnight served the previous day's queue in the morning. `ClockService` owns the day as a
signal, and `DeckService` reads `this.clock.today()` everywhere. `today()` survives as a plain
function for the one-shot reads that only ever want the date right now.

The tick is scheduled for the next **local** midnight, built as `day + 1` rather than by adding
24 hours — the constructor normalises a month end, and lands on real midnight on the two nights
a year that are not 24 hours long. It also resyncs on `visibilitychange`, because **a sleeping
phone does not run timers**: the backgrounded-overnight case, which is the common one, is caught
on the way back into the app rather than by the timer at all.

## Prototype-only shortcuts

- `due` is an integer day offset, not a real date. Real version needs timestamps.
- All state is in React memory; nothing persists across reload.
- The vault is five hardcoded markdown strings in `SEED`.
- Streak is a plain counter with no date logic.

## Images on cards (DECIDED, built)

Obsidian embeds an image as `![[diagram.png]]` — what pasting one produces — or
`![alt](assets/diagram.png)`. Both were always plain text inside a card's answer, and
`parseNote` passed them through the way it passes through fenced code, so a card has always
*carried* its images. Only showing them was missing.

`splitEmbeds()` cuts a card into prose and embeds, and `gn-card-body` renders the result on
both Review and Vault. Two things had to be settled:

**Finding the file.** `![[diagram.png]]` says what to show without saying where it lives, so it
needs a name → path index. As anticipated, that index is **built during the directory walk that
already exists** — every entry is listed there anyway, and finding an image afterwards would
mean a second pass over the whole vault, once per card. The walk now returns non-markdown
entries alongside the notes. Names only: the bytes are read when a card asks for them.

**Loading the bytes.** The earlier plan was `Capacitor.convertFileSrc(uri)`, which hands the
webview a native path so nothing enters JS memory. **That no longer applies** — since the vault
is reached through the Storage Access Framework, an attachment is a `content://` document URI,
which `convertFileSrc` cannot turn into anything loadable. The plugin reads the file and returns
a **base64 data URL** instead. The cost is real (bytes cross the bridge and sit in JS), and it
is contained by reading on demand, one card at a time, and caching per session — the same
diagram often appears on several cards.

**OPEN:** a very large screenshot is a large base64 string. If that bites, the fix is a custom
`WebViewAssetLoader` route that streams the file to the webview instead.

## Next steps discussed

- ~~**Format detection**~~ — **RESOLVED**, see *Vault conventions this assumes*: real
  notes already use the block `?` format, so no migration is needed.
- ~~**Importing existing SR state**~~ — **RESOLVED.** `<!--SR:...-->` comments parse on
  read, and the years-old-backlog problem is handled by `selectDue()` rather than by
  rewriting due dates.

  **Nothing is rescheduled.** A card scheduled in 2024 genuinely is overdue, and moving
  its date would be Gneiss lying about the user's own data — and would mean writing to
  every note on first run. Instead a *session* is portioned: `reviewsPerSession` for cards
  in rotation, `newPerSession` for unseen ones, so a backlog cannot eat the sitting's new
  material. The Today screen says how much is beyond the portion rather than hiding it.

  **The two are one budget, not two ceilings (DECIDED).** Whichever pool is short gives its
  room to the other, so a session is a consistent size instead of collapsing on the days one
  side has run dry: **10 + 5** is fifteen either way — fifteen reviews when nothing is new,
  fifteen new when nothing is due. Neither side is padded beyond what exists, so a small deck
  simply yields a small session.

  The defaults are deliberately modest. A card that takes real thinking to answer — an exam
  question about code, say — is not the same work as one answered in a second, and a pace set
  for the second kind gets abandoned.

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

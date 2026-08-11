# Gneiss

Spaced-repetition flashcards built from an Obsidian vault. Your notes stay the source of truth: Gneiss reads them and writes review state back into them.

**[Try it in a browser →](https://antondegroot.github.io/Gneiss/)** (Chromium only — it needs the File System Access API)

> Early prototype. [`CLAUDE.md`](./CLAUDE.md) has the design decisions and the reasoning behind them.

## ⚠️ Disable the Obsidian *Spaced Repetition* plugin first

One scheduler per vault. Gneiss writes the same `<!--SR:...-->` comments, in the same lines of the same files.

1. **Settings → Community plugins → disable _Spaced Repetition_.** Your existing intervals and eases carry over.
2. **Review on one device at a time.** Let the vault finish syncing before you switch.

Run both, or review on two devices between syncs, and you get conflicted copies. Those copies keep their `#flashcards` tag, so every card in them comes round twice.

Already have some? Merge each card to its furthest-out due date, then delete the copies.

## Card format

Plain markdown, matching what the SR plugin already expects.

````md
Redirect stdout to a file :: `cmd > out.txt`

What does a merge commit record?
?
Two parents.
.
It marks where two histories were joined.
````

| Syntax | Meaning |
| --- | --- |
| `::` | inline card |
| `?` alone on a line | splits question from answer |
| `.` alone on a line | a blank line inside a card |
| `#core` / `#optional` | tier override for that note |
| `<!--SR:!2026-08-11,3,250-->` | review state, read and written |

A real blank line ends a card, which is why `.` exists for paragraph breaks. You never see it or type it in the app — only in the markdown.

Fenced code blocks and images (`![[diagram.png]]`, `![alt](assets/diagram.png)`) work inside answers.

## Tiers

Not every card deserves the same review budget. `grep` gets used daily; Java generics is cheap to look up.

| Tier | Examples | Behaviour |
| --- | --- | --- |
| `core` | grep, git | slow interval growth → comes back often |
| `standard` | docker, vim | normal SM-2-ish pace |
| `optional` | java-generics | fast growth → drifts out of rotation |

A **core emphasis** slider in Settings sets how far the tiers diverge. At zero they all behave identically.

How a note's tier is chosen, first match wins:

1. A `#core` / `#optional` tag in the note
2. The tag → tier table in Settings, longest prefix first (`#flashcards/lang/certexam` beats `#flashcards/lang`)
3. Default: `standard`

`standard` is the absence of a tag, so the common case needs no edit. Only notes tagged `#flashcards*` produce cards, and Gneiss never adds that tag for you.

## Cram mode

For deadlines. An exam is a **tag + a date + a pace**.

- Nothing schedules past the exam, so intervals compress on their own as it approaches
- The date is the off-switch: the day after, the topic reverts to its tier
- Several exams at once; where two cover a card, the earlier deadline wins
- It reports the pace the deadline demands. It never withholds cards.

## Screens

- **Today** — due count as a tier-segmented ring, streak, exam countdowns, Start review
- **Review** — question → show answer → grade, each button previewing when the card returns
- **Vault** — notes with their resolved tier; tap one to see its parsed cards
- **Settings** — reminders, session sizes, core emphasis, the tag → tier table, exams

## Running it

```bash
npm install
npm start            # Angular dev server
npm run build        # production build
npm test             # vault module (vitest)
npm run test:app     # Angular specs
npm run lint
```

On Android:

```bash
npm run android:install   # build and install onto a connected phone
```

Needs **JDK 21** — Gradle 8.14.3 cannot read newer class files.

The clickable React design reference lives in `prototype/`:

```bash
npm run prototype
```

Careful: `npm run prototype:build` empties `dist/` and wipes the Angular build. Run `npm run build` to restore it.

## Stack

Angular + Capacitor, local-first, no backend.

| What | Where it lives |
| --- | --- |
| Notes | your vault, through a folder you pick once |
| Review state | an `<!--SR:-->` comment after each card |
| App config | `.gneiss/config.md` inside the vault |
| Reminders | on-device notifications |

Cross-device sync comes free from whatever already syncs your vault. No server, no accounts, works offline.

**Vault access:** Android uses the Storage Access Framework, the browser uses the File System Access API. iOS is not built yet.

## Open questions

- **Scheduler** — currently a hand-rolled SM-2 approximation. FSRS would be better, and the tier multiplier sits on top so it should survive the swap.
- **Card identity** — progress is matched on question text, so editing a question resets its history.
- **iOS** — needs its own vault source (document picker + security-scoped bookmarks).
/**
 * Sync conflicts: spotting them, and merging one back into its note.
 *
 * Every write Gneiss makes lands in a folder something else is syncing, and all
 * of them answer a simultaneous edit the same way — by keeping *both* versions,
 * the second under a new name. That second file is not a note anyone wrote. Left
 * alone it is worse than clutter: it holds the same cards as the note beside it,
 * so every one of them is asked twice, and grading either writes to only one.
 *
 * Two halves, deliberately separate:
 *
 * - **Which file is a copy** is decided by its name, because that is the only
 *   thing a sync tool tells us. See `conflictedCopyOf`.
 * - **What the two versions disagree about** is decided by reading them. Review
 *   state settles itself — the newest review of each card wins — and everything
 *   else is left for the user, because only they know whether a card missing
 *   from one side was deleted on purpose or never arrived.
 */

import { opcodes } from "./diff.js";
import type { Op } from "./diff.js";
import { cardKey, segments, splitReview } from "./note-blocks.js";
import { formatReviewComment, parseReviewStates } from "./review-state.js";
import { addDays } from "./schedule.js";
import type { ReviewState } from "./types.js";

const MARKDOWN = ".md";

/**
 * `Note (… conflicted copy …).md`, as ownCloud, Nextcloud and Dropbox write it.
 *
 * The bracketed suffix must close the name, which is what keeps a note *about*
 * conflicts — `Resolving a conflicted copy.md` — from being taken for one. The
 * inner parts vary: a device, a date, a possessive owner, or nothing at all.
 * `[^()]` rather than `.` so a nested group cannot be swallowed.
 */
const BRACKETED = /^(.*)\((?:[^()]*\s)?conflicted copy(?:\s[^()]*)?\)$/i;

/** `Note.sync-conflict-20260806-094800-DEVICE.md`, as Syncthing writes it. */
const SYNCTHING = /^(.*)\.sync-conflict-\d{8}-\d{6}-[A-Za-z0-9]+$/;

/**
 * The note this file is a conflicted copy of, or `null` when it is just a note.
 *
 * Matched on the name alone. The costs are lopsided, which is why the patterns
 * are anchored rather than generous: missing a copy serves its cards twice,
 * which is irritating and *visible*, while mistaking a real note for one empties
 * it out of the deck silently. iCloud's `Note 2.md` is therefore left out — it
 * cannot be told apart from `Chapter 2.md`, and no amount of care in here would
 * change that.
 *
 * The folder is kept, since a copy is written beside the note it came from.
 */
export function conflictedCopyOf(path: string): string | null {
  const cut = path.lastIndexOf("/");
  const folder = cut === -1 ? "" : path.slice(0, cut + 1);
  const name = path.slice(cut + 1);
  if (!name.toLowerCase().endsWith(MARKDOWN)) return null;

  const stem = name.slice(0, -MARKDOWN.length);
  const original = (BRACKETED.exec(stem) ?? SYNCTHING.exec(stem))?.[1]?.trim();

  return original ? `${folder}${original}${MARKDOWN}` : null;
}

/**
 * One difference the user has to settle.
 *
 * A side is absent when only the other has the card: `theirs` alone is a card
 * the copy has and the note does not, which is either something that never
 * arrived or something deleted on purpose. Nothing in the two files says which,
 * which is the whole reason this is a question rather than a merge rule.
 *
 * Position is identity — `mergeNotes` takes resolutions in this order — so there
 * is no id to keep in step between here and the screen.
 */
export interface ConflictHunk {
  /** The card as the note has it, joined as written. */
  readonly mine?: string;
  /** The card as the conflicted copy has it. */
  readonly theirs?: string;
}

/**
 * What the two versions disagree about, in the order they appear.
 *
 * Only text. Cards that differ in nothing but their review comment are absent,
 * because the newer review of each direction wins and there is nothing to ask —
 * see `mergeNotes`, which is what actually applies that.
 */
export function conflictHunks(mine: string, theirs: string): ConflictHunk[] {
  const ours = cardRuns(mine);
  const theirRuns = cardRuns(theirs);

  return align(ours, theirRuns).changes.map((change) => ({
    ...(change.ours >= 0 ? { mine: (ours[change.ours] ?? []).join("") } : {}),
    ...(change.theirs >= 0 ? { theirs: (theirRuns[change.theirs] ?? []).join("") } : {}),
  }));
}

/** One card-sized difference: at most one card from either side. */
interface Change {
  /** Index into our cards, or -1 when only the copy holds this one. */
  readonly ours: number;
  /** Index into the copy's cards, or -1 when only we hold it. */
  readonly theirs: number;
  /** Which of our cards the copy's would go before. */
  readonly at: number;
}

/**
 * The two versions lined up: what matches, and what has to be asked about.
 *
 * A run of changed cards is split one card at a time rather than offered whole.
 * The alignment happily reports "these two of ours became those three of
 * theirs", which is true and useless to answer — the question a person can
 * actually settle is about *a card*, so a run is paired off in order and
 * whatever is left over becomes a one-sided change.
 */
function align(
  ours: readonly (readonly string[])[],
  theirs: readonly (readonly string[])[],
): { changes: Change[]; partner: Map<number, number> } {
  const changes: Change[] = [];
  const partner = new Map<number, number>();

  for (const op of opcodes(ours.map(cardKey), theirs.map(cardKey))) {
    if (op.tag === "equal") matchUp(op, partner);
    else changes.push(...pairOff(op));
  }

  return { changes, partner };
}

/** Cards that are the same on both sides, so their schedules can be merged. */
function matchUp(op: Op, partner: Map<number, number>): void {
  for (let n = 0; n < op.i2 - op.i1; n++) partner.set(op.i1 + n, op.j1 + n);
}

/** A run of changed cards, taken one at a time; the longer side has leftovers. */
function pairOff(op: Op): Change[] {
  return Array.from({ length: Math.max(op.i2 - op.i1, op.j2 - op.j1) }, (_, k) => {
    const ours = op.i1 + k < op.i2 ? op.i1 + k : -1;

    return { ours, theirs: op.j1 + k < op.j2 ? op.j1 + k : -1, at: ours === -1 ? op.i2 : ours };
  });
}

/** Just the cards, with the blank runs between them left out. */
function cardRuns(md: string): readonly (readonly string[])[] {
  return segments(md)
    .filter((segment) => segment.kind === "card")
    .map((segment) => segment.lines);
}

/** What to do with one difference: keep ours, take theirs, or hold on to both. */
export type Resolution = "mine" | "theirs" | "both";

/**
 * The note as it should be written, given a decision per hunk.
 *
 * Decisions arrive in `conflictHunks` order and default to **both**, because the
 * only irreversible outcome here is dropping something the user still wanted.
 *
 * Everything not in a hunk is the same card on both sides, and gets the one
 * thing this does without asking: its review comment merged, slot by slot.
 */
export function mergeNotes(
  mine: string,
  theirs: string,
  resolutions: readonly Resolution[],
): string {
  const ours = cardRuns(mine);
  const theirRuns = cardRuns(theirs);

  const dropped = new Set<number>();
  const added = new Map<number, string[]>();
  const { changes, partner } = align(ours, theirRuns);

  changes.forEach((change, at) => {
    const choice = resolutions[at] ?? "both";
    if (choice === "theirs" && change.ours >= 0) dropped.add(change.ours);
    if (choice !== "mine" && change.theirs >= 0) {
      const block = (theirRuns[change.theirs] ?? []).join("");
      added.set(change.at, [...(added.get(change.at) ?? []), block]);
    }
  });

  return assemble(mine, ours.length, { dropped, added, partner, theirRuns });
}

interface MergePlan {
  readonly dropped: ReadonlySet<number>;
  readonly added: ReadonlyMap<number, readonly string[]>;
  readonly partner: ReadonlyMap<number, number>;
  readonly theirRuns: readonly (readonly string[])[];
}

/**
 * Walks the note we already have and writes it out under the plan.
 *
 * Ours is the spine rather than a fresh document, so every blank line, heading
 * and paragraph the merge has no opinion about survives exactly as written —
 * this lands in a folder something else is syncing, and a note that comes back
 * reformatted is a conflict waiting to happen.
 */
function assemble(mine: string, cards: number, plan: MergePlan): string {
  const out: string[] = [];
  let index = 0;
  // A card dropped with nothing put in its place leaves the blank line that
  // separated it from the next, which would air the note out a line at a time.
  // The same reason `withoutCard` collapses one.
  let dropBlank = false;

  for (const segment of segments(mine)) {
    if (segment.kind === "blank") {
      if (dropBlank) dropBlank = false;
      else out.push(...segment.lines);
      continue;
    }
    // A blank line goes *between* what is emitted here, never after it: the
    // note's own blank run follows, and adding one as well airs the note out a
    // line at a time every time a conflict is settled.
    const additions = plan.added.get(index) ?? [];
    const keeping = !plan.dropped.has(index);
    additions.forEach((block, at) => {
      out.push(block);
      if (at < additions.length - 1 || keeping) out.push("\n");
    });
    if (keeping) out.push(withMergedReview(segment.lines, index, plan));
    dropBlank = !keeping && additions.length === 0;
    index++;
  }
  for (const block of plan.added.get(cards) ?? []) out.push("\n", block);

  return out.join("");
}

/** The card as we hold it, with each direction's newest review filled in. */
function withMergedReview(lines: readonly string[], index: number, plan: MergePlan): string {
  const twin = plan.partner.get(index);
  const ourReview = splitReview(lines).review;
  if (twin === undefined || ourReview === null) return lines.join("");

  const merged = mergedReviewLine(ourReview, splitReview(plan.theirRuns[twin] ?? []).review);
  return [...lines.slice(0, -1), merged].join("");
}

/**
 * Two review comments for the same card, merged entry by entry.
 *
 * Never comment-by-comment. A reversed card holds an entry per direction, and
 * those directions are reviewed on different devices at different times — so
 * taking either comment whole discards a review that genuinely happened. Only
 * the slots can be compared.
 */
function mergedReviewLine(ours: string, theirs: string | null): string {
  if (theirs === null) return ours;

  const a = parseReviewStates(ours);
  const b = parseReviewStates(theirs);
  const merged = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => newer(a[i], b[i]));
  if (merged.some((state) => state === undefined)) return ours;

  const indent = ours.slice(0, ours.length - ours.trimStart().length);
  const ending = ours.slice(ours.trimEnd().length);
  return `${indent}${formatReviewComment(merged as ReviewState[])}${ending}`;
}

/**
 * The entry recording the more recent review — `due - interval` is the day it
 * happened. A tie keeps the longer interval, which is the same repair rule the
 * app uses on a note carrying two comments.
 */
function newer(ours?: ReviewState, theirs?: ReviewState): ReviewState | undefined {
  if (!ours || !theirs) return ours ?? theirs;

  const ourDay = addDays(ours.due, -ours.interval);
  const theirDay = addDays(theirs.due, -theirs.interval);
  if (ourDay !== theirDay) return ourDay > theirDay ? ours : theirs;

  return ours.interval >= theirs.interval ? ours : theirs;
}

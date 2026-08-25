/**
 * Writing review state back into a note.
 *
 * The riskiest operation in the app: unlike `withTier`, which edits a tag block
 * at the end of the file, this edits mid-note. Every byte outside the one card's
 * `<!--SR:-->` comment must survive untouched, because the vault is the source of
 * truth and has no backup.
 */

import { locateCard } from "./parse-note.js";
import type { CardLocation } from "./parse-note.js";
import {
  findReviewComment,
  formatReviewComment,
  isReviewCommentLine,
  parseReviewStates,
  replaceReviewComment,
} from "./review-state.js";
import type { ReviewState } from "./types.js";

/**
 * Records `review` against the card whose question is `front`, and which is the
 * `occurrence`-th card in the note asking it.
 *
 * Returns the note unchanged when no such card exists — an edited or deleted
 * question must never cause state to be written against the wrong card. The
 * occurrence is part of that refusal: a note asking the same question twice
 * holds two cards, and matching on the text alone sent both grades to the first
 * of them, leaving the second unable to record one at all.
 */
export function withReviewState(
  md: string,
  front: string,
  occurrence: number,
  review: ReviewState,
): string {
  const at = locateCard(md, front, occurrence);
  if (!at) return md;

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const entries = entriesWith(parseReviewStates(lines[at.answerEndLine] ?? ""), at, review);
  if (!entries) return md;

  return applyAt(lines, at, formatReviewComment(entries)).join("\n");
}

/**
 * The comment's entries with this card's own one brought up to date, or `null`
 * when the card cannot be recorded without inventing a schedule for another.
 *
 * A comment holds one entry per card it serves, in order, so a reversed card's
 * two directions are told apart by position alone. That has two consequences
 * here, and both are about not writing something untrue:
 *
 * - **Entries beyond what the card serves are dropped.** A `??` edited by hand
 *   down to `?` leaves a second entry behind that now schedules nothing, and
 *   keeping it would let the plugin go on reading a card that no longer exists.
 * - **A gap in front of this entry is refused.** The queue offers a reversed
 *   card's forward direction first, so its entry is always written before the
 *   reverse one needs a slot behind it. If that ever stopped holding, writing
 *   the reverse direction's schedule as the first entry would silently hand it
 *   to the forward direction — so nothing is written at all instead.
 */
function entriesWith(
  existing: readonly ReviewState[],
  at: CardLocation,
  review: ReviewState,
): ReviewState[] | null {
  const served = at.kind === "reversed" ? 2 : 1;
  const entries = existing.slice(0, served);
  if (at.entry > entries.length) return null;

  entries[at.entry] = review;
  return entries;
}

function applyAt(lines: string[], at: CardLocation, comment: string): string[] {
  const existing = lines[at.answerEndLine] ?? "";

  if (isReviewCommentLine(existing)) return replaceLine(lines, at.answerEndLine, comment);
  if (findReviewComment(existing) !== null) {
    return replaceLine(lines, at.answerEndLine, replaceReviewComment(existing, comment));
  }
  return insertComment(lines, at, comment);
}

function replaceLine(lines: string[], index: number, replacement: string): string[] {
  const copy = [...lines];
  copy[index] = replacement;
  return copy;
}

/**
 * The comment goes on its own line after the card — where the SR plugin puts it,
 * for inline and block cards alike, so notes stay readable by both.
 *
 * **CORRECTED:** inline cards used to take it at the end of their own line. The
 * plugin only writes there when its `cardCommentOnSameLine` setting is on, which
 * is off by default, so a plugin-written vault had every inline card's state on
 * the line below — unread, and then overwritten with a fresh schedule as if the
 * card had never been seen.
 */
function insertComment(lines: string[], at: CardLocation, comment: string): string[] {
  const copy = [...lines];
  copy.splice(at.answerEndLine + 1, 0, comment);
  return copy;
}

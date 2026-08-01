/**
 * Writing review state back into a note.
 *
 * The riskiest operation in the app: unlike `withTier`, which edits a tag block
 * at the end of the file, this edits mid-note. Every byte outside the one card's
 * `<!--SR:-->` comment must survive untouched, because the vault is the source of
 * truth and has no backup.
 */

import { locateCards } from "./parse-note.js";
import type { CardLocation } from "./parse-note.js";
import { formatReviewComment } from "./review-state.js";
import type { ReviewState } from "./types.js";

const COMMENT = /<!--SR:(?:![\d-]+,\d+,\d+)+-->/;
const COMMENT_ONLY_LINE = /^\s*<!--SR:(?:![\d-]+,\d+,\d+)+-->\s*$/;

/**
 * Records `review` against the card whose question is `front`.
 *
 * Returns the note unchanged when no such card exists — an edited or deleted
 * question must never cause state to be written against the wrong card.
 */
export function withReviewState(md: string, front: string, review: ReviewState): string {
  const at = locateCards(md).find((location) => location.front === front);
  if (!at) return md;

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const comment = formatReviewComment([review]);

  return applyAt(lines, at, comment).join("\n");
}

function applyAt(lines: string[], at: CardLocation, comment: string): string[] {
  const existing = lines[at.answerEndLine] ?? "";

  if (COMMENT_ONLY_LINE.test(existing)) return replaceLine(lines, at.answerEndLine, comment);
  if (COMMENT.test(existing)) {
    return replaceLine(lines, at.answerEndLine, existing.replace(COMMENT, comment));
  }
  return insertComment(lines, at, comment, existing);
}

function replaceLine(lines: string[], index: number, replacement: string): string[] {
  const copy = [...lines];
  copy[index] = replacement;
  return copy;
}

/**
 * Inline cards take the comment on the same line, block cards on the line below —
 * matching where the SR plugin puts it, so notes stay readable by both.
 */
function insertComment(
  lines: string[],
  at: CardLocation,
  comment: string,
  existing: string,
): string[] {
  if (at.kind === "inline") {
    return replaceLine(lines, at.answerEndLine, `${existing} ${comment}`);
  }
  const copy = [...lines];
  copy.splice(at.answerEndLine + 1, 0, comment);
  return copy;
}

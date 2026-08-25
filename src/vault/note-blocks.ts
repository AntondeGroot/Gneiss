/**
 * A note cut into the runs of lines a card occupies.
 *
 * Merging two versions of a note is done card by card rather than line by line,
 * because a card is the unit a person recognises: "this question changed" is
 * answerable, "line 412 changed" is not. Blank runs are kept as they are, so a
 * note reassembled from its segments is the note that went in.
 *
 * Two rules decide where a card ends, and both come from how notes are written:
 *
 * - **A blank line ends it**, which is what `parse-note` already assumes.
 * - **So does a review comment**, because the plugin writes one per card and the
 *   next card can follow on the very next line with no blank between. Without
 *   this the two would be read as a single run and compared as one.
 *
 * Inside a fence neither applies: a blank line there is part of a code sample.
 */

import { countFences } from "./fences.js";
import { isReviewCommentLine } from "./review-state.js";

export type Segment =
  | { readonly kind: "card"; readonly lines: readonly string[] }
  | { readonly kind: "blank"; readonly lines: readonly string[] };

/** The note as an ordered list of runs. Joining every line gives it back. */
export function segments(md: string): Segment[] {
  const out: Segment[] = [];
  let current: string[] = [];
  let fenced = false;

  const close = (): void => {
    if (current.length > 0) out.push({ kind: "card", lines: current });
    current = [];
  };

  for (const line of linesOf(md)) {
    if (countFences(line) % 2 === 1) fenced = !fenced;

    if (line.trim() === "" && !fenced) {
      close();
      addBlank(out, line);
      continue;
    }

    current.push(line);
    if (!fenced && isReviewCommentLine(line)) close();
  }
  close();

  return out;
}

/**
 * Lines with their endings kept, so joining them gives the note back exactly —
 * `\r\n` included, which matters because rewriting a note's line endings is a
 * change the sync tool sees.
 */
function linesOf(md: string): string[] {
  const parts = md.split("\n");
  const trailing = parts.pop() ?? "";
  const lines = parts.map((line) => `${line}\n`);
  if (trailing !== "") lines.push(trailing);

  return lines;
}

/** Blank lines collect into one run rather than one segment each. */
function addBlank(out: Segment[], line: string): void {
  const last = out[out.length - 1];
  if (last?.kind === "blank") (last.lines as string[]).push(line);
  else out.push({ kind: "blank", lines: [line] });
}

/** A card's text and its review comment, which is always the last line if present. */
export function splitReview(lines: readonly string[]): {
  text: readonly string[];
  review: string | null;
} {
  const last = lines[lines.length - 1];
  return last !== undefined && isReviewCommentLine(last)
    ? { text: lines.slice(0, -1), review: last }
    : { text: lines, review: null };
}

/**
 * What makes two cards the same card: their text, and deliberately not their
 * schedule.
 *
 * Trailing whitespace is dropped because it is invisible, and a card that
 * differs only by a space someone's editor left behind is not a difference worth
 * putting in front of anyone.
 */
export function cardKey(lines: readonly string[]): string {
  return splitReview(lines)
    .text.map((line) => `${line.trimEnd()}\n`)
    .join("");
}

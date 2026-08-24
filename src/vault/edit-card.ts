/**
 * Rewriting and removing a single card, in place.
 *
 * As risky as `withReviewState`, and for the same reason: this edits mid-note in
 * a file Gneiss does not own and cannot restore. Every byte outside the one
 * card's own span must survive untouched.
 *
 * The subtle part is review state. A card's `<!--SR:-->` comment sits *inside*
 * that span — on the same line for an inline card, on its own line for a block
 * one — so replacing the span naively would throw away the card's history along
 * with its typo. It is lifted out first and put back afterwards, which is what
 * lets a question be corrected without resetting its schedule.
 */

import { markBlankLines } from "./blank-lines.js";
import { locateCard } from "./parse-note.js";
import type { CardLocation } from "./parse-note.js";

const COMMENT = /<!--SR:(?:![\d-]+,\d+,\d+)+-->/;
const BLOCK_SEPARATOR = "?";
const REVERSED_SEPARATOR = "??";

export interface CardText {
  readonly front: string;
  readonly back: string;
}

/**
 * Replaces one card's question and answer, keeping its review state.
 *
 * Returns the note unchanged when the note holds no such card — the same refusal
 * `withReviewState` makes, so a stale front can never rewrite the wrong card.
 * `occurrence` tells two cards asking the same question apart.
 */
export function withEditedCard(
  md: string,
  front: string,
  occurrence: number,
  next: CardText,
): string {
  return rewriteSpan(md, front, occurrence, (at, span) => renderCard(next, at, commentIn(span)));
}

/**
 * Removes a card outright, and the blank line it leaves behind.
 *
 * Only the card goes: surrounding prose, headings and the note's tag block are
 * not the app's to delete.
 */
export function withoutCard(md: string, front: string, occurrence: number): string {
  return rewriteSpan(md, front, occurrence, () => []);
}

/** Applies `replace` to the card's lines, leaving the rest of the note alone. */
function rewriteSpan(
  md: string,
  front: string,
  occurrence: number,
  replace: (at: CardLocation, span: string[]) => string[],
): string {
  const normalized = md.replace(/\r\n/g, "\n");
  const at = locateCard(normalized, front, occurrence);
  if (!at) return md;

  const lines = normalized.split("\n");
  const span = lines.slice(at.startLine, at.answerEndLine + 1);
  const rewritten = [
    ...lines.slice(0, at.startLine),
    ...replace(at, span),
    ...lines.slice(at.answerEndLine + 1),
  ];

  return collapseBlankRun(rewritten, at.startLine).join("\n");
}

/** The card's existing review comment, if it carries one. */
function commentIn(span: string[]): string {
  return COMMENT.exec(span.join("\n"))?.[0] ?? "";
}

/**
 * The card as markdown, in the form it was already written in. A card keeps its
 * shape through an edit: an inline card does not silently become a block one.
 *
 * Unless it no longer fits. `::` is a one-line form, so an answer that has gained
 * a line break cannot be written that way — the extra lines would land in the
 * note as loose prose and be lost from the card. The form follows what the card
 * now holds, which is the only reading under which nothing is dropped.
 */
function renderCard(next: CardText, at: CardLocation, comment: string): string[] {
  if (at.kind === "reversed") return renderReversed(next, at.entry, comment);

  return at.kind === "inline" && fitsOneLine(next)
    ? renderInline(next, comment)
    : renderBlock(next, comment);
}

/**
 * The `??` form, put back the way the note holds it rather than the way the card
 * was shown.
 *
 * Only one of the two directions is written down, so editing the other means the
 * question being corrected is the note's answer line. Writing it as shown would
 * swap the two lines — and with them the two entries of the comment, which are
 * matched to the directions by position — handing each direction the other's
 * schedule without changing a character of the comment itself.
 */
function renderReversed(next: CardText, entry: number, comment: string): string[] {
  const written = entry === 0 ? next : { front: next.back, back: next.front };
  const lines = [
    ...markBlankLines(written.front).split("\n"),
    REVERSED_SEPARATOR,
    ...markBlankLines(written.back).split("\n"),
  ];
  return comment ? [...lines, comment] : lines;
}

function fitsOneLine(next: CardText): boolean {
  return !next.front.includes("\n") && !next.back.includes("\n");
}

/** The comment on its own line below, as the SR plugin writes it. */
function renderInline(next: CardText, comment: string): string[] {
  const line = `${next.front} :: ${next.back}`;
  return comment ? [line, comment] : [line];
}

/**
 * The block form, with blank lines written as the marker that survives a re-read
 * — an unmarked one would end the card and cut the rest of the answer loose.
 */
function renderBlock(next: CardText, comment: string): string[] {
  const lines = [
    ...markBlankLines(next.front).split("\n"),
    BLOCK_SEPARATOR,
    ...markBlankLines(next.back).split("\n"),
  ];
  return comment ? [...lines, comment] : lines;
}

/**
 * Squashes the double blank line a removal leaves between its neighbours, so
 * deleting a card does not slowly air out the note.
 */
function collapseBlankRun(lines: string[], at: number): string[] {
  const before = lines[at - 1];
  const after = lines[at];
  if (before?.trim() !== "" || after?.trim() !== "") return lines;

  return [...lines.slice(0, at), ...lines.slice(at + 1)];
}

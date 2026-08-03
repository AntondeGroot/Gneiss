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

import { locateCards } from "./parse-note.js";
import type { CardLocation } from "./parse-note.js";

const COMMENT = /<!--SR:(?:![\d-]+,\d+,\d+)+-->/;
const BLOCK_SEPARATOR = "?";

export interface CardText {
  readonly front: string;
  readonly back: string;
}

/**
 * Replaces one card's question and answer, keeping its review state.
 *
 * Returns the note unchanged when no card has that question — the same refusal
 * `withReviewState` makes, so a stale front can never rewrite the wrong card.
 */
export function withEditedCard(md: string, front: string, next: CardText): string {
  return rewriteSpan(md, front, (at, span) => renderCard(next, at.kind, commentIn(span)));
}

/**
 * Removes a card outright, and the blank line it leaves behind.
 *
 * Only the card goes: surrounding prose, headings and the note's tag block are
 * not the app's to delete.
 */
export function withoutCard(md: string, front: string): string {
  return rewriteSpan(md, front, () => []);
}

/** Applies `replace` to the card's lines, leaving the rest of the note alone. */
function rewriteSpan(
  md: string,
  front: string,
  replace: (at: CardLocation, span: string[]) => string[],
): string {
  const normalized = md.replace(/\r\n/g, "\n");
  const at = locateCards(normalized).find((location) => location.front === front);
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
 */
function renderCard(next: CardText, kind: CardLocation["kind"], comment: string): string[] {
  if (kind === "inline") {
    const line = `${next.front} :: ${next.back}`;
    return [comment ? `${line} ${comment}` : line];
  }

  const lines = [next.front, BLOCK_SEPARATOR, ...next.back.split("\n")];
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

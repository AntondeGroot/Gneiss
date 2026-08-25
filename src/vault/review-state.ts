/**
 * Reading and writing per-card review state.
 *
 * The Obsidian SR plugin stores it as an HTML comment on the line after a card:
 *   <!--SR:!2024-08-21,1,210-->
 * where the fields are due date, interval in days, and ease as an integer percent.
 * Matching that format round-trips with the plugin and preserves existing history.
 */

import type { ReviewState } from "./types.js";

const REVIEW_COMMENT = /<!--SR:((?:![\d-]+,\d+,\d+)+)-->/;
/**
 * The same comment, filling a line on its own.
 *
 * Tested against a trimmed line rather than padded with `\s*`, which keeps it
 * linear and lets callers pass a line with or without its ending.
 */
const REVIEW_COMMENT_ONLY = /^<!--SR:(?:![\d-]+,\d+,\d+)+-->$/;
const REVIEW_COMMENT_GLOBAL = new RegExp(REVIEW_COMMENT.source, "g");
const ENTRY = /!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)/g;

/** The plugin stores ease as an integer percent: 210 means an ease of 2.10. */
const EASE_PERCENT = 100;

/**
 * Whether this line holds review state and nothing else.
 *
 * Where the plugin puts an inline card's comment: on the line *below* the card.
 * Four modules asked this question with four regexes of their own until one of
 * them turned out not to understand a reversed card's two-entry comment, read it
 * as card text, and discarded a direction's history. They ask here now.
 */
export function isReviewCommentLine(line: string): boolean {
  return REVIEW_COMMENT_ONLY.test(line.trim());
}

/** The first review comment in `text`, or null. */
export function findReviewComment(text: string): string | null {
  return REVIEW_COMMENT.exec(text)?.[0] ?? null;
}

/** `text` with its first review comment swapped for `replacement`. */
export function replaceReviewComment(text: string, replacement: string): string {
  return text.replace(REVIEW_COMMENT, replacement);
}

export function parseReviewStates(text: string): ReviewState[] {
  const comment = REVIEW_COMMENT.exec(text);
  if (!comment?.[1]) return [];

  return [...comment[1].matchAll(ENTRY)].map(([, due, interval, ease]) => ({
    due: due ?? "",
    interval: Number(interval),
    ease: Number(ease) / EASE_PERCENT,
  }));
}

export function formatReviewComment(states: ReviewState[]): string {
  if (states.length === 0) return "";
  const entries = states.map(formatEntry).join("");
  return `<!--SR:${entries}-->`;
}

function formatEntry(state: ReviewState): string {
  const ease = Math.round(state.ease * EASE_PERCENT);
  return `!${state.due},${state.interval},${ease}`;
}

export function stripReviewComments(text: string): string {
  return text.replace(REVIEW_COMMENT_GLOBAL, "");
}

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
const REVIEW_COMMENT_GLOBAL = new RegExp(REVIEW_COMMENT.source, "g");
const ENTRY = /!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)/g;

/** The plugin stores ease as an integer percent: 210 means an ease of 2.10. */
const EASE_PERCENT = 100;

export function parseReviewStates(text: string): ReviewState[] {
  const comment = text.match(REVIEW_COMMENT);
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
/**
 * The vault module: markdown in, cards and scheduling out.
 *
 * Framework-free and dependency-free by design — the React prototype consumes it
 * today and the Angular app will lift it unchanged.
 */

export type {
  CramState,
  Grade,
  ParsedCard,
  ParsedNote,
  ReviewState,
  Tier,
  TierMapping,
} from "./types.js";

export { parseNote } from "./parse-note.js";
export { findTags, findTierOverride, findTopicTags, isFlashcardNote, withTier } from "./tags.js";
export { formatReviewComment, parseReviewStates, stripReviewComments } from "./review-state.js";
export { resolveTier, tierFromMapping, tierGrowth } from "./tier.js";
export type { Tierable } from "./tier.js";
export { distinctTopicTags, topicTiers, withTopicTier } from "./topics.js";
export type { TopicTier } from "./topics.js";
export { cramClamp, daysBetween } from "./cram.js";
export { addDays, isDue, newReviewState, schedule, STARTING_EASE } from "./schedule.js";
export type { SchedulingOptions } from "./schedule.js";
export { DEFAULT_CONFIG, formatConfig, parseConfig } from "./config.js";
export type { GneissConfig } from "./config.js";
export { locateCards } from "./parse-note.js";
export type { CardLocation } from "./parse-note.js";
export { withReviewState } from "./write-review.js";
export { NEVER, nextStreak, standingStreak } from "./streak.js";
export { selectDue } from "./queue.js";
export type { DailyLimits, DueSelection, Schedulable } from "./queue.js";

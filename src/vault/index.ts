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
export { formatReviewComment, hasReviewComment, parseReviewStates, stripReviewComments } from "./review-state.js";
export { resolveTier, tierGrowth } from "./tier.js";
export { cramClamp, daysBetween } from "./cram.js";
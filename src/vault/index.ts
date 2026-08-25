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
export { conflictHunks, conflictedCopyOf, mergeNotes } from "./conflict.js";
export type { ConflictHunk, Resolution } from "./conflict.js";
export { formatReviewComment, parseReviewStates, stripReviewComments } from "./review-state.js";
export { resolveTier, tierFromMapping, tierGrowth } from "./tier.js";
export type { Tierable } from "./tier.js";
export { distinctTopicTags, topicTiers, withTopicTier } from "./topics.js";
export type { TopicTier } from "./topics.js";
export {
  cramClamp,
  cramPlans,
  daysBetween,
  governingCram,
  isCrammed,
  isWithinScope,
  runningCrams,
} from "./cram.js";
export type { CramPlan } from "./cram.js";
export { addDays, isDue, newReviewState, schedule, STARTING_EASE } from "./schedule.js";
export type { SchedulingOptions } from "./schedule.js";
export { DEFAULT_CONFIG, DEFAULT_CRAM_PER_SESSION, formatConfig, parseConfig } from "./config.js";
export type { GneissConfig } from "./config.js";
export { locateCard, locateCards } from "./parse-note.js";
export type { CardLocation } from "./parse-note.js";
export { withReviewState } from "./write-review.js";
export { withEditedCard, withoutCard } from "./edit-card.js";
export { splitCard, splitInline } from "./card-content.js";
export type { CardSegment, InlinePart } from "./card-content.js";
export type { CardText } from "./edit-card.js";
export { folderOf, obsidianNoteUri } from "./obsidian-link.js";
export { NEVER, nextStreak, standingStreak } from "./streak.js";
export { selectDue } from "./queue.js";
export { cardStanding, tallyStandings } from "./standing.js";
export type { Standing, StandingTally } from "./standing.js";
export type { SessionLimits, DueSelection, Schedulable } from "./queue.js";
export { editedNote } from "./write-note.js";

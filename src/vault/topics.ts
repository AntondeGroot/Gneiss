/**
 * The tag -> tier mapping seen as a table, and edited a row at a time.
 *
 * The mapping is the primary way tiers are assigned: a row per topic replaces an
 * edit per note, and retunes a whole topic by changing one line. This module is
 * what a settings table renders from — it says which topics exist, which of them
 * carry a mapping of their own, and what each one actually resolves to.
 */

import { tierFromMapping } from "./tier.js";
import type { Tier, TierMapping } from "./types.js";

/** The tier represented by no mapping row at all, and no ancestor row either. */
const DEFAULT_TIER: Tier = "standard";

export interface TopicTier {
  readonly tag: string;
  /** The tier mapped to this exact tag; absent when the row inherits. */
  readonly mapped?: Tier;
  /** What a note carrying this tag resolves to, inheritance included. */
  readonly effective: Tier;
}

/**
 * One row per topic tag, sorted so a hierarchy reads parent-before-child.
 *
 * Rows come from the vault's tags *and* the mapping's keys: a mapped tag the
 * vault no longer uses still has to appear, or a stale row would keep applying
 * with nothing in the table to remove it.
 */
export function topicTiers(topicTags: readonly string[], mapping: TierMapping): TopicTier[] {
  const tags = [...new Set([...topicTags, ...Object.keys(mapping)])].sort((a, b) =>
    a.localeCompare(b),
  );

  return tags.map((tag) => ({
    tag,
    ...(mapping[tag] ? { mapped: mapping[tag] } : {}),
    effective: tierFromMapping([tag], mapping) ?? DEFAULT_TIER,
  }));
}

/**
 * The mapping with one row set, or removed when `tier` is null.
 *
 * Removing is not the same as mapping to `standard`: an explicit `standard` row
 * overrides an ancestor mapped to `core`, whereas no row inherits it.
 */
export function withTopicTier(mapping: TierMapping, tag: string, tier: Tier | null): TierMapping {
  const next = { ...mapping };
  if (tier === null) delete next[tag];
  else next[tag] = tier;
  return next;
}

/** Every topic tag the vault uses, deduplicated — the rows a table starts from. */
export function distinctTopicTags(notes: readonly { topicTags: string[] }[]): string[] {
  return [...new Set(notes.flatMap((note) => note.topicTags))];
}

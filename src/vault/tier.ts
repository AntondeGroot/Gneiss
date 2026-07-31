/**
 * Resolving a note's tier, and turning that tier into an interval multiplier.
 *
 * Tier is not hand-set per note. It resolves in three steps, first match wins:
 *   1. a per-note `#core` / `#optional` tag
 *   2. the tag -> tier mapping, longest matching prefix
 *   3. `standard`
 */

import type { ParsedNote, Tier, TierMapping } from "./types.js";

const DEFAULT_TIER: Tier = "standard";

/** How far `spread` pulls each tier away from `standard`. */
const CORE_COMPRESSION = 0.45;
const OPTIONAL_EXPANSION = 0.8;

export function resolveTier(note: ParsedNote, mapping: TierMapping): Tier {
  return note.tierOverride ?? tierFromMapping(note.topicTags, mapping) ?? DEFAULT_TIER;
}

/**
 * Longest-prefix match, so `#flashcards/lang/certexam` beats `#flashcards/lang`
 * when both are mapped.
 */
function tierFromMapping(topicTags: string[], mapping: TierMapping): Tier | undefined {
  let longestMatch = "";
  let tier: Tier | undefined;

  for (const [prefix, mappedTier] of Object.entries(mapping)) {
    if (!topicTags.some((tag) => isPrefixOf(prefix, tag))) continue;
    if (prefix.length <= longestMatch.length) continue;
    longestMatch = prefix;
    tier = mappedTier;
  }
  return tier;
}

/** A mapping key matches a tag exactly, or as a `/`-delimited ancestor of it. */
function isPrefixOf(prefix: string, tag: string): boolean {
  const lowerTag = tag.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  return lowerTag === lowerPrefix || lowerTag.startsWith(`${lowerPrefix}/`);
}

/**
 * Interval growth multiplier. At `spread` 0 every tier behaves identically —
 * a useful sanity check; at 1, core resurfaces far sooner than optional.
 */
export function tierGrowth(tier: Tier, spread: number): number {
  if (tier === "core") return 1 - CORE_COMPRESSION * spread;
  if (tier === "optional") return 1 + OPTIONAL_EXPANSION * spread;
  return 1;
}
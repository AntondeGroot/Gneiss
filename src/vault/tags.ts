/**
 * Reading and rewriting a note's tags.
 *
 * Vaults written for the Obsidian SR plugin keep tags in a block at the *bottom*
 * of the note rather than in YAML frontmatter, so tier edits rewrite that block.
 */

import type { Tier } from "./types.js";

const TAG = /#[A-Za-z][A-Za-z0-9_/-]*/g;
const TIER_TAG = /#(core|optional)\b/gi;
/** Non-global twin of TIER_TAG — `.test()` on a global regex is stateful. */
const HAS_TIER_TAG = /#(core|optional)\b/i;
const TAG_ONLY_LINE = /^\s*(?:#[A-Za-z][A-Za-z0-9_/-]*\s*)+$/;
const TOPIC_TAG_PREFIX = "#flashcards";

/** The tier that is represented by the *absence* of a tier tag. */
const IMPLICIT_TIER: Tier = "standard";

export function findTags(md: string): string[] {
  return md.match(TAG) ?? [];
}

export function findTopicTags(md: string): string[] {
  return findTags(md).filter((tag) => tag.toLowerCase().startsWith(TOPIC_TAG_PREFIX));
}

/** A per-note `#core` / `#optional` tag, if the note carries one. */
export function findTierOverride(md: string): Tier | undefined {
  const match = md.match(/#(core|optional)\b/i);
  if (!match?.[1]) return undefined;
  return match[1].toLowerCase() as Tier;
}

/** A note joins the deck only when the user tags it — Gneiss never opts one in. */
export function isFlashcardNote(md: string): boolean {
  return findTopicTags(md).length > 0;
}

/**
 * Rewrites the note so its tier tag reflects `tier`, leaving every other byte
 * untouched. `standard` is expressed as the absence of a tag, so it only removes.
 *
 * Notes the user hasn't tagged as flashcards are left alone: they aren't in the
 * deck, so there is no tier to express, and writing a tag into one would mean
 * editing a note the app doesn't own.
 */
export function withTier(md: string, tier: Tier): string {
  if (!isFlashcardNote(md)) return md;

  const withoutTierTag = removeTierTags(md);
  if (tier === IMPLICIT_TIER) return withoutTierTag;
  return appendToTagBlock(withoutTierTag, `#${tier}`);
}

/**
 * Removes tier tags without touching any line that doesn't carry one — a note
 * whose tier is unchanged must come back byte-for-byte identical.
 */
function removeTierTags(md: string): string {
  return md
    .split("\n")
    .map(removeTierTagFromLine)
    .filter((line) => line !== LINE_REMOVED)
    .join("\n");
}

/** Sentinel for a line that held only a tier tag and should disappear entirely. */
const LINE_REMOVED = Symbol("line removed");

function removeTierTagFromLine(line: string): string | typeof LINE_REMOVED {
  if (!HAS_TIER_TAG.test(line)) return line;

  const cleaned = line.replace(TIER_TAG, "").replace(/[ \t]+$/, "");
  const heldNothingElse = cleaned.trim() === "" && line.trim() !== "";
  return heldNothingElse ? LINE_REMOVED : cleaned;
}

function appendToTagBlock(md: string, tag: string): string {
  const lines = md.split("\n");
  const blockStart = findTrailingTagBlockStart(lines);
  if (blockStart === null) return `${md.replace(/\s*$/, "")}\n\n${tag}\n`;

  const lastTagLine = findLastTagLine(lines, blockStart);
  lines[lastTagLine] = `${lines[lastTagLine]?.trimEnd() ?? ""}\n${tag}`;
  return lines.join("\n");
}

/** Index of the first line of the trailing run of tag-only lines, or null if there is none. */
function findTrailingTagBlockStart(lines: string[]): number | null {
  let index = lastNonBlankLine(lines);
  if (index === null || !TAG_ONLY_LINE.test(lines[index] ?? "")) return null;

  while (index > 0 && TAG_ONLY_LINE.test(lines[index - 1] ?? "")) index--;
  return index;
}

function findLastTagLine(lines: string[], blockStart: number): number {
  let index = blockStart;
  while (index + 1 < lines.length && TAG_ONLY_LINE.test(lines[index + 1] ?? "")) index++;
  return index;
}

function lastNonBlankLine(lines: string[]): number | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    if ((lines[index] ?? "").trim() !== "") return index;
  }
  return null;
}
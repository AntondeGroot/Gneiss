/**
 * Gneiss's own settings, stored as `.gneiss/config.md` inside the vault.
 *
 * App config is neither note content nor review state, so it lives in its own
 * file — but inside the vault, so it rides the user's existing sync for free.
 * `.gneiss` is a dotfolder, which VaultService already skips, so this file can
 * never be mistaken for a note.
 *
 * The format is a deliberately small YAML subset: scalars at the top level and
 * one level of indented pairs beneath. That keeps this module dependency-free,
 * which is what lets it lift into any host unchanged.
 */

import { NEVER } from "./streak.js";
import type { CramState, Tier, TierMapping } from "./types.js";

const DELIMITER = "---";
const INDENT = "  ";
const TIERS = "tiers";
const CRAM = "cram";

export interface GneissConfig {
  /** Core emphasis, 0..1. */
  readonly spread: number;
  /** Ceiling on brand-new cards introduced per day, so a big vault cannot flood day one. */
  readonly newPerDay: number;
  /** Consecutive review days, and the day the last review happened. */
  readonly streak: number;
  readonly lastReviewedOn: string;
  readonly tiers: TierMapping;
  readonly cram: CramState | null;
}

export const DEFAULT_CONFIG: GneissConfig = {
  spread: 0.8,
  newPerDay: 8,
  streak: 0,
  lastReviewedOn: NEVER,
  tiers: {},
  cram: null,
};

export function parseConfig(md: string): GneissConfig {
  const sections = readSections(frontmatterOf(md));

  return {
    spread: readSpread(sections.top["spread"]),
    newPerDay: readCount(sections.top["newPerDay"], DEFAULT_CONFIG.newPerDay),
    streak: readCount(sections.top["streak"], DEFAULT_CONFIG.streak),
    lastReviewedOn: sections.top["lastReviewedOn"] ?? NEVER,
    tiers: readTiers(sections.nested[TIERS] ?? {}),
    cram: readCram(sections.nested[CRAM] ?? {}),
  };
}

export function formatConfig(config: GneissConfig): string {
  const lines = [
    DELIMITER,
    `spread: ${config.spread}`,
    `newPerDay: ${config.newPerDay}`,
    `streak: ${config.streak}`,
    `lastReviewedOn: ${config.lastReviewedOn}`,
  ];

  lines.push(`${TIERS}:`);
  for (const [tag, tier] of Object.entries(config.tiers)) {
    lines.push(`${INDENT}"${tag}": ${tier}`);
  }

  if (config.cram) {
    lines.push(`${CRAM}:`);
    lines.push(`${INDENT}active: ${config.cram.active}`);
    lines.push(`${INDENT}scope: "${config.cram.scope}"`);
    lines.push(`${INDENT}examDate: ${config.cram.examDate}`);
  }

  lines.push(DELIMITER, "", ...EXPLANATION, "");
  return lines.join("\n");
}

const EXPLANATION = [
  "# Gneiss",
  "",
  "Settings for the Gneiss flashcard app. Written by the app, and safe to edit by",
  "hand — it is read on the next launch. This file is not a note and produces no",
  "cards.",
];

interface Sections {
  readonly top: Record<string, string>;
  readonly nested: Record<string, Record<string, string>>;
}

function frontmatterOf(md: string): string[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== DELIMITER) return [];

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER);
  return end === -1 ? lines.slice(1) : lines.slice(1, end);
}

/** Splits `key: value` lines into top-level entries and one level of nesting. */
function readSections(lines: string[]): Sections {
  const top: Record<string, string> = {};
  const nested: Record<string, Record<string, string>> = {};
  let current = "";

  for (const line of lines) {
    const pair = splitPair(line);
    if (!pair) continue;

    if (line.startsWith(INDENT)) {
      const section = (nested[current] ??= {});
      section[pair.key] = pair.value;
    } else if (pair.value === "") {
      current = pair.key;
      nested[current] ??= {};
    } else {
      top[pair.key] = pair.value;
    }
  }
  return { top, nested };
}

function splitPair(line: string): { key: string; value: string } | null {
  const separator = line.indexOf(":");
  if (separator === -1) return null;

  const key = unquote(line.slice(0, separator).trim());
  return key ? { key, value: unquote(line.slice(separator + 1).trim()) } : null;
}

function unquote(text: string): string {
  return text.replace(/^["']|["']$/g, "");
}

function readSpread(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) ? clampToUnit(value) : DEFAULT_CONFIG.spread;
}

function readCount(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function clampToUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readTiers(entries: Record<string, string>): TierMapping {
  const tiers: Record<string, Tier> = {};
  for (const [tag, value] of Object.entries(entries)) {
    if (isTier(value)) tiers[tag] = value;
  }
  return tiers;
}

function isTier(value: string): value is Tier {
  return value === "core" || value === "standard" || value === "optional";
}

function readCram(entries: Record<string, string>): CramState | null {
  const scope = entries["scope"];
  const examDate = entries["examDate"];
  if (!scope || !examDate) return null;

  return { active: entries["active"] === "true", scope, examDate };
}

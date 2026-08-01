/**
 * Obsidian markdown -> cards + tags. Pure, with no app dependencies.
 *
 * Recognises the two SR-plugin card forms:
 *   - inline: `Question :: Answer`
 *   - block:  a question, a line containing only `?`, then the answer
 * Fenced code blocks inside an answer are passed through intact.
 */

import { findTierOverride, findTopicTags } from "./tags.js";
import { parseReviewStates, stripReviewComments } from "./review-state.js";
import type { ParsedCard, ParsedNote } from "./types.js";

const BLOCK_SEPARATOR = "?";
const INLINE_SEPARATOR = "::";
const FENCE = "```";
const FRONTMATTER_DELIMITER = "---";
const HEADING_MARKER = /^#+\s*/;
const TIER_TAG = /#(core|optional)\b/gi;

export function parseNote(md: string, filename: string): ParsedNote {
  const normalized = (md ?? "").replace(/\r\n/g, "\n");
  const tierOverride = findTierOverride(normalized);

  return {
    note: filename,
    cards: new CardScanner().scan(bodyLines(normalized)),
    topicTags: findTopicTags(normalized),
    ...(tierOverride ? { tierOverride } : {}),
  };
}

/** Lines after any YAML frontmatter block. */
function bodyLines(md: string): string[] {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) return lines;

  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER,
  );
  return closing === -1 ? lines : lines.slice(closing + 1);
}

/**
 * Walks a note line by line, accumulating an answer buffer and emitting a card
 * whenever a complete question/answer pair closes.
 */
class CardScanner {
  private readonly cards: ParsedCard[] = [];
  private buffer: string[] = [];
  private pendingFront: string | null = null;
  private insideFence = false;

  scan(lines: string[]): ParsedCard[] {
    for (const line of lines) this.consume(line);
    this.flush();
    return this.cards;
  }

  private consume(line: string): void {
    const trimmed = line.trim();

    if (trimmed.startsWith(FENCE)) {
      this.insideFence = !this.insideFence;
      this.buffer.push(line);
      return;
    }
    if (this.insideFence) {
      this.buffer.push(line);
      return;
    }
    if (this.startsInlineCard(trimmed)) {
      this.takeInlineCard(line);
      return;
    }
    if (trimmed === BLOCK_SEPARATOR) {
      this.startBlockAnswer();
      return;
    }
    if (trimmed === "") {
      this.flush();
      return;
    }
    this.buffer.push(line);
  }

  private startsInlineCard(trimmed: string): boolean {
    return this.pendingFront === null && trimmed.includes(INLINE_SEPARATOR);
  }

  private takeInlineCard(line: string): void {
    const separator = line.indexOf(INLINE_SEPARATOR);
    const front = cleanFront(line.slice(0, separator));
    const rest = line.slice(separator + INLINE_SEPARATOR.length);
    this.addCard(front, stripReviewComments(rest).trim(), parseReviewStates(rest));
    this.buffer = [];
  }

  private startBlockAnswer(): void {
    this.pendingFront = cleanFront(this.buffer.join(" ")) || null;
    this.buffer = [];
  }

  private flush(): void {
    if (this.pendingFront !== null) {
      const raw = this.buffer.join("\n");
      this.addCard(this.pendingFront, stripReviewComments(raw).trim(), parseReviewStates(raw));
      this.pendingFront = null;
    }
    this.buffer = [];
  }

  private addCard(
    front: string,
    back: string,
    reviews: ReturnType<typeof parseReviewStates>,
  ): void {
    if (!front || !back) return;
    const review = reviews[0];
    this.cards.push({ front, back, ...(review ? { review } : {}) });
  }
}

function cleanFront(text: string): string {
  return text.replace(HEADING_MARKER, "").replace(TIER_TAG, "").trim();
}

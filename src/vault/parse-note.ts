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

/** Where a card sits in the note, so review state can be written back to it. */
export interface CardLocation {
  readonly front: string;
  /** Inline cards carry their comment on the same line; block cards on the next. */
  readonly kind: "inline" | "block";
  /**
   * First line of the card — the question. With `answerEndLine` this gives the
   * card's whole span, which is what lets a card be rewritten or removed without
   * disturbing a byte of the note around it.
   */
  readonly startLine: number;
  /**
   * Index into the note's lines, counting from the top of the file.
   *
   * Note this is the last line the card *occupies*, which for a block card that
   * already carries review state is the `<!--SR:-->` line rather than the last
   * line of prose — the scanner takes that line as content and strips it from
   * the answer afterwards.
   */
  readonly answerEndLine: number;
}

interface ScanResult {
  readonly cards: ParsedCard[];
  readonly locations: CardLocation[];
}

export function parseNote(md: string, filename: string): ParsedNote {
  const normalized = (md ?? "").replace(/\r\n/g, "\n");
  const tierOverride = findTierOverride(normalized);

  return {
    note: filename,
    cards: scanBody(normalized).cards,
    topicTags: findTopicTags(normalized),
    ...(tierOverride ? { tierOverride } : {}),
  };
}

/**
 * Where each card ends, for write-back. Shares the scanner with `parseNote` so
 * the two can never disagree about where a card is.
 */
export function locateCards(md: string): CardLocation[] {
  return scanBody((md ?? "").replace(/\r\n/g, "\n")).locations;
}

function scanBody(normalized: string): ScanResult {
  const lines = normalized.split("\n");
  const offset = lines.length - bodyLines(normalized).length;
  const result = new CardScanner().scan(bodyLines(normalized));

  // Positions are relative to the body; shift them past any frontmatter so they
  // index the whole file.
  return {
    cards: result.cards,
    locations: result.locations.map((at) => ({
      ...at,
      startLine: at.startLine + offset,
      answerEndLine: at.answerEndLine + offset,
    })),
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
  private readonly locations: CardLocation[] = [];
  private buffer: string[] = [];
  private pendingFront: string | null = null;
  private insideFence = false;
  /** Index of the last line taken as content — where a card's answer ends. */
  private lastContentLine = -1;
  private lineIndex = -1;
  /** Where the current buffer began, and where the pending question began. */
  private bufferStartLine = -1;
  private pendingFrontLine = -1;

  scan(lines: string[]): ScanResult {
    for (const [index, line] of lines.entries()) {
      this.lineIndex = index;
      this.consume(line);
    }
    this.flush();
    return { cards: this.cards, locations: this.locations };
  }

  private consume(line: string): void {
    const trimmed = line.trim();

    // Counted, not matched at the start: a fence glued to the end of a sentence
    // still opens a block, and a line holding both an opening and a closing one
    // leaves the card outside code where it started. Getting this wrong ends the
    // card at the next blank line and truncates its answer.
    const fences = countFences(line);
    if (fences > 0) {
      if (fences % 2 === 1) this.insideFence = !this.insideFence;
      this.take(line);
      return;
    }
    if (this.insideFence) {
      this.take(line);
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
    this.take(line);
  }

  private take(line: string): void {
    if (this.buffer.length === 0) this.bufferStartLine = this.lineIndex;
    this.buffer.push(line);
    this.lastContentLine = this.lineIndex;
  }

  private startsInlineCard(trimmed: string): boolean {
    return this.pendingFront === null && trimmed.includes(INLINE_SEPARATOR);
  }

  private takeInlineCard(line: string): void {
    const separator = line.indexOf(INLINE_SEPARATOR);
    const front = cleanFront(line.slice(0, separator));
    const rest = line.slice(separator + INLINE_SEPARATOR.length);
    this.addCard(front, stripReviewComments(rest).trim(), parseReviewStates(rest), {
      front,
      kind: "inline",
      startLine: this.lineIndex,
      answerEndLine: this.lineIndex,
    });
    this.buffer = [];
  }

  private startBlockAnswer(): void {
    // Joined with newlines, as the answer already is. A space seemed harmless
    // while questions were a single sentence, but it flattens a question that
    // holds a code block into one line — and code without its line breaks is
    // not code. The author's own structure is what gets shown.
    this.pendingFront = cleanFront(this.buffer.join("\n")) || null;
    // The question's first line, held while the answer accumulates below it.
    this.pendingFrontLine = this.bufferStartLine;
    this.buffer = [];
  }

  private flush(): void {
    if (this.pendingFront !== null) {
      const raw = this.buffer.join("\n");
      this.addCard(this.pendingFront, stripReviewComments(raw).trim(), parseReviewStates(raw), {
        front: this.pendingFront,
        kind: "block",
        startLine: this.pendingFrontLine,
        answerEndLine: this.lastContentLine,
      });
      this.pendingFront = null;
    }
    this.buffer = [];
  }

  private addCard(
    front: string,
    back: string,
    reviews: ReturnType<typeof parseReviewStates>,
    location: CardLocation,
  ): void {
    if (!front || !back) return;
    const review = reviews[0];
    this.cards.push({ front, back, ...(review ? { review } : {}) });
    this.locations.push(location);
  }
}

function countFences(line: string): number {
  let count = 0;
  for (let at = line.indexOf(FENCE); at !== -1; at = line.indexOf(FENCE, at + FENCE.length)) {
    count++;
  }
  return count;
}

function cleanFront(text: string): string {
  return text.replace(HEADING_MARKER, "").replace(TIER_TAG, "").trim();
}

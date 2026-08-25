/**
 * Obsidian markdown -> cards + tags. Pure, with no app dependencies.
 *
 * Recognises the two SR-plugin card forms:
 *   - inline: `Question :: Answer`
 *   - block:  a question, a line containing only `?`, then the answer
 * Fenced code blocks inside an answer are passed through intact.
 */

import { BLANK_LINE_MARKER } from "./blank-lines.js";
import { countFences } from "./fences.js";
import { findTierOverride, findTopicTags } from "./tags.js";
import { isReviewCommentLine, parseReviewStates, stripReviewComments } from "./review-state.js";
import type { ParsedCard, ParsedNote, ReviewState } from "./types.js";

const BLOCK_SEPARATOR = "?";
/**
 * The SR plugin's *reversed* card: one card written, two asked — question to
 * answer, and answer back to question. They are genuinely not learned at the
 * same rate, so they are two cards here with a schedule each.
 *
 * Matched exactly rather than by prefix. `??` and `?` differ by one character,
 * and a prefix test would read every one-way card as reversed.
 */
const REVERSED_SEPARATOR = "??";
const INLINE_SEPARATOR = "::";
const FRONTMATTER_DELIMITER = "---";
const HEADING_MARKER = /^#+\s*/;
const TIER_TAG = /#(core|optional)\b/gi;

/** Where a card sits in the note, so review state can be written back to it. */
export interface CardLocation {
  readonly front: string;
  /** Which card with this question this is — see `ParsedCard.occurrence`. */
  readonly occurrence: number;
  /** Which of the three written forms the card takes. */
  readonly kind: "inline" | "block" | "reversed";
  /**
   * Which entry of the card's `<!--SR:-->` comment holds this card's schedule.
   *
   * Always 0 but for the second direction of a reversed card. The comment lists
   * one entry per card it serves, in order, so position is the only thing tying
   * a schedule to a direction — and writing at the wrong index hands a direction
   * the other one's history.
   */
  readonly entry: number;
  /**
   * First line of the card — the question. With `answerEndLine` this gives the
   * card's whole span, which is what lets a card be rewritten or removed without
   * disturbing a byte of the note around it.
   */
  readonly startLine: number;
  /**
   * Index into the note's lines, counting from the top of the file.
   *
   * Note this is the last line the card *occupies*, which for a card that
   * already carries review state is the `<!--SR:-->` line rather than the last
   * line of prose. A block card's comment is taken as content by the scanner and
   * stripped from the answer afterwards; an inline card's is the line below,
   * which the scanner looks ahead to.
   */
  readonly answerEndLine: number;
}

/** Where a card begins and ends, shared by the directions of a reversed one. */
interface Span {
  readonly startLine: number;
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

/**
 * The one card a write is meant for, or nothing when the note no longer holds it.
 *
 * Question text alone is not an identity: a note may ask the same thing twice,
 * and matching on the text would send every write to the first of them. The
 * occurrence is what separates them, and it is counted the same way here as by
 * `parseNote`, so the deck and the note can never disagree about which card is
 * which.
 */
export function locateCard(
  md: string,
  front: string,
  occurrence: number,
): CardLocation | undefined {
  return locateCards(md).find((at) => at.front === front && at.occurrence === occurrence);
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
  private lines: string[] = [];
  private readonly cards: ParsedCard[] = [];
  private readonly locations: CardLocation[] = [];
  private buffer: string[] = [];
  private pendingFront: string | null = null;
  /** Whether the pending question was separated by `??` rather than `?`. */
  private pendingReversed = false;
  private insideFence = false;
  /** Index of the last line taken as content — where a card's answer ends. */
  private lastContentLine = -1;
  private lineIndex = -1;
  /** Where the current buffer began, and where the pending question began. */
  private bufferStartLine = -1;
  private pendingFrontLine = -1;
  /** A comment line already claimed by the inline card above it. */
  private commentLine = -1;

  scan(lines: string[]): ScanResult {
    this.lines = lines;
    for (const [index, line] of lines.entries()) {
      this.lineIndex = index;
      this.consume(line);
    }
    this.flush();
    return { cards: this.cards, locations: this.locations };
  }

  private consume(line: string): void {
    // Already read as the card above it, and not content of anything else.
    if (this.lineIndex === this.commentLine) return;
    if (this.takeFenced(line)) return;

    const trimmed = line.trim();
    if (this.startsInlineCard(trimmed)) {
      this.takeInlineCard(line);
      return;
    }
    if (trimmed === REVERSED_SEPARATOR) {
      this.startBlockAnswer(true);
      return;
    }
    if (trimmed === BLOCK_SEPARATOR) {
      this.startBlockAnswer(false);
      return;
    }
    // The blank line the author asked for, taken as one — see `blank-lines`. It
    // is content, so the card carries on where a real blank line would end it.
    if (trimmed === BLANK_LINE_MARKER) {
      this.take("");
      return;
    }
    if (trimmed === "") {
      this.flush();
      return;
    }
    this.take(line);
  }

  /**
   * Inside a fenced block every line is content, whatever it looks like: a bare
   * `?` there is shell output, not a card's separator.
   */
  private takeFenced(line: string): boolean {
    const fences = countFences(line);
    if (fences > 0) {
      if (fences % 2 === 1) this.insideFence = !this.insideFence;
      this.take(line);
      return true;
    }
    if (!this.insideFence) return false;

    this.take(line);
    return true;
  }

  private take(line: string): void {
    if (this.buffer.length === 0) this.bufferStartLine = this.lineIndex;
    this.buffer.push(line);
    this.lastContentLine = this.lineIndex;
  }

  private startsInlineCard(trimmed: string): boolean {
    return this.pendingFront === null && trimmed.includes(INLINE_SEPARATOR);
  }

  /**
   * An inline card, plus the review comment on the line below it if there is one.
   *
   * The card's span stretches over that line, so everything downstream — reading
   * the state, rewriting the card, removing it — treats the comment as part of
   * the card rather than as loose text that happens to follow it.
   */
  private takeInlineCard(line: string): void {
    const separator = line.indexOf(INLINE_SEPARATOR);
    const front = cleanFront(line.slice(0, separator));
    const below = this.lines[this.lineIndex + 1] ?? "";
    const carriesComment = isReviewCommentLine(below);
    const rest = line.slice(separator + INLINE_SEPARATOR.length) + (carriesComment ? below : "");

    if (carriesComment) this.commentLine = this.lineIndex + 1;
    this.addCard(front, stripReviewComments(rest).trim(), parseReviewStates(rest)[0], {
      front,
      occurrence: this.occurrenceOf(front),
      kind: "inline",
      entry: 0,
      startLine: this.lineIndex,
      answerEndLine: carriesComment ? this.lineIndex + 1 : this.lineIndex,
    });
    this.buffer = [];
  }

  private startBlockAnswer(reversed: boolean): void {
    this.pendingReversed = reversed;
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
      const back = stripReviewComments(raw).trim();
      const reviews = parseReviewStates(raw);
      const span = { startLine: this.pendingFrontLine, answerEndLine: this.lastContentLine };

      if (this.pendingReversed) this.addBothDirections(this.pendingFront, back, reviews, span);
      else this.addOneWay(this.pendingFront, back, reviews[0], span);

      this.pendingFront = null;
      this.pendingReversed = false;
    }
    this.buffer = [];
  }

  /** The `?` form: one card, owning the comment's only entry. */
  private addOneWay(
    front: string,
    back: string,
    review: ReviewState | undefined,
    span: Span,
  ): void {
    this.addCard(front, back, review, {
      front,
      occurrence: this.occurrenceOf(front),
      kind: "block",
      entry: 0,
      ...span,
    });
  }

  /**
   * The `??` form: the card as written, then the same card asked backwards.
   *
   * Emitted in that order because the comment lists its entries in that order,
   * and because the queue serves tying cards in the order they were parsed —
   * which is what has the forward entry already written by the time the reverse
   * direction needs a slot in front of its own.
   */
  private addBothDirections(
    front: string,
    back: string,
    reviews: readonly ReviewState[],
    span: Span,
  ): void {
    this.addCard(
      front,
      back,
      reviews[0],
      { front, occurrence: this.occurrenceOf(front), kind: "reversed", entry: 0, ...span },
      span.startLine,
    );
    this.addCard(
      back,
      front,
      reviews[1],
      { front: back, occurrence: this.occurrenceOf(back), kind: "reversed", entry: 1, ...span },
      span.startLine,
    );
  }

  /**
   * How many cards already emitted ask this same question.
   *
   * Counted over what was *kept*, not over every question seen: a question with
   * no answer never becomes a card, so counting it would offset every later
   * duplicate by one and point writes at the wrong card.
   */
  private occurrenceOf(front: string): number {
    return this.locations.filter((at) => at.front === front).length;
  }

  /**
   * One card, as it is *asked*.
   *
   * Deliberately not `front`/`back`: those name the card the way the note writes
   * it, and a reversed card is precisely the case where the two orders come
   * apart — its second direction asks the note's answer and answers with the
   * note's question. Naming the parameters for the card rather than the note is
   * what makes the swap at that one call site read as intended rather than as a
   * slip.
   */
  private addCard(
    question: string,
    answer: string,
    review: ReviewState | undefined,
    location: CardLocation,
    pair?: number,
  ): void {
    if (!question || !answer) return;
    this.cards.push({
      front: question,
      back: answer,
      occurrence: location.occurrence,
      ...(review ? { review } : {}),
      ...(pair === undefined ? {} : { pair }),
    });
    this.locations.push(location);
  }
}

function cleanFront(text: string): string {
  return text.replace(HEADING_MARKER, "").replace(TIER_TAG, "").trim();
}

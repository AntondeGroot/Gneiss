/**
 * Where a fenced code block opens and closes.
 *
 * Shared rather than counted twice: reading a note decides which lines belong to
 * a card by this, and writing a card back decides which of its lines are code by
 * it. Two copies of the rule would drift, and these two have to agree — a line
 * the reader takes as code and the writer takes as prose is a note that changes
 * shape when it is saved.
 */

/** Opens and closes a fenced block, with the language on the opening line. */
export const FENCE = "```";

/**
 * How many fence markers the line holds.
 *
 * Counted, not matched at the start: a fence glued to the end of a sentence still
 * opens a block, and a line holding both an opening and a closing one leaves the
 * text outside code where it started. Getting this wrong ends a card at the next
 * blank line and truncates its answer.
 */
export function countFences(line: string): number {
  let count = 0;
  for (let at = line.indexOf(FENCE); at !== -1; at = line.indexOf(FENCE, at + FENCE.length)) {
    count++;
  }
  return count;
}

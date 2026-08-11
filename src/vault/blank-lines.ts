/**
 * A lone `.` is a blank line inside a card.
 *
 * A blank line is what *ends* a card, so a card's own text could never hold one:
 * an answer written with a paragraph break in it was read as a short answer
 * followed by some unrelated prose, and half of it went missing. The marker buys
 * the break back — a line holding nothing but a dot is a line the author wants
 * empty.
 *
 * It is a **storage detail, and it stops at the edge of the vault.** Reading a
 * note turns the dot into the blank line it stands for; writing a card back puts
 * it in again. Nothing in between ever meets one — it is not typed in the editor
 * and not shown on a card — so the dot is only ever seen by someone editing the
 * markdown directly, which is the one place it has to be typed.
 *
 * Expanding is done by the scanner in `parse-note`, not here: it is the only
 * place that already knows whether a line is inside a fence, and re-deriving that
 * afterwards would be the same walk a second time. This module is the other half.
 *
 * Inside a fenced block a dot is left alone, because there a line of code that
 * says `.` is a line of code that says `.`. Outside one the ambiguity is real but
 * not worth a rule: a card whose prose is a single full stop on its own line
 * comes back as a blank line. An escape would put a second convention into notes
 * to buy back something nobody writes.
 */

import { countFences } from "./fences.js";

/** What a blank line is written as, in the note. */
export const BLANK_LINE_MARKER = ".";

/** Card text as the note stores it: every blank line spelled out as a dot. */
export function markBlankLines(text: string): string {
  const marked: string[] = [];
  let insideFence = false;

  for (const line of withoutEdgeBlankLines(text.split("\n"))) {
    if (countFences(line) % 2 === 1) insideFence = !insideFence;
    // A fence line is never blank, so toggling first cannot mislabel one.
    marked.push(!insideFence && line.trim() === "" ? BLANK_LINE_MARKER : line);
  }
  return marked.join("\n");
}

/**
 * Blank lines at either end, dropped before anything is marked.
 *
 * A break there separates nothing, and a dot standing for it would be a full stop
 * the card never had. It could not survive a re-read either: parsing trims a
 * card's edges, so the marker would decode back to nothing — the encoder writing
 * into the user's note something the decoder throws straight away.
 *
 * Only the outermost lines go. A blank line inside a fenced block is spacing in
 * someone's code, and a fence cannot be an edge line anyway.
 */
function withoutEdgeBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

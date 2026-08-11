/**
 * What to write back into a note — if anything.
 *
 * Every write Gneiss makes lands in a folder something else is syncing, and a
 * sync tool keeps both versions of a file whenever the two sides moved since it
 * last looked. Gneiss cannot stop the other side moving. What it can do is not be
 * a side that moved for no reason, and it was one in two ways:
 *
 * - **A no-op counted as an edit.** `withReviewState`, `withEditedCard` and
 *   `withoutCard` all hand the note straight back when no card carries that
 *   question, and a grade re-applied after a vault read is often byte-identical.
 *   Writing those touches the file's timestamp with nothing to show for it, which
 *   can only ever manufacture a conflict — it can never resolve one.
 * - **A note written on Windows came back rewritten end to end.** The transforms
 *   work in `\n` and normalise the whole file on the way in, so the one card that
 *   changed arrived as a diff across every line of the note.
 *
 * Both are the same mistake — writing more than was meant — so both are answered
 * here, at the one point that knows what the file said before.
 */

const CRLF = "\r\n";
const ANY_LINE_END = /\r?\n/g;

/**
 * The note as it should be written, or `null` when the transform changed nothing
 * and the right thing to write is nothing at all.
 */
export function editedNote(original: string, transform: (md: string) => string): string | null {
  const edited = asWrittenIn(original, transform(original));
  return edited === original ? null : edited;
}

/**
 * The rewrite, in the line endings the note itself uses.
 *
 * A note holding CRLF anywhere is written back with CRLF throughout. That does
 * normalise a file of mixed endings, which is a change of its own — but a mixed
 * note is already inconsistent, and the alternative is guessing per line.
 */
function asWrittenIn(original: string, edited: string): string {
  return original.includes(CRLF) ? edited.replace(ANY_LINE_END, CRLF) : edited;
}

/**
 * Finding the images inside a card.
 *
 * Obsidian writes an embed two ways: `![[diagram.png]]`, which is what pasting
 * an image produces, and `![alt](assets/diagram.png)`. Both are plain text as far
 * as the parser is concerned — it passes them through the same way it passes
 * through fenced code — so a card has always *carried* its images. Only showing
 * them was missing.
 *
 * This splits a card into the pieces a screen can render: prose as it stands,
 * and embeds as something to go and load.
 */

/**
 * A wikilink, or the markdown form.
 *
 * The `!` that makes a wikilink an embed is deliberately *not* in the pattern:
 * as an optional prefix it lets the engine try both ways at every bracket, and
 * as a second alternative it overlaps the first. The character before the match
 * answers the same question for nothing.
 *
 * Newlines are excluded and the lengths are capped because an embed never spans
 * lines and a file name is never 300 characters. Both keep an unclosed bracket
 * from dragging the search across the whole answer, which on a card holding a
 * long code block is work for nothing.
 */
const EMBED = /\[\[([^\]\n]{1,300})]]|!\[([^\]\n]{0,300})]\(([^)\n]{1,300})\)/g;

export type CardSegment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "embed";
      readonly target: string;
      readonly alt: string;
      /**
       * Whether the note said `!` — an instruction to embed, rather than a link
       * that merely happens to name a file.
       */
      readonly embedded: boolean;
      /** As written, so a link that turns out not to be a file can be shown again. */
      readonly raw: string;
    };

/**
 * The card in order: prose, embeds, prose.
 *
 * An embed is a *candidate*, not a decided image — whether one resolves to a
 * picture depends on what the vault holds, which only the vault knows. Text
 * either side is kept exactly as written, so code blocks and spacing are
 * untouched; nothing here reformats a note.
 */
export function splitEmbeds(text: string): CardSegment[] {
  const segments: CardSegment[] = [];
  let from = 0;

  for (const match of text.matchAll(EMBED)) {
    const embedded = match[1] !== undefined && text[match.index - 1] === "!";
    const embed = toEmbed(match, embedded);

    // The `!` belongs to the embed, so it must not be left behind as prose.
    addText(segments, text.slice(from, embedded ? match.index - 1 : match.index));
    segments.push(embed);
    from = match.index + match[0].length;
  }

  addText(segments, text.slice(from));
  return segments;
}

function addText(segments: CardSegment[], text: string): void {
  const trimmed = withoutEdgeBlankLines(text);
  if (trimmed !== "") segments.push({ kind: "text", text: trimmed });
}

/**
 * Drops the blank lines an embed leaves behind, without touching the spacing
 * inside — a code block's own indentation is content.
 *
 * Walked rather than matched: an anchored `\n+` either side backtracks on a long
 * run of newlines, and a card's answer is arbitrary text from a file.
 */
function withoutEdgeBlankLines(text: string): string {
  let start = 0;
  let end = text.length;

  while (start < end && text[start] === "\n") start++;
  while (end > start && text[end - 1] === "\n") end--;
  return text.slice(start, end);
}

/**
 * What this match points at.
 *
 * Every wikilink is offered as a possible image, whatever it is called. Guessing
 * from the extension was wrong: a file pasted as `.pgn` — one keystroke off
 * `.png` — is still a picture, and no list of extensions is ever complete. What
 * settles it is whether the vault holds a file by that name, which only the
 * vault can answer, so the question is passed on rather than decided here.
 */
function toEmbed(match: RegExpMatchArray, embedded: boolean): CardSegment {
  const wikilink = match[1];
  if (wikilink !== undefined) {
    // `![[diagram.png|300]]` sets a display width. The size is Obsidian's
    // business; the file name is what has to be found.
    const [named = ""] = wikilink.split("|");
    const target = named.trim();
    return { kind: "embed", target, alt: target, embedded, raw: match[0] };
  }

  const target = match[3] ?? "";
  return {
    kind: "embed",
    target: decodeTarget(target.trim()),
    alt: match[2] ?? "",
    embedded: true,
    raw: match[0],
  };
}

/**
 * Markdown links percent-encode spaces, which a file name does not have. Left
 * alone for anything with a scheme: an external URL has to stay as written.
 */
function decodeTarget(target: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;

  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

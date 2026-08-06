/**
 * Cutting a card into the pieces a screen can render.
 *
 * A card's text arrives from the note untouched — `parseNote` passes embeds and
 * fenced code through exactly as written — so everything needed is already
 * there, and this is where it gets taken apart:
 *
 * - **prose**, shown as it stands
 * - **code**, which reads as code and should look like it
 * - **embeds**, which are candidates to go and load
 *
 * Nothing here reformats a note; every piece keeps the bytes it came with.
 */

/** Opens and closes a fenced block, with the language on the opening line. */
const FENCE = "```";
/** Opens and closes an inline code span. */
const TICK = "`";
/** Opens and closes bold. */
const BOLD = "**";
/** `- [ ]` or `- [x]` — a checklist line. */
const TASK = /^\s*-\s*\[([ xX])]\s?(.*)$/;

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

/** A run of prose, or a marked-up span inside it. */
export type InlinePart =
  | { readonly kind: "words"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "bold"; readonly text: string };

/** One `- [ ]` line, with its own inline marks. */
export interface TaskItem {
  readonly done: boolean;
  readonly parts: readonly InlinePart[];
}

export type CardSegment =
  | {
      readonly kind: "text";
      readonly text: string;
      /** The same text, with its inline code spans separated out. */
      readonly parts: readonly InlinePart[];
    }
  | {
      readonly kind: "code";
      readonly code: string;
      /** Whatever followed the opening fence, e.g. `sh`. Empty when unlabelled. */
      readonly language: string;
    }
  | { readonly kind: "tasks"; readonly items: readonly TaskItem[] }
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
 * The card in order: prose, code, images.
 *
 * Fences are found first, because a `![[…]]` inside a code block is a line of
 * code and not a picture — splitting embeds out of the whole card would show a
 * snippet's own example as an image.
 *
 * A fence is taken **wherever it appears**, not only at the start of a line.
 * Strict markdown wants one on its own line, but notes are written quickly and a
 * block glued to the end of a sentence is plainly meant as code. Splitting on
 * the marker also keeps this linear: the parts simply alternate, outside the
 * fence and in.
 */
export function splitCard(text: string): CardSegment[] {
  return text.split(FENCE).flatMap((part, index) =>
    // Every odd part sits between two fences, so it is code. An unclosed fence
    // leaves a final odd part, which still reads as code — the note meant it
    // that way, and a stray ``` in the prose helps nobody.
    index % 2 === 0 ? splitEmbeds(part) : [toCode(part)],
  );
}

/** The inside of a fence: an opening line naming the language, then the code. */
function toCode(inside: string): CardSegment {
  const firstLine = inside.indexOf("\n");
  // No line break at all means it was written inline — all of it is the code,
  // and there is no room for a language to have been named.
  if (firstLine === -1) return { kind: "code", code: inside, language: "" };

  return {
    kind: "code",
    code: withoutEdgeBlankLines(inside.slice(firstLine + 1)),
    language: inside.slice(0, firstLine).trim().split(/\s+/)[0] ?? "",
  };
}

/** The prose between fences, with its images pulled out. */
function splitEmbeds(text: string): CardSegment[] {
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
  if (trimmed === "") return;

  // Prose renders as one pre-wrapped block, so a checklist inside it would keep
  // its literal `- [ ]`. Splitting the run at those lines is what lets the list
  // become a list while the sentences around it stay exactly as written.
  let prose: string[] = [];
  let items: TaskItem[] = [];

  const flushProse = (): void => {
    const text = prose.join("\n");
    prose = [];
    // A blank run is the gap between a paragraph and a list, and each segment
    // already carries its own spacing — keeping it would double that gap.
    if (text.trim() !== "") segments.push({ kind: "text", text, parts: splitInline(text) });
  };
  const flushTasks = (): void => {
    if (items.length > 0) segments.push({ kind: "tasks", items });
    items = [];
  };

  for (const line of trimmed.split("\n")) {
    const task = TASK.exec(line);
    if (task) {
      flushProse();
      items.push({ done: task[1] !== " ", parts: splitInline(task[2] ?? "") });
    } else {
      flushTasks();
      prose.push(line);
    }
  }

  // Each branch empties the other, so only the run that ended the text is left.
  flushTasks();
  flushProse();
}

/**
 * Prose broken around its `backticked` spans.
 *
 * Single backticks are inline code — a flag or a method name inside a sentence —
 * and belong in the line rather than in a block of their own. Triple fences have
 * already been taken out by `splitCard`, so nothing here can meet one.
 *
 * A lone backtick with no partner stays as written: it is punctuation in a
 * sentence, not the start of something.
 */
export function splitInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let from = 0;

  for (;;) {
    const found = nextMark(text, from);
    if (!found) break;

    if (found.at > from) parts.push({ kind: "words", text: text.slice(from, found.at) });
    parts.push({
      kind: found.mark === TICK ? "code" : "bold",
      text: text.slice(found.at + found.mark.length, found.close),
    });
    from = found.close + found.mark.length;
  }

  if (from < text.length) parts.push({ kind: "words", text: text.slice(from) });
  return parts;
}

/**
 * The next span that is actually closed, whichever mark opens first.
 *
 * Taking the earliest is what keeps a `**` inside a code span literal: the
 * backtick opens first, so everything up to its partner is swallowed as code
 * before the asterisks are ever considered.
 */
function nextMark(text: string, from: number): { at: number; close: number; mark: string } | null {
  let best: { at: number; close: number; mark: string } | null = null;

  for (const mark of [TICK, BOLD]) {
    const at = text.indexOf(mark, from);
    if (at === -1) continue;

    const close = text.indexOf(mark, at + mark.length);
    // An opener with no partner is punctuation, not markup.
    if (close === -1) continue;
    if (!best || at < best.at) best = { at, close, mark };
  }
  return best;
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

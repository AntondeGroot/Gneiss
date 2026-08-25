/**
 * Lining two sequences up, so what changed can be described in runs.
 *
 * Used to compare two versions of a note card by card. A longest-common-
 * subsequence walk rather than anything cleverer: notes are hundreds of cards,
 * not millions of lines, and the property that matters here is that unchanged
 * cards stay matched even when others are inserted around them.
 *
 * A deletion immediately followed by an insertion is reported as one `replace`,
 * because that is what a person did — they changed a card, rather than removing
 * one and adding another. The distinction reaches the screen: a `replace` is a
 * choice between two versions, while a lone `delete` is a card that only one
 * side has.
 */

export type Tag = "equal" | "replace" | "delete" | "insert";

/** A run of the alignment: `a[i1..i2)` against `b[j1..j2)`. */
export interface Op {
  readonly tag: Tag;
  readonly i1: number;
  readonly i2: number;
  readonly j1: number;
  readonly j2: number;
}

export function opcodes(a: readonly string[], b: readonly string[]): Op[] {
  return coalesce(walk(a, b, commonLengths(a, b)));
}

/**
 * `table[i][j]` = the longest common subsequence of `a[i..]` and `b[j..]`.
 *
 * Filled from the end so the forward walk can ask "does keeping `a[i]` or
 * `b[j]` leave more in common?" without recomputing anything. One flat array
 * rather than nested ones — this is the only part of the module that is hot.
 */
function commonLengths(a: readonly string[], b: readonly string[]): Int32Array {
  const width = b.length + 1;
  const table = new Int32Array((a.length + 1) * width);

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  return table;
}

/** One op per element, before neighbouring ones are joined up. */
function walk(a: readonly string[], b: readonly string[], table: Int32Array): Op[] {
  const width = b.length + 1;
  const ops: Op[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ tag: "equal", i1: i, i2: i + 1, j1: j, j2: j + 1 });
      i++;
      j++;
      // A tie keeps the left-hand element first, so a changed card reads as
      // "mine became theirs" rather than the other way round.
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push({ tag: "delete", i1: i, i2: i + 1, j1: j, j2: j });
      i++;
    } else {
      ops.push({ tag: "insert", i1: i, i2: i, j1: j, j2: j + 1 });
      j++;
    }
  }

  if (i < a.length) ops.push({ tag: "delete", i1: i, i2: a.length, j1: j, j2: j });
  if (j < b.length) ops.push({ tag: "insert", i1: i, i2: i, j1: j, j2: b.length });

  return ops;
}

/** Runs of the same tag join up, and delete-then-insert becomes one replace. */
function coalesce(ops: readonly Op[]): Op[] {
  const out: Op[] = [];

  for (const op of ops) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(op);
      continue;
    }

    if (last.tag === op.tag) out[out.length - 1] = joined(last, op);
    else if (isChange(last, op)) out[out.length - 1] = { ...joined(last, op), tag: "replace" };
    else out.push(op);
  }

  return out;
}

function isChange(last: Op, op: Op): boolean {
  const changed = last.tag === "replace" || last.tag === "delete";
  return changed && op.tag === "insert";
}

function joined(last: Op, op: Op): Op {
  return { tag: last.tag, i1: last.i1, i2: op.i2, j1: last.j1, j2: op.j2 };
}

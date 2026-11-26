/**
 * What a review session is drawing on.
 *
 * The whole deck is what Today starts. A topic is the same session narrowed to
 * one subject, still only what is due. Practice is the one that reaches past
 * the due date, for a topic known to be weak — see `practiceQueue`.
 *
 * Kept with the session rather than chosen afresh each time, so "Another
 * session" carries on with the subject that was picked instead of quietly
 * widening back out to everything.
 */
export type Focus =
  | { readonly kind: "deck" }
  | { readonly kind: "topic"; readonly scope: string }
  | { readonly kind: "practice"; readonly scope: string };

export const WHOLE_DECK: Focus = { kind: "deck" };

/** Checks a focus read back off the device rather than trusting its shape. */
export function readFocus(value: unknown): Focus {
  if (typeof value !== "object" || value === null) return WHOLE_DECK;

  const { kind, scope } = value as { kind?: unknown; scope?: unknown };
  if ((kind === "topic" || kind === "practice") && typeof scope === "string") {
    return { kind, scope };
  }
  return WHOLE_DECK;
}

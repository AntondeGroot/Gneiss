/**
 * Deep links back into Obsidian.
 *
 * Gneiss reads a vault; it does not manage one. When a note turns out to be
 * stale — a whole topic from a job you have left — the right move is to hand
 * over to Obsidian, which can delete a file or a folder properly and fix the
 * links that pointed at it. Reimplementing a file manager against a vault the
 * app deliberately only reads would be the wrong tool and the wrong risk.
 *
 * Format per Obsidian's own documentation: every value URI-encoded, including
 * the path separators, which is why `encodeURIComponent` is right here and
 * `encodeURI` is not.
 */

/**
 * A link that opens `notePath` inside the vault named `vaultName`.
 *
 * Returns an empty string when either is missing, so a caller with no vault name
 * — a source that cannot say — offers no button rather than a broken one.
 */
export function obsidianNoteUri(vaultName: string, notePath: string): string {
  if (!vaultName || !notePath) return "";

  const file = notePath.replace(/\.md$/i, "");
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}

/** The folder holding a note, for showing where it lives. Empty at the vault root. */
export function folderOf(notePath: string): string {
  const cut = notePath.lastIndexOf("/");
  return cut === -1 ? "" : notePath.slice(0, cut);
}

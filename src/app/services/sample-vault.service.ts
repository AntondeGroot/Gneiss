import { Injectable } from "@angular/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import { formatConfig } from "../../vault";
import type { GneissConfig } from "../../vault";

/**
 * Writes a small sample vault to the filesystem.
 *
 * Development aid, not a product feature. On the web, Capacitor's Filesystem is
 * backed by IndexedDB rather than the real disk, so there is no Obsidian vault to
 * read in a browser — this seeds one so the read path can be exercised for real
 * rather than mocked.
 *
 * TODO: drop this once the app reads a genuine synced folder on device.
 */
@Injectable({ providedIn: "root" })
export class SampleVaultService {
  async seed(root: string): Promise<void> {
    for (const [relativePath, contents] of Object.entries(SAMPLE_NOTES)) {
      await this.write(`${root}/${relativePath}`, contents);
    }
    await this.write(`${root}/.gneiss/config.md`, formatConfig(SAMPLE_CONFIG));
  }

  private async write(path: string, data: string): Promise<void> {
    await Filesystem.writeFile({
      path,
      data,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }
}

/** Mirrors the sample notes below, so the seeded vault shows real tier spread. */
const SAMPLE_CONFIG: GneissConfig = {
  spread: 0.8,
  newPerDay: 8,
  tiers: {
    "#flashcards/git": "core",
    "#flashcards/shell": "core",
    "#flashcards/tools": "standard",
    "#flashcards/lang": "standard",
  },
  cram: null,
};

/** Deliberately varied: both card syntaxes, a subfolder, a tier override, prior review state. */
const SAMPLE_NOTES: Record<string, string> = {
  "grep.md": `# grep

Recursively search every file under the current dir? :: grep -r "pattern" .

Show line numbers alongside matches?
?
grep -n "pattern" file
<!--SR:!2026-08-21,3,250-->

Print only the lines that do NOT match? :: grep -v "pattern" file

#flashcards/shell
`,

  "git.md": `# git

Unstage a file you already added? :: git restore --staged <file>
Change the most recent commit message? :: git commit --amend

Create a branch and switch to it in one step?
?
git switch -c <branch>

#flashcards/git
`,

  "Tools/docker.md": `List running containers? :: docker ps
Follow a container's logs? :: docker logs -f <container>

#flashcards/tools
`,

  "Lang/generics.md": `# Generics

What does \`<? extends Number>\` let you do?
?
Read Numbers out (producer). You cannot safely add.

#flashcards/lang
#optional
`,
};

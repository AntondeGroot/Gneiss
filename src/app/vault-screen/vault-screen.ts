import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { resolveTier } from "../../vault";
import type { ParsedNote, Tier, TierMapping } from "../../vault";
import { SampleVaultService } from "../services/sample-vault.service";
import { VaultService } from "../services/vault.service";

// TODO: belongs in .gneiss/config.md inside the vault, so it syncs with the notes.
const TIER_MAPPING: TierMapping = {
  "#flashcards/git": "core",
  "#flashcards/shell": "core",
  "#flashcards/tools": "standard",
  "#flashcards/lang": "standard",
};

export interface NoteView {
  readonly note: ParsedNote;
  readonly tier: Tier;
}

@Component({
  selector: "gn-vault-screen",
  imports: [FormsModule],
  templateUrl: "./vault-screen.html",
  styleUrl: "./vault-screen.scss",
})
export class VaultScreen {
  private readonly vault = inject(VaultService);
  private readonly samples = inject(SampleVaultService);

  protected readonly path = signal("Vault");
  protected readonly notes = signal<readonly NoteView[]>([]);
  protected readonly status = signal("Nothing read yet.");
  protected readonly busy = signal(false);
  protected readonly expanded = signal<string | null>(null);

  protected onLoad(): void {
    void this.load();
  }

  protected onSeed(): void {
    void this.seed();
  }

  protected toggle(name: string): void {
    this.expanded.update((current) => (current === name ? null : name));
  }

  protected cardCount(): number {
    return this.notes().reduce((total, view) => total + view.note.cards.length, 0);
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      const parsed = await this.vault.readNotes(this.path());
      this.notes.set(parsed.map(toView));
      this.status.set(describeResult(parsed.length, this.cardCount()));
    } catch (error) {
      this.notes.set([]);
      this.status.set(`Could not read "${this.path()}" — ${messageOf(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  private async seed(): Promise<void> {
    this.busy.set(true);
    await this.samples.seed(this.path());
    this.busy.set(false);
    await this.load();
  }
}

function toView(note: ParsedNote): NoteView {
  return { note, tier: resolveTier(note, TIER_MAPPING) };
}

function describeResult(notes: number, cards: number): string {
  if (notes === 0) return "No markdown notes found in that folder.";
  return `${notes} note${plural(notes)} · ${cards} card${plural(cards)}`;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

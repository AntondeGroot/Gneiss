import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";

import type { Tier } from "../../vault";
import { DeckService } from "../services/deck.service";
import type { DeckCard } from "../services/deck.service";
import { FolderPickerService } from "../services/folder-picker.service";
import { SampleVaultService } from "../services/sample-vault.service";

export interface NoteGroup {
  readonly note: string;
  readonly tier: Tier;
  readonly cards: readonly DeckCard[];
}

@Component({
  selector: "gn-vault-screen",
  imports: [FormsModule, RouterLink],
  templateUrl: "./vault-screen.html",
  styleUrl: "./vault-screen.scss",
})
export class VaultScreen {
  private readonly deck = inject(DeckService);
  private readonly samples = inject(SampleVaultService);
  private readonly picker = inject(FolderPickerService);

  protected readonly canPickFolder = this.picker.supported;

  protected readonly path = signal("Vault");
  protected readonly status = signal("Nothing read yet.");
  protected readonly busy = signal(false);
  protected readonly expanded = signal<string | null>(null);

  protected readonly notes = computed(() => groupByNote(this.deck.all()));
  protected readonly dueCount = computed(() => this.deck.due().length);

  protected onLoad(): void {
    void this.load();
  }

  protected onSeed(): void {
    void this.seed();
  }

  protected onOpenFolder(): void {
    void this.openFolder();
  }

  protected toggle(note: string): void {
    this.expanded.update((current) => (current === note ? null : note));
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      await this.deck.load(this.path());
      this.status.set(describeResult(this.notes().length, this.deck.all().length));
    } catch (error) {
      this.status.set(`Could not read "${this.path()}" — ${messageOf(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  /** Read-only: nothing is written back to a folder opened this way. */
  private async openFolder(): Promise<void> {
    this.busy.set(true);
    try {
      const notes = await this.picker.pickAndRead();
      this.deck.setNotes(notes);
      this.status.set(`${describeResult(this.notes().length, this.deck.all().length)} · read-only`);
    } catch (error) {
      this.status.set(`Could not open that folder — ${messageOf(error)}`);
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

function groupByNote(cards: readonly DeckCard[]): NoteGroup[] {
  const groups = new Map<string, DeckCard[]>();
  for (const card of cards) {
    const existing = groups.get(card.note);
    if (existing) existing.push(card);
    else groups.set(card.note, [card]);
  }
  return [...groups].map(([note, grouped]) => ({
    note,
    tier: grouped[0]?.tier ?? "standard",
    cards: grouped,
  }));
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

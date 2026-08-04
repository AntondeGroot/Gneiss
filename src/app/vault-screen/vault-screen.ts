import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";

import type { Tier } from "../../vault";
import { DeckService } from "../services/deck.service";
import type { DeckCard } from "../services/deck.service";
import { CardBody } from "../card-body/card-body";
import { AndroidVaultSource } from "../services/android-vault.source";
import { BrowserVaultSource } from "../services/browser-vault.source";
import { CapacitorVaultSource } from "../services/capacitor-vault.source";
import { SampleVaultService } from "../services/sample-vault.service";

/** Rows drawn at once. Search reaches whatever is past this. */
const SHOWN = 60;

export type TierFilter = Tier | "all";
const TIER_CHOICES: readonly TierFilter[] = ["all", "core", "standard", "optional"];

export interface NoteGroup {
  readonly note: string;
  readonly tier: Tier;
  readonly cards: readonly DeckCard[];
}

@Component({
  selector: "gn-vault-screen",
  imports: [FormsModule, RouterLink, CardBody],
  templateUrl: "./vault-screen.html",
  styleUrl: "./vault-screen.scss",
})
export class VaultScreen {
  private readonly deck = inject(DeckService);
  private readonly samples = inject(SampleVaultService);
  private readonly deviceSource = inject(CapacitorVaultSource);
  private readonly browserSource = inject(BrowserVaultSource);
  private readonly androidSource = inject(AndroidVaultSource);

  /**
   * Both platforms offer the same thing — pick a folder once — so the button is
   * one button, and which source answers it is not the screen's business.
   */
  private readonly folderSource = this.androidSource.isAvailable()
    ? this.androidSource
    : this.browserSource;

  protected readonly canPickFolder = this.folderSource.isAvailable();
  /** On Android the device path box is meaningless: the picker owns the folder. */
  protected readonly canReadByPath = !this.androidSource.isAvailable();
  protected readonly sourceLabel = this.deck.sourceLabel;
  protected readonly canWrite = this.deck.canWrite;

  protected readonly path = signal("Vault");
  protected readonly status = signal("Nothing read yet.");
  protected readonly busy = signal(false);
  protected readonly expanded = signal<string | null>(null);

  protected readonly notes = computed(() => groupByNote(this.deck.all()));

  /** What has been typed, and what has actually been searched for. */
  protected readonly search = signal("");
  protected readonly query = signal("");
  protected readonly tier = signal<TierFilter>("all");
  protected readonly tierChoices = TIER_CHOICES;

  /** Notes matching the tier and the search, before the list is trimmed. */
  protected readonly matching = computed(() => {
    const wanted = this.tier();
    const query = this.query().toLowerCase();

    return this.notes().filter(
      (group) =>
        (wanted === "all" || group.tier === wanted) &&
        (query === "" || group.note.toLowerCase().includes(query)),
    );
  });

  /**
   * The rows actually drawn.
   *
   * A real vault runs to hundreds of notes, and putting every one in the DOM
   * costs more than anyone gains from scrolling past them. Search is how you
   * reach the rest, which is why it exists.
   */
  protected readonly shown = computed(() => this.matching().slice(0, SHOWN));
  protected readonly beyond = computed(() => this.matching().length - this.shown().length);
  protected readonly filtered = computed(() => this.query() !== "" || this.tier() !== "all");
  protected readonly dueCount = computed(() => this.deck.due().length);
  protected readonly reading = this.deck.reading;

  /**
   * What the screen says about progress. While a vault is still being walked it
   * counts up, because a still figure on a slow read is what makes the app look
   * stuck — the point of loading in batches is that there is something to show.
   */
  protected readonly progress = computed(() =>
    this.reading()
      ? `Reading… ${describeResult(this.notes().length, this.deck.all().length)}`
      : this.status(),
  );

  /**
   * Applies what was typed.
   *
   * On a button rather than as you type: filtering hundreds of notes on every
   * keystroke is work the phone can feel, and a search here is usually one
   * deliberate look for one note.
   */
  protected applySearch(): void {
    this.query.set(this.search().trim());
  }

  protected clearSearch(): void {
    this.search.set("");
    this.query.set("");
  }

  protected showTier(tier: TierFilter): void {
    this.tier.set(tier);
  }

  protected onLoad(): void {
    void this.load();
  }

  protected onSeed(): void {
    void this.seed();
  }

  protected onOpenFolder(): void {
    void this.openFolder("");
  }

  protected toggle(note: string): void {
    this.expanded.update((current) => (current === note ? null : note));
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      await this.deck.open(this.deviceSource, this.path());
      this.status.set(describeResult(this.notes().length, this.deck.all().length));
    } catch (error) {
      this.status.set(`Could not read "${this.path()}" — ${messageOf(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  private async openFolder(location: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.deck.open(this.folderSource, location);
      this.status.set(describeResult(this.notes().length, this.deck.all().length));
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

import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { schedule } from "../../vault";
import type { GneissConfig, Tier } from "../../vault";
import { DeckService } from "../services/deck.service";
import { ReminderService } from "../services/reminder.service";

/** The card the preview is computed against: an established one, graded Medium. */
const SAMPLE_INTERVAL = 10;
const SAMPLE_EASE = 2.5;
const PREVIEW_TIERS: readonly Tier[] = ["core", "standard", "optional"];

export interface TierPreview {
  readonly tier: Tier;
  readonly days: number;
}

@Component({
  selector: "gn-settings-screen",
  imports: [FormsModule],
  templateUrl: "./settings-screen.html",
  styleUrl: "./settings-screen.scss",
})
export class SettingsScreen {
  private readonly deck = inject(DeckService);
  private readonly reminders = inject(ReminderService);

  /** Edited locally, then committed on save — so a half-typed value never persists. */
  protected readonly draft = signal<GneissConfig>(this.deck.config());
  protected readonly saving = signal(false);
  protected readonly message = signal("");

  /**
   * What a ten-day card would grow to at the current emphasis, per tier.
   * Recomputed as the slider moves, so the abstract number has a visible meaning.
   */
  protected readonly preview = computed<TierPreview[]>(() =>
    PREVIEW_TIERS.map((tier) => ({
      tier,
      days: schedule({ due: "", interval: SAMPLE_INTERVAL, ease: SAMPLE_EASE }, "medium", {
        tier,
        spread: this.draft().spread,
        today: "2026-01-01",
        topicTags: [],
        cram: null,
      }).interval,
    })),
  );

  protected update<K extends keyof GneissConfig>(key: K, value: GneissConfig[K]): void {
    this.draft.update((config) => ({ ...config, [key]: value }));
  }

  protected onNumber(key: "spread" | "newPerDay" | "reviewsPerDay", value: string): void {
    this.update(key, Number(value));
  }

  protected onSave(): void {
    void this.save();
  }

  private async save(): Promise<void> {
    this.saving.set(true);
    const config = this.draft();
    try {
      await this.deck.saveConfig(config);
      await this.reminders.apply(config.reminderOn, config.reminderAt);
      this.message.set("Saved to .gneiss/config.md in the vault.");
    } catch (error) {
      // The config still saved; only the reminder failed. Say which.
      this.message.set(`Saved, but the reminder could not be set — ${messageOf(error)}`);
    } finally {
      this.saving.set(false);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

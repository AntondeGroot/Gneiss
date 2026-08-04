import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { DEFAULT_CRAM_PER_SESSION, schedule, topicTiers, withTopicTier } from "../../vault";
import type { CramState, GneissConfig, Tier } from "../../vault";
import { DeckService } from "../services/deck.service";
import { ReminderService } from "../services/reminder.service";

/** The card the preview is computed against: an established one, graded Medium. */
const SAMPLE_INTERVAL = 10;
const SAMPLE_EASE = 2.5;
const PREVIEW_TIERS: readonly Tier[] = ["core", "standard", "optional"];

/** The choices offered per topic. `null` is "inherit", which is not the same as `standard`. */
export const TOPIC_CHOICES: readonly (Tier | null)[] = [null, "core", "standard", "optional"];

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

  /** A row per topic tag in the vault — the primary way tiers get assigned. */
  protected readonly topics = computed(() => topicTiers(this.deck.topicTags(), this.draft().tiers));

  protected readonly choices = TOPIC_CHOICES;

  /** Angular templates cannot call global functions, and the number input hands back a string. */
  protected readonly Number = Number;

  /**
   * Patches one field of the cram, filling in a blank one on first touch. Kept
   * here rather than in the template so enabling a cram cannot half-build it.
   */
  protected updateCram(patch: Partial<CramState>): void {
    const current: CramState = this.draft().cram ?? {
      active: false,
      scope: "",
      examDate: "",
      perSession: DEFAULT_CRAM_PER_SESSION,
    };
    this.update("cram", { ...current, ...patch });
  }

  protected setTopicTier(tag: string, tier: Tier | null): void {
    this.update("tiers", withTopicTier(this.draft().tiers, tag, tier));
  }

  protected update<K extends keyof GneissConfig>(key: K, value: GneissConfig[K]): void {
    this.draft.update((config) => ({ ...config, [key]: value }));
  }

  protected onNumber(
    key: "spread" | "newPerSession" | "reviewsPerSession" | "cramMinPasses",
    value: string,
  ): void {
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
      await this.reminders.apply(config, this.deck.sessionDoneToday());
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

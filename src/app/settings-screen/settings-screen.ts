import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { daysBetween, schedule, topicTiers, withTopicTier } from "../../vault";
import type { CramState, GneissConfig, Tier } from "../../vault";
import { ExamDialog } from "../exam-dialog/exam-dialog";
import { DeckService } from "../services/deck.service";
import { today } from "../services/clock.service";
import { ReminderService } from "../services/reminder.service";

/** The card the preview is computed against: an established one, graded Medium. */
const SAMPLE_INTERVAL = 10;
const SAMPLE_EASE = 2.5;
const PREVIEW_TIERS: readonly Tier[] = ["core", "standard", "optional"];

/** The choices offered per topic. `null` is "inherit", which is not the same as `standard`. */
export const TOPIC_CHOICES: readonly (Tier | null)[] = [null, "core", "standard", "optional"];

/** What the dialog is opened on when there is no exam yet to edit. */
const NEW = "new" as const;

export interface TierPreview {
  readonly tier: Tier;
  readonly days: number;
}

@Component({
  selector: "gn-settings-screen",
  imports: [FormsModule, ExamDialog],
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
        crams: [],
      }).interval,
    })),
  );

  /** A row per topic tag in the vault — the primary way tiers get assigned. */
  protected readonly topics = computed(() => topicTiers(this.deck.topicTags(), this.draft().tiers));

  /** The tags themselves, which is what an exam's scope is checked against. */
  protected readonly deckTopics = this.deck.topicTags;

  protected readonly choices = TOPIC_CHOICES;

  /** Which exam the dialog is asking about — an index, `NEW`, or closed. */
  protected readonly editing = signal<number | typeof NEW | null>(null);
  protected readonly NEW = NEW;

  /** The exam the dialog opens on: an existing one, or null for a blank form. */
  protected readonly examUnderEdit = computed(() => {
    const at = this.editing();
    return typeof at === "number" ? (this.draft().crams[at] ?? null) : null;
  });

  protected readonly today = today;

  protected openExam(at: number | typeof NEW): void {
    this.editing.set(at);
  }

  protected closeExam(): void {
    this.editing.set(null);
  }

  /**
   * Takes what the dialog vouched for: a new exam onto the end, an edited one
   * back where it came from.
   *
   * Nothing is validated here on purpose. The dialog is the only way an exam is
   * built, so a half-made one cannot reach the list — which is what lets a row
   * be a summary rather than a form.
   */
  protected saveExam(exam: CramState): void {
    const at = this.editing();
    if (at === null) return;

    const crams = this.draft().crams;
    this.update(
      "crams",
      at === NEW
        ? [...crams, exam]
        : crams.map((existing, index) => (index === at ? exam : existing)),
    );
    this.closeExam();
  }

  /** A row's one line: when the exam is, and at what pace. */
  protected describeExam(cram: CramState): string {
    return `${cram.examDate} · ${whenLabel(daysBetween(today(), cram.examDate))} · ${cram.perSession} a session`;
  }

  /**
   * Drops an exam outright.
   *
   * The way to stop cramming, in place of the old on/off switch: with a list,
   * an exam that is off is just an exam that is not there. Sitting the exam
   * ends it on its own, so this is for the one cancelled, moved, or entered by
   * mistake.
   */
  protected removeCram(index: number): void {
    this.update(
      "crams",
      this.draft().crams.filter((_, at) => at !== index),
    );
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

/**
 * How far off an exam is, in words.
 *
 * A date that has been and gone is named as such rather than counted down from:
 * it applies to nothing, and the row is the only place left that could say so.
 */
function whenLabel(daysLeft: number): string {
  if (daysLeft > 1) return `in ${daysLeft} days`;
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft === 0) return "today";
  return "passed";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

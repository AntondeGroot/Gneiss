import { Injectable, computed, inject, signal } from "@angular/core";

import {
  DEFAULT_CONFIG,
  cramPlan,
  distinctTopicTags,
  folderOf,
  isCrammed,
  newReviewState,
  nextStreak,
  resolveTier,
  schedule,
  obsidianNoteUri,
  selectDue,
  splitCard,
  standingStreak,
  withEditedCard,
  withTier,
  withoutCard,
} from "../../vault";
import type {
  CardText,
  GneissConfig,
  Grade,
  ParsedNote,
  ReviewState,
  Tier,
  TierMapping,
} from "../../vault";
import { DeckCacheService } from "./deck-cache.service";
import { ReminderService } from "./reminder.service";
import type { VaultSource } from "./vault-source";

/** A parsed card plus everything scheduling needs to act on it. */
export interface DeckCard {
  /** Note path and question text — see CLAUDE.md on why this identity is fragile. */
  readonly id: string;
  readonly note: string;
  readonly front: string;
  readonly back: string;
  readonly tier: Tier;
  readonly topicTags: string[];
  /** Kept alongside the resolved tier so the card can be re-tiered in place. */
  readonly tierOverride?: Tier;
  readonly review: ReviewState;
}

/**
 * Holds the deck for the session: reads the vault once, flattens it into cards,
 * and applies grades.
 *
 * Grading updates the card in memory and then records it in the note it came
 * from, so progress survives a restart and syncs with the vault.
 */
@Injectable({ providedIn: "root" })
export class DeckService {
  private readonly cache = inject(DeckCacheService);
  private readonly reminders = inject(ReminderService);
  private source: VaultSource | null = null;
  private readonly cards = signal<readonly DeckCard[]>([]);
  /**
   * The vault's topic tags, so Settings can offer a row per topic. Taken from the
   * notes rather than the cards: a note tagged but not yet filled in still names
   * a topic the user means to tier.
   */
  private readonly topics = signal<readonly string[]>([]);
  /** The open vault, so the UI can name it and know whether writes are possible. */
  readonly sourceLabel = signal("");
  readonly canWrite = signal(false);

  /** Read from `.gneiss/config.md` in the vault, so it syncs across devices. */
  readonly config = signal<GneissConfig>(DEFAULT_CONFIG);

  /** Set when a write to the vault failed, so the UI can say so rather than lie. */
  readonly writeError = signal<string | null>(null);

  /** True while a vault is still being walked, so the screen can show progress. */
  readonly reading = signal(false);

  /**
   * Whether a full set of notes has been taken in.
   *
   * Not the same as "has cards": a vault whose notes all lost their tag is
   * legitimately empty, and anything comparing against the deck has to be able
   * to tell that from not having read yet.
   */
  readonly loaded = signal(false);

  /**
   * Grades given while a read was in flight, so the fresh copy of those notes
   * does not undo them on screen.
   */
  private readonly gradedWhileReading = new Map<string, ReviewState>();

  /** Images already fetched this session, keyed by what the note wrote. */
  private readonly attachments = new Map<string, string>();

  /** The read in flight, so a second request for the same vault joins it. */
  private opening: { location: string; done: Promise<void> } | null = null;

  readonly all = this.cards.asReadonly();
  readonly topicTags = this.topics.asReadonly();
  /**
   * This session's queue: due reviews and new cards, each under its own portion,
   * ordered core-first and most-overdue-first. An imported vault's backlog is
   * served a portion at a time rather than all at once — and since grading a
   * card takes it out of the due set, finishing a session and starting another
   * walks straight on through it.
   */
  private readonly selection = computed(() =>
    selectDue(this.cards(), today(), {
      newPerSession: this.config().newPerSession,
      reviewsPerSession: this.config().reviewsPerSession,
      cram: this.config().cram,
    }),
  );

  readonly due = computed(() => this.selection().queue);
  /** Cards beyond this session's portion, so the UI can say so rather than hide it. */
  readonly heldBackNew = computed(() => this.selection().heldBackNew);
  readonly heldBackReviews = computed(() => this.selection().heldBackReviews);
  /** Crammed cards beyond the chosen pace — next in line, not withheld. */
  readonly heldCrammed = computed(() => this.selection().heldCrammed);

  /**
   * How the cram is going and what pace the deadline demands, or null when none
   * is running. An expired cram reads as absent, so the date is the off-switch
   * here too and no manual reset is needed.
   */
  readonly cram = computed(() =>
    cramPlan(this.cards(), this.config().cram, this.config().cramMinPasses, today()),
  );

  /** The cram's topic tag, for naming it on screen. */
  readonly cramScope = computed(() => this.config().cram?.scope ?? "");

  /** Due cards inside the cram's scope — what the countdown is actually about. */
  readonly cramDue = computed(() =>
    this.due().filter((card) => isCrammed(card.topicTags, this.config().cram)),
  );

  /**
   * Whether a review session has been *finished* today — what settles the
   * evening nudge.
   *
   * Not "has any card been graded": grading one card and putting the phone down
   * is exactly the day the backup reminder exists for.
   */
  sessionDoneToday(): boolean {
    return this.config().lastSessionOn === today();
  }

  /** Zero once a day has been missed — never claims a streak that is already broken. */
  readonly streak = computed(() =>
    standingStreak(this.config().streak, this.config().lastReviewedOn, today()),
  );

  /**
   * Opens a vault from any source, then reads its config and notes.
   *
   * Notes are added as they arrive rather than after the last file is read, so
   * cards become reviewable while a large vault is still loading. `reading` says
   * whether the walk is still going, which is what lets the screen show progress
   * instead of an empty list that looks like a hang.
   */
  async open(source: VaultSource, location: string): Promise<void> {
    // Two screens asking for the same vault at once used to start two reads,
    // and both appended their notes — the same question, twice in a row. The
    // second caller now waits on the first instead. A *different* location is a
    // genuine second request and goes ahead.
    if (this.opening?.location === location) return this.opening.done;

    const done = this.readVault(source, location);
    this.opening = { location, done };
    try {
      await done;
    } finally {
      if (this.opening?.done === done) this.opening = null;
    }
  }

  private async readVault(source: VaultSource, location: string): Promise<void> {
    await source.open(location);
    this.source = source;
    this.sourceLabel.set(source.label);
    this.canWrite.set(source.canWrite());
    this.config.set(await source.readConfig());
    this.attachments.clear();
    this.syncReminders();

    // With cards already on screen from the cache, streaming a second set in
    // beneath the user would be worse than a brief wait: the queue would grow
    // and reorder while they review it. Fresh notes are staged and swapped in
    // once. With nothing to show, streaming is the whole point.
    const showing = this.cards().length > 0;
    if (!showing) {
      this.cards.set([]);
      this.topics.set([]);
    }

    const staged: ParsedNote[] = [];
    this.reading.set(true);
    this.gradedWhileReading.clear();
    try {
      await source.readNotes((batch) => {
        staged.push(...batch);
        if (!showing) this.addNotes(batch);
      });
      this.setNotes(staged);
      this.restoreGradesMadeWhileReading();
      this.cache.save(source.vaultName(), this.config(), this.cards(), this.topics());
    } finally {
      this.reading.set(false);
    }
  }

  /**
   * Loads the cached slice of a vault, so a session can start before the vault
   * has been read. Returns whether anything was there.
   *
   * The cards are a head start, not the truth: `open` replaces them wholesale
   * once the real read finishes.
   */
  restore(vault: string): boolean {
    const cached = this.cache.load(vault);
    if (!cached) return false;

    this.config.set(cached.config);
    this.topics.set(cached.topics);
    this.cards.set(cached.cards);
    return true;
  }

  /**
   * Re-applies grades given while the vault was being read.
   *
   * The read may have started before those cards were written, so the fresh copy
   * can carry the old schedule and the card would come straight back. The vault
   * already has the grade; this stops the screen disagreeing with it.
   */
  private restoreGradesMadeWhileReading(): void {
    if (this.gradedWhileReading.size === 0) return;

    this.cards.update((cards) =>
      cards.map((card) => {
        const review = this.gradedWhileReading.get(card.id);
        return review ? { ...card, review } : card;
      }),
    );
    this.gradedWhileReading.clear();
  }

  /**
   * Adds a batch of notes to the deck already loaded.
   *
   * Keyed by card id, so a note that arrives twice replaces itself rather than
   * showing up as a second copy of the same question.
   */
  addNotes(notes: readonly ParsedNote[]): void {
    const tiers = this.config().tiers;
    const tagged = onlyTagged(notes);
    this.topics.update((topics) => [...new Set([...topics, ...distinctTopicTags(tagged)])]);
    this.cards.update((cards) =>
      withoutRepeats([...cards, ...tagged.flatMap((note) => toCards(note, tiers))]),
    );
  }

  /**
   * Loads already-parsed notes, for sources other than the device filesystem.
   * The vault path stays empty, which is what keeps write-back from firing
   * against a folder Gneiss did not read through VaultService.
   */
  setNotes(notes: readonly ParsedNote[]): void {
    const tagged = onlyTagged(notes);
    this.loaded.set(true);
    this.topics.set(distinctTopicTags(tagged));
    this.cards.set(withoutRepeats(tagged.flatMap((note) => toCards(note, this.config().tiers))));
  }

  /**
   * Persists settings back into the vault, and re-tiers the deck so an edit to
   * the tag mapping takes effect on this session's cards rather than only on the
   * next load.
   */
  async saveConfig(config: GneissConfig): Promise<void> {
    this.config.set(config);
    this.cards.update((cards) =>
      cards.map((card) => ({ ...card, tier: resolveTier(card, config.tiers) })),
    );
    await this.source?.writeConfig(config);
  }

  /**
   * Rewrites a card's question and answer in its note.
   *
   * The card keeps its review state: `withEditedCard` carries the `<!--SR:-->`
   * comment across, so fixing a typo does not cost the card its schedule. Its
   * identity does change, since that is the question text — so the in-memory
   * card is re-keyed too, or the next grade would look for a question the note
   * no longer contains.
   */
  async editCard(card: DeckCard, next: CardText): Promise<void> {
    const edited: DeckCard = {
      ...card,
      id: `${card.note}::${next.front}`,
      front: next.front,
      back: next.back,
    };
    this.replace(card, edited);

    await this.persist(() =>
      this.source?.editNote(card.note, (md) => withEditedCard(md, card.front, next)),
    );
  }

  /** Removes a card from its note, and from the session in progress. */
  async deleteCard(card: DeckCard): Promise<void> {
    this.cards.update((cards) => cards.filter((existing) => existing.id !== card.id));

    await this.persist(() => this.source?.editNote(card.note, (md) => withoutCard(md, card.front)));
  }

  /**
   * An embedded image as something an `img` tag can load.
   *
   * Cached for the session: the same diagram often sits on several cards, and on
   * Android the bytes come back base64 across the bridge, which is the one part
   * of showing an image that is worth not repeating.
   */
  async attachment(target: string): Promise<string> {
    const known = this.attachments.get(target);
    if (known !== undefined) return known;

    const url = (await this.source?.readAttachment(target)) ?? "";
    // Only successes are kept. A miss can mean the vault has not finished
    // listing itself, and remembering that would make the card show a raw link
    // for as long as the app stays open.
    if (url !== "") this.attachments.set(target, url);
    return url;
  }

  /**
   * Fetches a card's images ahead of being asked for them.
   *
   * An image costs a round trip and a base64 decode, which is a visible pause if
   * it starts when the card appears. Warming the answer's images while the
   * question is still on screen — and the next card's while this one is being
   * answered — spends that time where nobody is waiting.
   */
  prefetch(...cards: readonly (DeckCard | undefined)[]): void {
    for (const card of cards) {
      if (!card) continue;
      for (const segment of splitCard(`${card.front}\n${card.back}`)) {
        if (segment.kind === "embed") void this.attachment(segment.target);
      }
    }
  }

  /** The open vault's own name, which is how state kept on the device is keyed. */
  vaultName(): string {
    return this.source?.vaultName() ?? "";
  }

  /**
   * Sets a note's tier, by rewriting the tag in the note itself.
   *
   * `standard` is the *absence* of a tag, so choosing it removes the override
   * rather than writing one — after which the tag→tier mapping decides again,
   * and the note may well come back as something other than standard. The
   * resolved tier is recomputed here for exactly that reason.
   */
  async setTier(note: string, tier: Tier): Promise<void> {
    const override = tier === "standard" ? undefined : tier;
    this.cards.update((cards) =>
      cards.map((card) =>
        card.note === note ? withOverride(card, override, this.config()) : card,
      ),
    );

    await this.persist(() => this.source?.editNote(note, (md) => withTier(md, tier)));
    this.cache.save(this.vaultName(), this.config(), this.cards(), this.topics());
  }

  /** Where a note lives in the vault, and the link that opens it in Obsidian. */
  noteLink(card: DeckCard): { folder: string; uri: string } {
    return {
      folder: folderOf(card.note),
      uri: obsidianNoteUri(this.source?.vaultName() ?? "", card.note),
    };
  }

  /** What the interval would become, without committing the grade. */
  preview(card: DeckCard, grade: Grade): ReviewState {
    return schedule(card.review, grade, this.optionsFor(card));
  }

  /**
   * Applies the grade in memory immediately, then persists it. The in-memory
   * update is not rolled back on a write failure: the grade genuinely happened,
   * and losing it would be worse than a note that is briefly out of date.
   */
  async grade(card: DeckCard, grade: Grade): Promise<void> {
    const review = this.preview(card, grade);
    this.replace(card, { ...card, review });
    if (this.reading()) this.gradedWhileReading.set(card.id, review);
    this.cache.save(this.source?.vaultName() ?? "", this.config(), this.cards(), this.topics());

    await this.persist(async () => {
      await this.source?.writeReviewState(card.note, card.front, review);
      await this.recordReviewDay();
    });
  }

  private replace(card: DeckCard, next: DeckCard): void {
    this.cards.update((cards) =>
      cards.map((existing) => (existing.id === card.id ? next : existing)),
    );
  }

  /**
   * Runs a write against the vault, recording a failure rather than throwing it
   * at the screen. The in-memory change is never rolled back: the user's action
   * genuinely happened, and discarding it would be worse than a note that is
   * briefly out of date, which the surfaced error tells them about.
   */
  private async persist(write: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await write();
      this.writeError.set(null);
    } catch (error) {
      this.writeError.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Advances the streak on the first review of a new day, and persists it. */
  private async recordReviewDay(): Promise<void> {
    const config = this.config();
    if (config.lastReviewedOn === today()) return;

    await this.saveConfig({
      ...config,
      streak: nextStreak(config.streak, config.lastReviewedOn, today()),
      lastReviewedOn: today(),
    });
  }

  /**
   * Records that a session was worked through to the end, which is what moves
   * tonight's backup nudge to tomorrow.
   */
  async completeSession(): Promise<void> {
    if (this.sessionDoneToday()) return;

    await this.saveConfig({ ...this.config(), lastSessionOn: today() });
    this.syncReminders();
  }

  /**
   * Puts the reminders where the current config and today's progress say they
   * belong.
   *
   * Fire-and-forget: a reminder that could not be scheduled — permission
   * declined, notifications off at the system level — must not stop a review.
   */
  private syncReminders(): void {
    void this.reminders.apply(this.config(), this.sessionDoneToday()).catch(() => undefined);
  }

  private optionsFor(card: DeckCard) {
    return {
      tier: card.tier,
      spread: this.config().spread,
      today: today(),
      topicTags: card.topicTags,
      cram: this.config().cram,
    };
  }
}

function toCards(note: ParsedNote, tiers: TierMapping): DeckCard[] {
  const tier = resolveTier(note, tiers);
  return note.cards.map((card) => ({
    id: `${note.note}::${card.front}`,
    note: note.note,
    front: card.front,
    back: card.back,
    tier,
    topicTags: note.topicTags,
    ...(note.tierOverride ? { tierOverride: note.tierOverride } : {}),
    review: card.review ?? newReviewState(today()),
  }));
}

/**
 * The card with its per-note tier tag set or cleared, and its tier resolved
 * again from that.
 *
 * Built by hand rather than by assigning `undefined`: the deck is compiled with
 * `exactOptionalPropertyTypes`, so an absent override and one set to `undefined`
 * are different things.
 */
function withOverride(card: DeckCard, override: Tier | undefined, config: GneissConfig): DeckCard {
  const tierable = { topicTags: card.topicTags, ...(override ? { tierOverride: override } : {}) };

  // Every field named rather than spread: spreading would carry the old override
  // through, and dropping a key by destructuring leaves a variable nothing uses.
  return {
    id: card.id,
    note: card.note,
    front: card.front,
    back: card.back,
    topicTags: card.topicTags,
    review: card.review,
    ...(override ? { tierOverride: override } : {}),
    tier: resolveTier(tierable, config.tiers),
  };
}

/**
 * Only notes the user tagged join the deck.
 *
 * Gneiss never opts a note in: a `::` or a bare `?` can appear in any note, and
 * treating that as a flashcard would adopt half a vault. The `#flashcards` tag
 * is the consent, which also means **removing it takes the cards out again** —
 * without this, untagging a topic changed nothing at all.
 */
function onlyTagged(notes: readonly ParsedNote[]): readonly ParsedNote[] {
  return notes.filter((note) => note.topicTags.length > 0);
}

/**
 * One card per id, keeping the last seen.
 *
 * A card's id is its note path and question, so a repeat means the same note was
 * read twice — never two genuinely different cards. Two notes that happen to ask
 * the same thing have different paths and both survive, which is right: they are
 * two cards in the vault.
 */
function withoutRepeats(cards: readonly DeckCard[]): DeckCard[] {
  return [...new Map(cards.map((card) => [card.id, card])).values()];
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

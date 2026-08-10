import {
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from "@angular/core";
import type { ElementRef } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { DEFAULT_CRAM_PER_SESSION, daysBetween, isWithinScope } from "../../vault";
import type { CramState } from "../../vault";

/** The least an exam can ask for, and the most the pace field will take. */
const MINIMUM_PER_SESSION = 1;
const MAXIMUM_PER_SESSION = 200;

/**
 * How many tags to offer at once.
 *
 * Past a couple of dozen, reading the list is slower than typing another letter
 * — and a vault's whole tag set would push the fields off a phone screen.
 */
const MAX_SUGGESTIONS = 24;

/**
 * Asking for one exam, and checking the answers before they count.
 *
 * An exam typed straight into a list fails quietly: a scope with a typo clamps
 * nothing, and an entry without a date is dropped on the next read — both of
 * them found out about weeks later, by not being ready. Putting the three
 * questions in one dialog is what makes it possible to answer them together and
 * check them before anything is written.
 *
 * The scope is checked against the tags the vault actually carries, by the same
 * `isWithinScope` the clamp uses, so "valid here" and "clamps something there"
 * cannot disagree. Creating and editing are the same form: the fields are the
 * same three, and a second, near-identical one would only drift.
 *
 * Deliberately presentational, like `CardEditor` — it is handed the exam, the
 * vault's topics and today's date, and reports what the user meant. Nothing
 * about vaults, config files or scheduling reaches in here.
 */
@Component({
  selector: "gn-exam-dialog",
  imports: [FormsModule],
  templateUrl: "./exam-dialog.html",
  styleUrl: "./exam-dialog.scss",
  // Escape closes it. Unlike the card editor there is no "keep your changes?"
  // step: three short fields typed in one sitting are not the same as an edit
  // to a note, and a question guarding them would cost more than they do.
  host: { "(document:keydown.escape)": "dismissed.emit()" },
})
export class ExamDialog {
  /** The exam being edited, or null when this is a new one. */
  readonly exam = input<CramState | null>(null);
  /** Every topic tag the vault carries — what a scope is checked against. */
  readonly topics = input<readonly string[]>([]);
  readonly today = input.required<string>();

  readonly save = output<CramState>();
  readonly dismissed = output<void>();

  protected readonly scope = linkedSignal(() => this.exam()?.scope ?? "");
  protected readonly examDate = linkedSignal(() => this.exam()?.examDate ?? "");
  protected readonly perSession = linkedSignal(
    () => this.exam()?.perSession ?? DEFAULT_CRAM_PER_SESSION,
  );

  /**
   * Whether Save has been pressed on an incomplete form.
   *
   * Empty fields say nothing until then — an untouched form is not yet wrong,
   * and marking it so before the user has typed reads as being told off for
   * opening the dialog. A field with the *wrong* content is another matter, and
   * says so as it is typed.
   */
  private readonly attempted = signal(false);

  private readonly panel = viewChild<ElementRef<HTMLElement>>("panel");

  protected readonly minPerSession = MINIMUM_PER_SESSION;
  protected readonly maxPerSession = MAXIMUM_PER_SESSION;
  protected readonly Number = Number;

  constructor() {
    // A dialog nobody's focus is in cannot be dismissed from a keyboard, and
    // reads to a screen reader as the settings still being where you are.
    effect(() => this.panel()?.nativeElement.focus());
  }

  protected readonly editing = computed(() => this.exam() !== null);

  /** The vault's tags this scope would claim — the check, and the reassurance. */
  protected readonly covered = computed(() => {
    const scope = this.scope().trim();
    if (!scope) return [];
    return this.topics().filter((tag) => isWithinScope(tag, scope));
  });

  /**
   * With no vault read there is nothing to check a scope against, and refusing
   * on that basis would block an exam over the app's own state rather than the
   * user's mistake. The tag is taken on trust, and the dialog says why.
   */
  protected readonly vaultUnread = computed(() => this.topics().length === 0);

  /**
   * The vault's tags matching what is being typed, as a list to pick from.
   *
   * Matched on the segment under the cursor rather than the whole tag, so `vi`
   * finds `#flashcards/vim` without the `#flashcards/` prefix having to be typed
   * first — which is the part every tag shares and nobody wants to retype.
   * Anywhere in the tag counts, not just the start: the half-remembered part of
   * a tag is as often the end of it.
   */
  private readonly matching = computed(() => {
    const term = typedSegment(this.scope());
    return this.topics().filter((tag) => tag.toLowerCase().includes(term));
  });

  protected readonly suggestions = computed(() => this.matching().slice(0, MAX_SUGGESTIONS));

  /** How many matches did not fit — the reason to keep typing. */
  protected readonly unshown = computed(() => this.matching().length - this.suggestions().length);

  /**
   * Offered until the scope is one the vault answers to. Once it is, the
   * "covers N tags" note says so and a list of the same tags underneath would
   * only be the same fact twice.
   */
  protected readonly showSuggestions = computed(
    () => this.covered().length === 0 && this.suggestions().length > 0,
  );

  protected pick(tag: string): void {
    this.scope.set(tag);
  }

  protected readonly scopeProblem = computed(() => {
    const scope = this.scope().trim();
    if (!scope) return this.attempted() ? "Name the topic tag this exam covers." : "";
    if (this.vaultUnread() || this.covered().length > 0) return "";
    // Mid-typing, with matches on offer, the list is the better answer than
    // being told off for a tag that is not finished being typed.
    if (this.showSuggestions() && !this.attempted()) return "";
    return `No card in the vault is tagged ${scope}. Pick one of the vault's own tags.`;
  });

  /**
   * A date today or past is not a mistake the config would report: it parses,
   * it saves, and it clamps nothing, because the day after is the off-switch.
   * So the dialog is where it has to be caught.
   */
  protected readonly dateProblem = computed(() => {
    const date = this.examDate();
    if (!date) return this.attempted() ? "Pick the day of the exam." : "";
    if (daysBetween(this.today(), date) > 0) return "";
    return "The exam has to be at least a day away — one today or past focuses nothing.";
  });

  protected readonly paceProblem = computed(() =>
    this.perSession() >= MINIMUM_PER_SESSION
      ? ""
      : "One new card a session is the least an exam can ask for.",
  );

  protected readonly incomplete = computed(
    () => !this.scope().trim() || !this.examDate() || this.perSession() < MINIMUM_PER_SESSION,
  );

  /** Days to go, once there is a date worth counting down to. */
  protected readonly daysLeft = computed(() =>
    this.examDate() ? daysBetween(this.today(), this.examDate()) : 0,
  );

  /**
   * Saves, or shows what is still missing.
   *
   * The button stays live rather than greying out: a dead button with nothing
   * beside it leaves the reader to work out which of three fields it is waiting
   * on, and the answer is the whole point of the dialog.
   */
  protected onSave(): void {
    this.attempted.set(true);
    if (this.hasProblem()) return;

    this.save.emit({
      scope: this.scope().trim(),
      examDate: this.examDate(),
      perSession: this.perSession(),
    });
  }

  private hasProblem(): boolean {
    return (
      this.incomplete() || !!this.scopeProblem() || !!this.dateProblem() || !!this.paceProblem()
    );
  }
}

/**
 * The part of a tag being typed right now: whatever follows the last `/`,
 * without its `#`.
 *
 * An empty one — an empty field, or a trailing slash — matches everything, which
 * is what makes the untouched field show the vault's tags to browse.
 */
function typedSegment(scope: string): string {
  return scope
    .slice(scope.lastIndexOf("/") + 1)
    .replace("#", "")
    .trim()
    .toLowerCase();
}

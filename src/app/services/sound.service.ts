import { Injectable, signal } from "@angular/core";
import { Haptics } from "@capacitor/haptics";

import type { Grade } from "../../vault";

const KEY = "gneiss.volume";

/**
 * The two moments worth a sound: an answer that was recalled, and a session
 * worked through to the end.
 *
 * The clips are from ZapSplat, credited in `public/sounds/README.md` and on the
 * Settings screen as its licence asks.
 */
export type Cue = "correct" | "goal";

const FILES: Record<Cue, string> = {
  correct: "sounds/zapsplat_multimedia_game_sound_cube_game_win_collect_bonus_002_104486.mp3",
  goal: "sounds/zapsplat_multimedia_game_sound_fanfare_trumpets_staccato_finish_complete_109640.mp3",
};

/**
 * How loud each clip plays before the master volume scales it, 0..1.
 *
 * The clips were mastered for other projects and are not level with each
 * other, so this is where one is turned down rather than editing the file.
 */
const BASE_VOLUME: Record<Cue, number> = {
  correct: 1,
  goal: 1,
};

/** One buzz: when it starts after the clip does, and how long it lasts, in ms. */
interface Pulse {
  readonly at: number;
  readonly ms: number;
}

/**
 * Vibration played along with a clip, so the phone feels what it is playing.
 *
 * The goal pattern follows the fanfare's own hits — read off its loudness
 * envelope — ending on a longer buzz under the held final note. Each buzz lasts
 * about as long as its note, and never much under 100 ms: a motor needs a few
 * tens of milliseconds to spin up, so a shorter one reads as a faint tick. The
 * gaps are what keep neighbouring hits apart rather than one long hum. Swapping the
 * clip means re-timing this, or the two will argue. The chime has none: it is
 * heard every card, and a buzz that often stops meaning anything.
 */
const VIBRATION: Record<Cue, readonly Pulse[]> = {
  correct: [],
  goal: [
    { at: 0, ms: 150 },
    { at: 450, ms: 150 },
    { at: 780, ms: 120 },
    { at: 1250, ms: 120 },
    { at: 1500, ms: 120 },
    { at: 1900, ms: 140 },
    { at: 2100, ms: 100 },
    { at: 2250, ms: 350 },
  ],
};

/**
 * Which cue a grade earns, if any.
 *
 * Difficult stays silent rather than buzzing: a miss is not a failure the app
 * should punish, and a sound that scolds is one that gets switched off. Ending
 * the session outranks the answer that ended it, so the two never overlap.
 */
export function cueFor(grade: Grade, sessionOver: boolean): Cue | null {
  if (sessionOver) return "goal";
  return grade === "difficult" ? null : "correct";
}

/**
 * Plays the review's feedback sounds, behind a master volume (0 is off).
 *
 * The volume is kept on the device, not in the vault's config: the phone in a
 * lecture hall and the laptop at home want different answers, and syncing one
 * to the other would be wrong on both.
 */
@Injectable({ providedIn: "root" })
export class SoundService {
  /** Master volume, 0..1. */
  readonly volume = signal(readVolume());

  private readonly players = new Map<Cue, HTMLAudioElement>();

  setVolume(value: number): void {
    const volume = clampVolume(value);
    this.volume.set(volume);
    try {
      globalThis.localStorage?.setItem(KEY, String(volume));
    } catch {
      // Not remembered across a restart; this run still honours it.
    }
  }

  graded(grade: Grade, sessionOver: boolean): void {
    const cue = cueFor(grade, sessionOver);
    if (cue) this.play(cue);
  }

  /**
   * Fire-and-forget, like the reminders: a missing file, a refused autoplay or
   * a webview without audio must never stand in the way of the next card.
   */
  play(cue: Cue): void {
    const master = this.volume();
    if (master <= 0 || typeof Audio === "undefined") return;

    const player = this.playerFor(cue);
    // Rewound rather than recreated, so quick grading restarts the chime
    // instead of stacking copies of it.
    player.currentTime = 0;
    player.volume = BASE_VOLUME[cue] * master;
    // Timed from when the clip actually starts, not from when it was asked
    // for, so a slow first load does not put the buzz ahead of the sound.
    //
    // `play()` is called inside the chain rather than chained from: an older
    // browser — and jsdom — returns nothing instead of a promise, and some
    // throw outright, and either would escape as an error on the grade button.
    Promise.resolve()
      .then(() => player.play())
      .then(() => vibrate(VIBRATION[cue]))
      .catch(() => undefined);
  }

  private playerFor(cue: Cue): HTMLAudioElement {
    let player = this.players.get(cue);
    if (!player) {
      player = new Audio(FILES[cue]);
      player.preload = "auto";
      this.players.set(cue, player);
    }
    return player;
  }
}

/**
 * One call per pulse rather than one waveform: the plugin's `vibrate` takes a
 * single duration. A device that cannot vibrate refuses quietly — the sound is
 * the reward, the buzz only underlines it.
 */
function vibrate(pulses: readonly Pulse[]): void {
  for (const { at, ms } of pulses) {
    setTimeout(() => {
      Haptics.vibrate({ duration: ms }).catch(() => undefined);
    }, at);
  }
}

function readVolume(): number {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    // Empty counts as absent: `Number("")` is 0, which would mute without anyone asking.
    return stored ? clampVolume(Number(stored)) : 1;
  } catch {
    return 1;
  }
}

/** Anything unreadable plays at full volume rather than silently muting. */
function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

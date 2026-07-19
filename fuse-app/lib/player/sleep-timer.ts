// Sleep timer (Wave 1) — stop after X minutes, or at the end of the current track.
//
// A small framework-free observable, mirroring the store's shape (a tiny subscribe
// model, injectable timers + clock) so it is unit-tested in node with a fake clock and
// driven from anywhere. The UI (a countdown chip + the profile-sheet / Now Playing
// controls) renders from its snapshot; nothing else holds sleep-timer state.
//
// HONESTY (R17): the timer only ever does something real. When it fires it calls the
// injected `onFire` (which pauses playback) — it never fakes a stop. "End of track"
// mode does not run a countdown it cannot predict (a track's true remaining time drifts
// with buffering); instead it arms a flag the player consumes when the track genuinely
// ends, and the chip says "Ends with this track" rather than showing a fake countdown.
// Cancel is real — it disarms and, for end-of-track, clears the player's flag.

export type SleepMode = "off" | "minutes" | "end-of-track";

export type SleepTimerState = {
  mode: SleepMode;
  // Whole seconds left, for the countdown chip. Only meaningful in "minutes" mode
  // (0 otherwise) — end-of-track has no honest countdown.
  remainingSec: number;
  // The minutes value the user picked (for labelling the chip), or null.
  minutes: number | null;
};

export const SLEEP_PRESETS_MIN = [15, 30, 45, 60] as const;

const OFF_STATE: SleepTimerState = { mode: "off", remainingSec: 0, minutes: null };

export type SleepTimerListener = (state: SleepTimerState) => void;

export type SleepTimerPorts = {
  // Pause playback when a minutes timer fires. Kept injectable so the pure timer never
  // imports the store (node-testable) and the wiring module supplies the real pause.
  onFire: () => void;
  // Set/clear the player's "stop when the current track ends" flag (end-of-track mode).
  setStopAfterTrack: (stop: boolean) => void;
  // Injectable clock + timers so tests drive time deterministically.
  now?: () => number;
  setInterval?: (handler: () => void, ms: number) => number;
  clearInterval?: (id: number) => void;
};

// How often the countdown ticks (once a second is plenty for a minute-granularity chip).
const TICK_MS = 1000;

export class SleepTimer {
  private state: SleepTimerState = OFF_STATE;
  private readonly listeners = new Set<SleepTimerListener>();
  private readonly onFire: () => void;
  private readonly setStopAfterTrack: (stop: boolean) => void;
  private readonly now: () => number;
  private readonly _setInterval: (handler: () => void, ms: number) => number;
  private readonly _clearInterval: (id: number) => void;
  private endsAtMs = 0;
  private tickId: number | null = null;

  constructor(ports: SleepTimerPorts) {
    this.onFire = ports.onFire;
    this.setStopAfterTrack = ports.setStopAfterTrack;
    this.now = ports.now ?? (() => Date.now());
    this._setInterval =
      ports.setInterval ??
      ((h, ms) => globalThis.setInterval(h, ms) as unknown as number);
    this._clearInterval = ports.clearInterval ?? ((id) => globalThis.clearInterval(id));
  }

  getState(): SleepTimerState {
    return this.state;
  }

  subscribe(listener: SleepTimerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: SleepTimerState): void {
    this.state = next;
    for (const l of this.listeners) l(this.state);
  }

  private stopTick(): void {
    if (this.tickId != null) {
      this._clearInterval(this.tickId);
      this.tickId = null;
    }
  }

  // Arm a minutes countdown. Re-arming replaces any prior timer (minutes or end-of-track)
  // so there is only ever one sleep timer running.
  armMinutes(minutes: number): void {
    const mins = Math.max(1, Math.round(minutes));
    this.cancel(); // clear any prior mode (incl. end-of-track flag)
    this.endsAtMs = this.now() + mins * 60_000;
    this.emit({ mode: "minutes", minutes: mins, remainingSec: mins * 60 });
    this.tickId = this._setInterval(() => this.tick(), TICK_MS);
  }

  // Arm "stop at the end of the current track". No countdown — it sets the player flag
  // the store consumes when the track genuinely ends.
  armEndOfTrack(): void {
    this.cancel();
    this.setStopAfterTrack(true);
    this.emit({ mode: "end-of-track", minutes: null, remainingSec: 0 });
  }

  private tick(): void {
    if (this.state.mode !== "minutes") return;
    const remainingMs = this.endsAtMs - this.now();
    if (remainingMs <= 0) {
      this.stopTick();
      this.emit(OFF_STATE);
      this.onFire(); // real stop — pause playback
      return;
    }
    this.emit({
      mode: "minutes",
      minutes: this.state.minutes,
      remainingSec: Math.ceil(remainingMs / 1000),
    });
  }

  // Cancel any armed timer honestly. For end-of-track it clears the player flag so the
  // track will NOT stop; for minutes it stops the countdown. A no-op when already off.
  cancel(): void {
    this.stopTick();
    if (this.state.mode === "end-of-track") this.setStopAfterTrack(false);
    if (this.state.mode !== "off") this.emit(OFF_STATE);
  }

  // Called by the wiring layer when the player reports the current track ended, so an
  // end-of-track chip clears itself once the stop has been honoured. A no-op otherwise.
  notifyTrackEnded(): void {
    if (this.state.mode === "end-of-track") {
      this.stopTick();
      this.emit(OFF_STATE);
    }
  }
}

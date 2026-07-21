// Unified player store (U5, KTD-6, R2/R3/R4).
//
// This is the single source of playback truth. Every UI surface subscribes to it and
// renders from the snapshot it returns; nothing else holds playback state. The store
// is framework-free (a tiny observable, not a React hook) so it can be unit-tested in
// node and driven from anywhere. React surfaces subscribe via useSyncExternalStore in
// their own units.
//
// The store's public API is deliberately SOURCE-AGNOSTIC (the class-level fix for the
// old app, whose playback logic only ever wired YouTube). It never branches on
// `source`. To act on real sound it asks the adapter registry for the adapter of the
// current track's source and calls that adapter's generic methods. When no adapter is
// registered for a source (as in U5, before any land), the store updates the chosen
// track but honestly leaves `isPlaying` false — it will not claim to be playing
// something it cannot play (R17 at the state layer).

import type {
  EngineState,
  PlayerState,
  RadioProvider,
  RecoveryPhase,
  RepeatMode,
  SourceAdapter,
} from "@/lib/player/types";
import type { TrackRef } from "@/lib/repos/track";
import type { EngineErrorKind } from "@/lib/player/playback-health";
import { adapterRegistry, type AdapterRegistry } from "@/lib/player/adapters";
import { removeAt, moveTrack } from "@/lib/player/queue-ops";
import { logActivity } from "@/lib/activity-log";
import { describePlayback } from "@/lib/player/playback-truth";

// WHERE A QUEUED TRACK CAME FROM - the distinction that stops a row tap from silently
// deleting the listener's hand-built queue.
//
// THE BUG THIS KILLS: setQueue() replaced the ENTIRE upcoming list, and every row tap in
// the app calls it ("play this track, then the rest of this list"). So queueing five songs
// from search and then tapping a sixth song destroyed all five, with no warning and no undo.
//
// The class-level fix is the model every major player uses. Two lists live behind one
// visible queue:
//   - "user"    - songs the listener explicitly lined up (Play next / Add to queue). These
//                 are a promise; nothing but the listener removes them. They play FIRST.
//   - "context" - the album / playlist / search list currently being played through. THIS
//                 is what a fresh row tap replaces, because that is what "play this list
//                 instead" actually means.
// Tagging each entry (rather than special-casing the three callers) means every future
// caller of setQueue inherits the right behaviour for free.
type QueueOrigin = "user" | "context";
type QueueEntry = { track: TrackRef; origin: QueueOrigin };

// How many tracks the Previous back-stack keeps. Bounded so a long session cannot grow
// history without limit; well beyond any realistic "go back" reach.
const HISTORY_MAX = 50;

// How far into a track Previous counts as "restart this track" rather than "go back a
// song" — the industry-standard threshold every major player uses.
export const PREVIOUS_RESTART_THRESHOLD_SEC = 3;

function sameTrack(a: TrackRef, b: TrackRef): boolean {
  return a.source === b.source && a.nativeId === b.nativeId;
}

// The stable identity of a track, used to tie a message's lifetime to the thing it is
// about and to drop health writes computed for a track that is no longer current.
export function trackKey(track: TrackRef | null | undefined): string | null {
  return track ? `${track.source}:${track.nativeId}` : null;
}

export type PlayerListener = (state: PlayerState) => void;

// The honest terminal message when the recovery ladder gives up on a track.
export const WONT_PLAY_NOTICE = "This track won't play right now — skipping helps";

// Fisher-Yates. Used to PROJECT the context list into the order it will really play when
// shuffle is on, instead of picking a random index at advance time.
//
// THE BUG THIS KILLS: shuffle used to roll a die inside next(), so the queue screen
// rendered the array in its stored order while playback jumped somewhere else entirely - the
// "Up next" list was simply wrong the whole time shuffle was on. Re-projecting once, up
// front, makes what the listener SEES the same object as what will play; there is no second
// opinion left to disagree with. The user queue is deliberately NOT shuffled (same as
// Spotify/YTM): songs you lined up by hand keep the order you put them in.
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const INITIAL_STATE: PlayerState = {
  current: null,
  queue: [],
  canAdvance: false,
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  shuffle: false,
  repeat: "off",
  notice: null,
  status: "idle",
  recovery: { phase: "ok", skipOffered: false },
  intent: "idle",
  engineState: "unstarted",
  history: [],
  radioActive: false,
  sleepStopAfterTrack: false,
  volume: 1,
  muted: false,
  autoplayQueued: false,
};

export type PlayerStoreOptions = {
  // Registry the store resolves adapters from. Defaults to the shared app registry;
  // tests pass their own so a fake adapter can drive delegation in isolation.
  registry?: AdapterRegistry;
  // Optional starting state (mainly for tests and SSR hydration).
  initial?: Partial<PlayerState>;
};

export class PlayerStore {
  private state: PlayerState;
  private readonly listeners = new Set<PlayerListener>();
  private readonly registry: AdapterRegistry;
  // The adapter currently producing (or paused on) sound, so pause/seek/volume/rate
  // reach the right player without the store branching on source.
  private activeAdapter: SourceAdapter | null = null;
  // The kind of engine error observed for the CURRENT track since its last (re)load, if
  // any. The app-wide recovery monitor reads this each tick so a hard embed refusal
  // escalates the ladder immediately instead of wasting retries. Cleared on every fresh
  // load and the moment real position progress resumes (a track that recovers is healthy).
  private errorKind: EngineErrorKind = "none";
  // A position (in seconds) to resume the CURRENT track from on the NEXT user-initiated
  // play, set only by rehydrate() after a page reload. It is tied to a specific track so a
  // fresh play of a DIFFERENT track never inherits a stale offset. Consumed (cleared) the
  // moment play() runs, so it applies exactly once — the honest "restore paused, then play
  // continues from where you left off" behaviour, never a silent auto-play.
  private pendingResume: { source: string; nativeId: string; positionSec: number } | null = null;
  // RADIO CONTINUATION (Wave 1). The provider seeds similar tracks when the queue runs
  // out; the app wires one that reuses the search engine, tests pass a fake. Null = no
  // provider, so continuation simply never happens (the honest "stops at the end" default
  // for a build with no provider). `autoplaySimilar` mirrors the user's visible setting —
  // continuation fires ONLY when it is true, so this one auto-play is always user-consented.
  private radioProvider: RadioProvider | null = null;
  private autoplaySimilar = true;
  // THE REAL QUEUE (see QueueEntry). `state.queue` is a flattened, read-only projection of
  // this list, so every existing reader - the queue screen, persistence, the blend engine -
  // keeps working unchanged while the store gains the user-queue / context distinction.
  private entries: QueueEntry[] = [];
  // The context list in the order it ARRIVED (before any shuffle projection), so turning
  // shuffle back off restores the album's real running order rather than freezing a random
  // one. Tracks the listener has since removed stay removed.
  private contextOrder: TrackRef[] = [];

  constructor(options: PlayerStoreOptions = {}) {
    this.registry = options.registry ?? adapterRegistry;
    const seeded = { ...INITIAL_STATE, ...options.initial };
    // Anything handed in as a starting queue is a CONTEXT list (it was not lined up by hand).
    this.entries = seeded.queue.map((track) => ({ track, origin: "context" as const }));
    this.contextOrder = [...seeded.queue];
    this.state = { ...seeded, canAdvance: this.computeCanAdvance(seeded) };
  }

  // The ONE place `entries` becomes the visible `queue`. Every queue mutation goes through
  // here, so the two can never drift out of step (the class-level guard against a screen
  // that shows one order while playback follows another).
  private commitEntries(entries: QueueEntry[], patch: Partial<PlayerState> = {}): void {
    this.entries = entries;
    this.set({ queue: entries.map((e) => e.track), ...patch });
  }

  private static asContext(track: TrackRef): QueueEntry {
    return { track, origin: "context" };
  }

  // Replace the whole queue with a fresh CONTEXT list (radio picks, autoplay seeds, a
  // rehydrated session). Distinct from setQueue only in that callers here choose the extra
  // state patch; the origin tagging is identical.
  private replaceContext(tracks: readonly TrackRef[], patch: Partial<PlayerState> = {}): void {
    this.contextOrder = [...tracks];
    this.commitEntries(tracks.map(PlayerStore.asContext), patch);
  }

  // Whether Next would genuinely go somewhere - the single answer every transport control
  // reads (see PlayerState.canAdvance). Three real ways to advance, not just a non-empty
  // queue: something queued, repeat replaying, or consented radio continuation.
  private computeCanAdvance(state: PlayerState): boolean {
    if (state.queue.length > 0) return true;
    if (!state.current) return false;
    if (state.repeat === "one" || state.repeat === "all") return true;
    return this.autoplaySimilar && this.radioProvider !== null;
  }

  // Re-publish `canAdvance` after a change to something OUTSIDE PlayerState that feeds it
  // (the radio provider / autoplay consent). Silent when the answer has not moved, so it
  // never wakes every subscriber for nothing.
  private refreshCanAdvance(): void {
    if (this.computeCanAdvance(this.state) === this.state.canAdvance) return;
    this.set({});
  }

  // Read-only snapshot of the single truth. Callers must not mutate it.
  getState(): PlayerState {
    return this.state;
  }

  // Subscribe to state changes; returns an unsubscribe function.
  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // The track a live `notice` is ABOUT. A notice is a statement about one specific track
  // ("this track won't play", "playing the YouTube version"), so its lifetime belongs to
  // that track — not to the clock, and not to whoever remembers to clear it.
  private noticeFor: string | null = null;

  private set(patch: Partial<PlayerState>): void {
    const next = { ...this.state, ...patch };
    // NOTICE LIFETIME, ENFORCED IN ONE PLACE (the class fix for the leaking banner). Any
    // write that sets a notice stamps it with the track it describes; any state in which
    // the current track is no longer that track drops it automatically. A warning about
    // track A therefore cannot survive onto track B, whatever route the change took —
    // a skip, an auto-advance, a blend promotion, or a late write from a stale timer.
    if ("notice" in patch) this.noticeFor = patch.notice == null ? null : trackKey(next.current);
    if (next.notice != null && this.noticeFor !== trackKey(next.current)) {
      next.notice = null;
      this.noticeFor = null;
    }
    // `canAdvance` is DERIVED, always, from the state that just landed - recomputed in the
    // one place every write funnels through so no future field or action can forget to keep
    // it honest. This is why Skip can never grey out while Next would actually work.
    next.canAdvance = this.computeCanAdvance(next);
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
  }

  // Start a FRESH LISTENING CONTEXT: "play this track, then the rest of THIS list". Every
  // row tap in the app (search, home, library) calls this.
  //
  // THE BUG THIS KILLS: it used to replace the whole upcoming queue, so tapping any track
  // silently destroyed everything the listener had hand-queued. It now replaces only the
  // CONTEXT part and leaves the user queue standing - the same promise Spotify/Apple/YTM
  // make. Because the rule lives in the store, not in the callers, no row component had to
  // change and no future one can get it wrong.
  //
  // It still ends any radio continuation (the new choice supersedes the auto-stream) and
  // drops the autoplay label (owner fix 2). History is untouched - that is about tracks you
  // played, not the list you lined up.
  setQueue(tracks: readonly TrackRef[]): void {
    const user = this.entries.filter((e) => e.origin === "user");
    this.contextOrder = [...tracks];
    // Project into play order NOW (shuffled when shuffle is on) so the queue screen shows
    // the truth from the first render - see `shuffled()`.
    const context = (this.state.shuffle ? shuffled(tracks) : [...tracks]).map(
      PlayerStore.asContext,
    );
    this.commitEntries([...user, ...context], {
      radioActive: false,
      autoplayQueued: false,
    });
  }

  // "Add to queue" (Wave 1) - append to the END OF THE USER QUEUE, which still sits ahead of
  // the context list. A song you queued by hand outranks the album you happened to tap it
  // from, and it survives a change of context. De-duped: an existing copy anywhere is moved
  // rather than left behind, so a double-tap never stacks the same song twice.
  addToQueue(track: TrackRef): void {
    const rest = this.entries.filter((e) => !sameTrack(e.track, track));
    const lastUser = rest.reduce((n, e, i) => (e.origin === "user" ? i + 1 : n), 0);
    const next = [...rest];
    next.splice(lastUser, 0, { track, origin: "user" });
    this.commitEntries(next);
  }

  // "Play next" (Wave 1) - the very front of the user queue, so it plays right after the
  // current track. Same de-dup discipline as addToQueue.
  playNext(track: TrackRef): void {
    const rest = this.entries.filter((e) => !sameTrack(e.track, track));
    this.commitEntries([{ track, origin: "user" }, ...rest]);
  }

  // Remove the queued track at `index` (the queue screen's remove control). No-op if out
  // of range (queue-ops treats a stale index as an honest no-op).
  removeFromQueue(index: number): void {
    this.commitEntries(removeAt(this.entries, index));
  }

  // Reorder the queue: move the track at `from` to `to` (a drag, or the up/down controls).
  moveInQueue(from: number, to: number): void {
    this.commitEntries(moveTrack(this.entries, from, to));
  }

  // "Clear queue" - the escape hatch every rival has and this app did not: emptying a queue
  // meant pressing remove once per row. Wipes BOTH lists (the listener asked for an empty
  // up-next, not a half-empty one) and drops the radio/autoplay labels, which described a
  // list that no longer exists. The current track keeps playing; clearing the queue is not
  // a stop command.
  clearQueue(): void {
    this.contextOrder = [];
    this.commitEntries([], { radioActive: false, autoplayQueued: false });
  }

  // Jump straight to a queued track (tapping a row on the queue screen).
  //
  // THE BUG THIS KILLS: the queue screen had no way to play a row at all - reaching the
  // sixth song up next meant pressing Next five times. Everything ABOVE the tapped track is
  // dropped, exactly as skipping past it would have done, so the visible list stays honest
  // about what is still coming. Out-of-range is an honest no-op.
  async playFromQueue(index: number): Promise<boolean> {
    if (index < 0 || index >= this.entries.length) return false;
    const chosen = this.entries[index];
    this.commitEntries(this.entries.slice(index + 1));
    return this.play(chosen.track);
  }

  // Wire the radio-continuation provider + the user's "autoplay similar" consent (Wave 1).
  // Called by the app shell from the persisted setting; tests inject a deterministic fake.
  setRadioProvider(provider: RadioProvider | null): void {
    this.radioProvider = provider;
    // Wiring (or unwiring) radio changes whether Next can go anywhere on the last track, so
    // republish the derived capability - otherwise Skip would stay greyed out until some
    // unrelated state change happened to refresh it.
    this.refreshCanAdvance();
  }

  setAutoplaySimilar(enabled: boolean): void {
    this.autoplaySimilar = enabled;
    this.refreshCanAdvance();
    // Turning it off mid-stream does not stop the current radio track (that would cut sound
    // the user is enjoying), but the banner should stop claiming radio will continue once
    // the user has withdrawn consent — so drop the flag; the stream simply won't RE-seed.
    if (!enabled && this.state.radioActive) this.set({ radioActive: false });
  }

  // Arm/clear the sleep timer's "stop at the end of the current track" flag (Wave 1). The
  // SleepTimer owns the visible chip; the store owns the flag it consumes at a genuine
  // end-of-track advance (see next()).
  setStopAfterTrack(stop: boolean): void {
    if (this.state.sleepStopAfterTrack === stop) return;
    this.set({ sleepStopAfterTrack: stop });
  }

  // Push a track onto the bounded Previous back-stack (never a duplicate of the top).
  private pushHistory(track: TrackRef): void {
    const top = this.state.history[this.state.history.length - 1];
    if (top && sameTrack(top, track)) return;
    const next = [...this.state.history, track];
    this.set({ history: next.slice(Math.max(0, next.length - HISTORY_MAX)) });
  }

  // Restore a track + queue from a persisted session after a page reload (FIX 2), PAUSED
  // at the saved position. It NEVER starts sound — isPlaying stays false and intent stays
  // "idle", so the no-uninvited-music law holds (the user must tap play). It records the
  // saved position as a one-shot resume offset so that the user's NEXT play continues from
  // exactly where they left off rather than restarting at 0:00. A no-op when a track is
  // already loaded (a live session must never be clobbered by a stale snapshot).
  rehydrate(snapshot: {
    current: TrackRef;
    queue?: readonly TrackRef[];
    positionSec?: number;
    durationSec?: number;
    history?: readonly TrackRef[];
  }): void {
    if (this.state.current) return;
    const positionSec = Math.max(0, snapshot.positionSec ?? 0);
    this.pendingResume = {
      source: snapshot.current.source,
      nativeId: snapshot.current.nativeId,
      positionSec,
    };
    this.replaceContext(snapshot.queue ?? [], {
      current: snapshot.current,
      history: snapshot.history ? [...snapshot.history] : [],
      positionSec,
      durationSec: Math.max(0, snapshot.durationSec ?? 0),
      isPlaying: false,
      status: "idle",
      intent: "idle",
      engineState: "unstarted",
      recovery: { phase: "ok", skipOffered: false },
      notice: null,
    });
  }

  // Play a track (or resume the current one). Resolves the adapter for the track's
  // source and delegates; only marks `isPlaying` true once an adapter has acted, so
  // the state never lies about producing sound. Returns whether playback started.
  async play(track?: TrackRef, opts: { recordHistory?: boolean } = {}): Promise<boolean> {
    const requested = track ?? this.state.current;
    if (!requested) return false;

    // TRUE PREVIOUS back-stack (Wave 1): when we move to a DIFFERENT track, the one we are
    // leaving joins history so Previous can return to it. `recordHistory: false` is passed
    // by previous() itself (replaying a track off the stack must not re-push it) and by a
    // same-track restart. A fresh row tap or a Next advance records normally.
    const leaving = this.state.current;
    if (opts.recordHistory !== false && leaving && !sameTrack(leaving, requested)) {
      this.pushHistory(leaving);
    }

    // Consume any one-shot resume offset from a rehydrated session (FIX 2). It applies
    // ONLY when this play is for the same track that was restored; a fresh play of a
    // different track drops it. Cleared unconditionally so it can never leak into a later
    // play. `resumeSec` seeds the optimistic position and seeks the engine after load.
    const resume = this.pendingResume;
    this.pendingResume = null;
    const resumeSec =
      resume && resume.source === requested.source && resume.nativeId === requested.nativeId
        ? resume.positionSec
        : 0;

    // Ask the REQUESTED source's adapter whether the track needs substituting for an
    // actually-playable one (Spotify → matched YouTube version for a non-Premium user,
    // KTD-2/AE5). Sources that play natively have no resolvePlayable, so `target` stays
    // the requested track and `notice` stays null — identity, no branch on source here.
    let target = requested;
    let notice: string | null = null;
    const requestedAdapter = this.registry.get(requested.source);
    if (requestedAdapter?.resolvePlayable) {
      const resolution = await requestedAdapter.resolvePlayable(requested);
      if (!resolution.track) {
        // Nothing playable could be resolved: focus the requested track, keep silence,
        // and surface the plain-English reason. Never claim to be playing (R17).
        if (this.activeAdapter) {
          this.activeAdapter.pause();
          this.activeAdapter.unload();
          this.activeAdapter = null;
        }
        this.errorKind = "none";
        // A user-visible terminal error: nothing playable could be resolved and there is
        // nothing to fall back to, so the listener sees an error + Skip. Record it as a
        // COUNTABLE error (diagnostics-truth fix) so the panel can't read "0 errors" while
        // this shows. Once per play() call, so it never spams. Generic message, no song data.
        logActivity({
          level: "error",
          type: "playback-failed",
          message: "This track can't be played from its source — nothing to fall back to",
        });
        this.set({
          current: requested,
          isPlaying: false,
          positionSec: 0,
          notice: resolution.reason,
          status: "error",
          recovery: { phase: "error", skipOffered: this.state.queue.length > 0 },
          // Nothing playable resolved: the user's intent to hear sound cannot be honoured,
          // so intent is idle — recovery must not treat this frozen state as a stall.
          intent: "idle",
          engineState: "error",
        });
        return false;
      }
      target = resolution.track;
      notice = resolution.notice;
    }

    // The engine is whichever adapter owns the RESOLVED track's source — for a Spotify
    // fallback that is the YouTube adapter, so playback flows through the visible video
    // (KTD-7) exactly as a native YouTube track would.
    const adapter = this.registry.get(target.source);
    // Switch active adapter if the source changed; stop the previous one honestly.
    if (this.activeAdapter && this.activeAdapter !== adapter) {
      this.activeAdapter.pause();
      this.activeAdapter.unload();
    }
    this.activeAdapter = adapter ?? null;

    if (!adapter) {
      // No engine for this source yet: focus the track but do not fake playback.
      this.errorKind = "none";
      this.set({
        current: target,
        isPlaying: false,
        positionSec: 0,
        notice,
        status: "idle",
        recovery: { phase: "ok", skipOffered: false },
        // No engine for this source yet: focus the track but do not claim intent to play
        // something nothing can play.
        intent: "idle",
        engineState: "unstarted",
      });
      return false;
    }

    // Optimistic focus: reflect the chosen track in state BEFORE we create/start the
    // underlying player, so a source whose UI surface depends on `current` (the visible
    // YouTube video, U7/KTD-7) mounts on-screen first and the player is created inside a
    // visible container rather than a hidden one. `isPlaying` stays honest — it flips to
    // true only after the adapter has actually acted (R17 at the state layer).
    // A fresh load clears any prior engine error and resets the recovery ladder — this
    // track starts life healthy and is judged on its own playback.
    this.errorKind = "none";
    this.set({
      current: target,
      isPlaying: false,
      // Seed the scrub at the rehydrated resume position (0 for a normal fresh play), so
      // the UI shows the right spot the instant the track focuses rather than flashing 0:00.
      positionSec: resumeSec,
      notice,
      status: "loading",
      recovery: { phase: "ok", skipOffered: false },
      // The user asked for sound: intent is "play". This is the ONLY signal recovery
      // gates on — it is set by a user command here, never manufactured by the ladder.
      intent: "play",
      engineState: "unstarted",
    });
    try {
      await adapter.load(target);
      // Restored session: jump the freshly-loaded engine to where the user left off BEFORE
      // starting, so playback continues from there rather than from 0:00 (FIX 2).
      if (resumeSec > 0) {
        adapter.seek(resumeSec);
        this.set({ positionSec: resumeSec });
      }
      await adapter.play();
    } catch {
      // The engine could not start: honest error state, never a silent stuck "loading".
      // The recovery monitor will drive the ladder (advance to an alternate / offer Skip).
      this.errorKind = "soft";
      this.set({ isPlaying: false, status: "error" });
      return false;
    }
    // Re-assert the user's chosen volume on the freshly-built player (owner fix 3) so a new
    // track never resets to full when the engine rebuilds.
    this.applyVolume();
    // Only claim "playing" if an error did not arrive during load/play (onError can fire
    // between here and the awaits). Never overwrite a known-bad engine back to "playing".
    if (this.errorKind === "none") {
      this.set({ isPlaying: true, status: "playing" });
    } else {
      this.set({ isPlaying: true });
    }
    return true;
  }

  // Pause the active adapter. No-op (but still reflects intent) when nothing plays.
  // Paused maps to the "idle" machine phase (the surfaced vocabulary has no separate
  // "paused"); isPlaying stays the fine-grained truth for the UI.
  pause(): void {
    this.activeAdapter?.pause();
    // Pausing is a definitive "the user does not want sound right now": intent → pause and
    // any lingering engine-error flag is cleared, so the recovery monitor can never re-arm
    // the ladder on a paused track (the R4 false-stall-while-paused class).
    this.errorKind = "none";
    this.set({ isPlaying: false, status: "idle", intent: "pause" });
  }

  // Resume the current track. When its player is still loaded (merely PAUSED in place —
  // e.g. after the DJ console borrowed the decks), re-issue play on the SAME adapter with
  // NO reload, so playback continues from the exact paused position rather than restarting
  // from 0:00 (a resume must resume, never restart). Falls back to a full play() — which
  // loads — only when there is no live adapter/track to resume.
  async resume(): Promise<boolean> {
    if (this.activeAdapter && this.state.current) {
      this.set({ status: "loading", intent: "play" });
      try {
        await this.activeAdapter.play();
      } catch {
        this.errorKind = "soft";
        this.set({ isPlaying: false, status: "error" });
        return false;
      }
      this.applyVolume();
      this.set(
        this.errorKind === "none"
          ? { isPlaying: true, status: "playing" }
          : { isPlaying: true },
      );
      return true;
    }
    return this.play();
  }

  // Toggle between playing and paused for the current track. It asks the SAME reading the
  // buttons render from (describePlayback), so the icon and what the tap does can never
  // disagree: a stuck track shows Play and a tap tries to play it, rather than showing
  // Pause and "pausing" silence.
  async toggle(): Promise<void> {
    if (describePlayback(this.state).transportAction === "pause") {
      this.pause();
    } else {
      await this.resume();
    }
  }

  // Re-issue playback on the active adapter WITHOUT resetting position — the first,
  // cheapest rung of the recovery ladder (a transient-buffer nudge). Honest no-op when
  // nothing is actively playing, so it never fakes a recovery it cannot perform.
  async retry(): Promise<void> {
    if (!this.activeAdapter || !this.state.current) return;
    await this.activeAdapter.play();
  }

  // Ladder rung 2: destroy and REBUILD the underlying player on the same track — a
  // fresh iframe for a wedged one, which a bare playVideo() nudge cannot fix. Clears the
  // engine-error flag first so the rebuilt player is judged on its own outcome.
  async recreate(): Promise<boolean> {
    if (!this.activeAdapter || !this.state.current) return false;
    const track = this.state.current;
    this.errorKind = "none";
    try {
      this.activeAdapter.unload();
      await this.activeAdapter.load(track);
      await this.activeAdapter.play();
    } catch {
      this.errorKind = "soft";
      return false;
    }
    this.applyVolume();
    if (this.errorKind === "none") this.set({ isPlaying: true, status: "playing" });
    return this.errorKind === "none";
  }

  // The engine (a source adapter) reports that the CURRENT track hit a playback error.
  // Recorded, never hidden (R18). It does NOT itself flip the surfaced state — the
  // recovery monitor reads the kind and drives the honest ladder — so a track that then
  // plays via an alternate is never wrongly frozen as "error". A "fatal" kind (embed
  // refused / unavailable) tells the ladder retrying is futile: advance to an alternate.
  reportError(info: { message: string; kind: EngineErrorKind; code?: number }): void {
    if (!this.state.current) return;
    this.errorKind = info.kind;
    logActivity({
      level: "error",
      type: "playback-error",
      message: info.message,
      detail: info.code != null ? { code: info.code, kind: info.kind } : { kind: info.kind },
    });
  }

  // The current engine-error kind since the track's last (re)load — read by the
  // recovery monitor each tick to decide how hard to work the ladder.
  currentErrorKind(): EngineErrorKind {
    return this.errorKind;
  }

  // The active adapter mirrors its own engine lifecycle here (see EngineState). The
  // recovery monitor reads it together with `intent` so a stall is only ever declared
  // when the user wants sound AND the engine claims to be playing/buffering but the
  // clock is frozen — never on a paused/unstarted/ended engine.
  reportEngineState(state: EngineState): void {
    if (this.state.engineState === state) return;
    this.set({ engineState: state });
  }

  currentEngineState(): EngineState {
    return this.state.engineState;
  }

  // Publish the recovery-ladder phase into the single truth so every surface (mini
  // data-player-state, Now Playing banner, robot tester) renders the same honest health.
  // `forTrackKey` is the track the monitor SAMPLED when it reached this verdict. A tick
  // that lands after the listener has already moved on is about a track that is no longer
  // playing, so it is dropped rather than stamped onto the new one (the same class fix as
  // notice lifetime: a judgement belongs to what it judged).
  setRecovery(phase: RecoveryPhase, skipOffered: boolean, forTrackKey?: string | null): void {
    if (forTrackKey !== undefined && forTrackKey !== trackKey(this.state.current)) return;
    const prev = this.state.recovery;
    if (prev.phase === phase && prev.skipOffered === skipOffered) return;
    this.set({ recovery: { phase, skipOffered } });
  }

  // The honest terminal: the ladder is exhausted and there is nothing to advance to.
  // Stop pretending to play — surface a plain error + a working Skip, never a silent
  // freeze or an endless "retrying" (AE1). Pauses the wedged engine so no ghost audio.
  failStalled(forTrackKey?: string | null): void {
    if (!this.state.current) return;
    // Same rule as setRecovery: only fail the track this verdict was actually reached for.
    if (forTrackKey !== undefined && forTrackKey !== trackKey(this.state.current)) return;
    this.activeAdapter?.pause();
    // Record the honest terminal as a COUNTABLE error — this is the diagnostics-truth fix.
    // Without it the recovery attempts logged at info level along the way never add up to an
    // error, so the panel could read "0 errors" while the player shows "won't play". Logged
    // exactly ONCE per wedged episode: the recovery hook already de-bounces the call
    // (terminalKeyRef), and this transition guard is belt-and-braces so a repeat call while
    // the track is already in its terminal cannot double-count. No song data — records only
    // what happened, matching the log's existing style.
    const alreadyTerminal =
      this.state.status === "error" &&
      this.state.recovery.phase === "error" &&
      this.state.notice === WONT_PLAY_NOTICE;
    if (!alreadyTerminal) {
      logActivity({
        level: "error",
        type: "playback-failed",
        message: "This track won't play after several tries — moving on",
      });
    }
    // Intent stays "play" — the user still wants this track; the app simply cannot play it
    // and says so honestly (recovery.phase "error" + Skip). Keeping intent stable lets the
    // health machine hold its terminal instead of resetting to idle and clearing the error.
    this.set({
      isPlaying: false,
      status: "error",
      notice: WONT_PLAY_NOTICE,
      recovery: { phase: "error", skipOffered: this.state.queue.length > 0 },
    });
  }

  // Advance to the next queued track (honouring repeat and shuffle). Returns false
  // when the queue is exhausted and neither repeat nor radio continuation carries on.
  //
  // `reason` distinguishes a GENUINE end-of-track advance ("ended", fired by the engine's
  // own ended event) from a user's manual Next ("user"). Only a genuine end honours the
  // sleep timer's "stop at end of track" — a manual skip means the user wants the next
  // track, so the timer stays armed for the NEXT track's end.
  async next(reason: "ended" | "user" = "user"): Promise<boolean> {
    // SLEEP TIMER (Wave 1): stop at the end of THIS track. Consumed once, honestly pauses
    // instead of advancing or continuing radio. Only on a real end, never a manual skip.
    if (reason === "ended" && this.state.sleepStopAfterTrack) {
      this.set({ sleepStopAfterTrack: false });
      this.pause();
      return false;
    }
    if (this.state.repeat === "one" && this.state.current) {
      return this.play(this.state.current);
    }
    if (this.entries.length === 0) {
      if (this.state.repeat === "all" && this.state.current) {
        return this.play(this.state.current);
      }
      // Queue exhausted, repeat off: continue with similar tracks if the user consented
      // (RADIO CONTINUATION, Wave 1) — otherwise stop honestly (return false).
      return this.continueRadio();
    }
    // ALWAYS the head. Shuffle is no longer a die rolled here - the queue was already
    // projected into shuffled order when it was built (see `shuffled()` and toggleShuffle),
    // so the track that plays is literally the one the queue screen shows at the top.
    const head = this.entries[0];
    const rest = this.entries.slice(1);
    // If repeat is "all", the finished current track rejoins the tail of the queue.
    const nextQueue =
      this.state.repeat === "all" && this.state.current
        ? [...rest, PlayerStore.asContext(this.state.current)]
        : rest;
    this.commitEntries(nextQueue);
    return this.play(head.track);
  }

  // RADIO CONTINUATION (Wave 1): seed similar tracks from the last-played track and keep
  // listening going, once the queue has run out. This is the ONE sanctioned auto-play —
  // it fires ONLY when the user's "autoplay similar" setting is on (consent) and a provider
  // is wired, and it announces itself via `radioActive` (the Now Playing banner). When no
  // provider is wired, consent is off, or nothing similar is found, it stops honestly.
  private async continueRadio(): Promise<boolean> {
    const seed = this.state.current;
    if (!seed || !this.autoplaySimilar || !this.radioProvider) return false;
    let similar: readonly TrackRef[] = [];
    try {
      similar = await this.radioProvider(seed);
    } catch {
      return false; // a failed lookup stops honestly rather than faking continuation
    }
    // Drop the seed itself and anything already in the back-stack so radio never
    // immediately repeats a song the listener just heard.
    const fresh = similar.filter(
      (t) =>
        !sameTrack(t, seed) && !this.state.history.some((h) => sameTrack(h, t)),
    );
    if (fresh.length === 0) return false;
    const [head, ...rest] = fresh;
    // Replace the CONTEXT list only (not via setQueue, which would clear radioActive; any
    // hand-queued songs are already gone by definition - the queue ran dry) and mark the
    // stream active before playing so the banner shows the instant the first radio track loads.
    this.replaceContext(rest, { radioActive: true });
    return this.play(head);
  }

  // TRUE PREVIOUS (Wave 1). Industry-standard behaviour: if we are more than a few seconds
  // into the current track, Previous RESTARTS it; otherwise it goes BACK a song through the
  // history stack. When there is nothing to go back to it honestly restarts. Going back puts
  // the current track at the FRONT of the queue so Next still returns to it (a real back /
  // forward pair), and replays the popped track WITHOUT re-recording history.
  async previous(): Promise<boolean> {
    const current = this.state.current;
    if (!current) return false;
    // Deep into the track, or nothing to go back to → restart the current track.
    if (this.state.positionSec > PREVIOUS_RESTART_THRESHOLD_SEC || this.state.history.length === 0) {
      this.seek(0);
      return this.play(current, { recordHistory: false });
    }
    const history = [...this.state.history];
    const prev = history.pop()!;
    // The track we are stepping back FROM goes to the front of the queue so Next returns to
    // it - tagged "user" because it is a navigational promise, not part of the album being
    // played through, and must survive a change of context like any hand-queued song.
    this.commitEntries([{ track: current, origin: "user" }, ...this.entries], { history });
    return this.play(prev, { recordHistory: false });
  }

  // Whether Previous would go back a song (true) versus restart the current track (false),
  // for an honest control label. Restart when deep into the track or the stack is empty.
  canGoBack(): boolean {
    return (
      this.state.history.length > 0 &&
      this.state.positionSec <= PREVIOUS_RESTART_THRESHOLD_SEC
    );
  }

  // Seek to an absolute position; delegates to the active adapter and mirrors it in
  // state so the scrub bar reflects it immediately.
  seek(positionSec: number): void {
    const clamped = Math.max(
      0,
      this.state.durationSec > 0
        ? Math.min(positionSec, this.state.durationSec)
        : positionSec,
    );
    this.activeAdapter?.seek(clamped);
    // THE BUG THIS KILLS: after a reload the session is restored PAUSED with no adapter
    // loaded yet. Scrubbing then moved only the bar - there was no engine to seek - and the
    // next play() consumed the SAVED resume offset instead, so the bar visibly jumped
    // backwards and the listener's scrub was silently thrown away. A seek with no engine is
    // still a real instruction about where to start, so it REWRITES the pending resume point
    // rather than being dropped. Class-level: any future pre-engine seek is honoured too.
    if (!this.activeAdapter && this.state.current) {
      this.pendingResume = {
        source: this.state.current.source,
        nativeId: this.state.current.nativeId,
        positionSec: clamped,
      };
    }
    this.set({ positionSec: clamped });
  }

  // The volume actually sent to the engine: 0 while muted, otherwise the chosen level.
  // The single place mute + level combine, so every apply-point stays consistent.
  effectiveVolume(): number {
    return this.state.muted ? 0 : this.state.volume;
  }

  // Re-assert the effective volume on the active adapter. Called after every (re)load,
  // resume, and blend promotion so a user's chosen level survives track changes rather
  // than resetting to full each time a new player is built (owner fix 3). A freshly-built
  // player already starts at full, so a redundant setVolume(1) is skipped — only a genuinely
  // reduced (or muted) level is pushed down onto the new player.
  private applyVolume(): void {
    const effective = this.effectiveVolume();
    if (effective >= 1) return;
    this.activeAdapter?.setVolume(effective);
  }

  // Set output volume (0..1). The store owns volume truth: it records the level, unmutes
  // when the user drags above zero (a real move off mute), and pushes the effective value
  // to the active adapter immediately (owner fix 3). The shell persists it per user.
  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    // Dragging the slider up is an implicit unmute — the control never lies about silence.
    const muted = clamped === 0 ? this.state.muted : false;
    this.set({ volume: clamped, muted });
    this.applyVolume();
  }

  // Mute / unmute without losing the chosen level (unmute restores the prior volume).
  setMuted(muted: boolean): void {
    if (this.state.muted === muted) return;
    this.set({ muted });
    this.applyVolume();
  }

  toggleMute(): void {
    this.setMuted(!this.state.muted);
  }

  // AUTOPLAY UP-NEXT (owner fix 2). When the user plays a track without lining up a queue,
  // the "Up next" view must never read empty: seed it with radio-continuation picks (like
  // YouTube Music's auto-queue) so there is always something up next — visible, reorderable,
  // and removable — that also feeds playback at track end and gives the crossfade engine a
  // next track to melt into. Honesty (R17): it fires ONLY with the user's "Autoplay similar"
  // consent and a wired provider; it never overwrites a queue the user built (runs only when
  // the queue is empty), and it marks the seeded picks so the view can label them truthfully.
  async seedAutoplayQueue(): Promise<void> {
    const seed = this.state.current;
    if (!seed || this.state.queue.length > 0) return;
    if (!this.autoplaySimilar || !this.radioProvider) return;
    let similar: readonly TrackRef[] = [];
    try {
      similar = await this.radioProvider(seed);
    } catch {
      return; // a failed lookup leaves the queue honestly empty, never a faked list
    }
    // Drop the seed and anything already heard so the autoplay list is genuinely "next".
    const fresh = similar.filter(
      (t) => !sameTrack(t, seed) && !this.state.history.some((h) => sameTrack(h, t)),
    );
    // Guard against a race: only apply if the queue is still empty and the seed is unchanged.
    if (fresh.length === 0) return;
    if (this.state.queue.length > 0) return;
    if (!this.state.current || !sameTrack(this.state.current, seed)) return;
    this.replaceContext(fresh, { autoplayQueued: true });
  }

  // Set playback rate; the adapter clamps to its own supported range.
  setRate(rate: number): void {
    this.activeAdapter?.setRate(rate);
  }

  // Position/duration are pushed in by the active adapter's polling loop; the store
  // does not compute them. These are the only writers of those fields besides seek().
  reportPosition(positionSec: number, durationSec?: number): void {
    const next = Math.max(0, positionSec);
    // Real forward progress means the engine recovered — clear any lingering error flag
    // so the recovery ladder does not keep trying to escape a track that is now playing.
    if (this.errorKind !== "none" && next > this.state.positionSec + 0.25) {
      this.errorKind = "none";
    }
    this.set({
      positionSec: next,
      ...(durationSec != null ? { durationSec: Math.max(0, durationSec) } : {}),
    });
  }

  // Adopt an already-playing incoming track as the current one at the END of an
  // auto-crossfade (U11). The blend engine warmed and ramped the incoming up on a
  // second player and the adapter has just promoted it to primary WITHOUT a reload;
  // this reflects that in the single truth — it makes the incoming `current`, drops
  // it from the head of the queue, and keeps `isPlaying` true. It deliberately does
  // NOT touch the active adapter (the source is unchanged — two YouTube players
  // swapped inside the one adapter) and does NOT re-issue playback (no restart), so
  // the audio the user already hears simply continues.
  promoteBlended(track: TrackRef): void {
    // The outgoing track (the one we crossfaded away from) joins the Previous back-stack,
    // just as a Next advance would — a blended transition is still a forward move.
    const leaving = this.state.current;
    if (leaving && !sameTrack(leaving, track)) this.pushHistory(leaving);
    const idx = this.entries.findIndex((e) => sameTrack(e.track, track));
    const queue = idx >= 0 ? this.entries.filter((_, i) => i !== idx) : [...this.entries];
    this.commitEntries(queue, {
      current: track,
      isPlaying: true,
      positionSec: 0,
      status: "playing",
      intent: "play",
      engineState: "playing",
    });
    // The promoted player is a freshly-built engine; re-assert the user's volume on it so a
    // crossfade never leaves playback stuck at full after the equal-power ramp (owner fix 3).
    this.applyVolume();
  }

  // Toggle shuffle AND re-project the visible queue into the order it will really play.
  //
  // THE BUG THIS KILLS: shuffle used to be a bare flag that a die-roll inside next()
  // consulted at advance time, so the queue screen went on listing the original order while
  // playback wandered off somewhere else - "Up next" was a lie for as long as shuffle was on.
  // Re-ordering the list here is the class-level fix: there is now only ONE order in the
  // system, so the screen and the engine cannot disagree.
  //
  // Only the CONTEXT part is shuffled. Songs the listener queued by hand keep the order they
  // were put in (same as Spotify/YTM) - shuffling an album is a request about the album.
  // Turning shuffle back off restores the context's original running order, minus anything
  // removed in the meantime.
  toggleShuffle(): void {
    const shuffle = !this.state.shuffle;
    const user = this.entries.filter((e) => e.origin === "user");
    const context = this.entries.filter((e) => e.origin === "context").map((e) => e.track);
    const ordered = shuffle
      ? shuffled(context)
      : [
          // Original order first, keeping only what is still queued...
          ...this.contextOrder.filter((t) => context.some((c) => sameTrack(c, t))),
          // ...then anything that joined the context later and has no recorded place.
          ...context.filter((t) => !this.contextOrder.some((c) => sameTrack(c, t))),
        ];
    this.commitEntries([...user, ...ordered.map(PlayerStore.asContext)], { shuffle });
  }

  // Cycle off → all → one → off (prototype repeat button behaviour).
  cycleRepeat(): void {
    const order: RepeatMode[] = ["off", "all", "one"];
    const nextIndex = (order.indexOf(this.state.repeat) + 1) % order.length;
    this.set({ repeat: order[nextIndex] });
  }
}

// The app's shared player store instance. UI surfaces import this one so they all
// read the same single truth.
export const playerStore = new PlayerStore();

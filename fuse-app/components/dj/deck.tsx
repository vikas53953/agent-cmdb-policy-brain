"use client";

// A single DJ deck (U13 + U14 + DJ-1, R12/R13/R14/R17, AE3/AE4, F3). One of the two
// decks in the console. Its source picker and control set are driven entirely by the
// deck model (deck-model.ts), which composes the capability matrix with what actually
// works in THIS commit — so the deck can never show a control that does nothing.
//
// What genuinely works here:
//   - YouTube (U13): select YouTube, load a real video into a VISIBLE player, play /
//     pause, change speed; the crossfader volume applies to it. It is deliberately a
//     SPEED-ONLY deck — the honesty matrix greys everything else, because YouTube hands
//     us no audio to process. It shows no waveform (video preview only).
//   - My Files (U14 + DJ-1): pick a local audio file, decoded IN THE BROWSER and NEVER
//     uploaded (R14), and drive the FULL engine on it — scrolling + overview waveform,
//     auto BPM with manual TAP, a beatgrid, 4 saved hot cues, on-grid beat loops, a
//     HP/LP filter, 3-band EQ with kills, trim with a live level meter, echo and scratch.
//   - Spotify playback (lands in U15) is honestly disabled with a plain reason.
//
// Every new DJ-1 control lives ONLY in the My Files branch — the one source that can
// truly do it — so the honesty law holds by construction.

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackRef, TrackSource } from "@/lib/repos/track";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { LOCAL_RATE_RANGE } from "@/lib/player/capabilities";
import {
  createYouTubeAdapter,
  type YouTubeAdapter,
} from "@/lib/player/adapters/youtube";
import {
  createDjDeckEngine,
  EQ_GAIN_RANGE,
  TRIM_RANGE,
  type DjDeckEngine,
  type EqBand,
} from "@/lib/dj/engine";
import { BEAT_LOOP_BARS, beatLoopRegion, bpmTrustLabel, tapTempo } from "@/lib/dj/analysis";
import { localTrackKey } from "@/lib/dj/fingerprint";
import { listCuesAction, setCueAction, deleteCueAction } from "@/lib/dj-actions";
import {
  DJ_SPOTIFY_NOTICE,
  capabilityPointer,
  parseYouTubeId,
  resolveDeckControlsFor,
  resolveDeckSourceOptions,
  type DeckId,
} from "@/components/dj/deck-model";
import {
  EMPTY_DECK_SESSION,
  fileAgainNotice,
  needsFileAgain,
  type DjDeckSession,
} from "@/lib/dj/session-state";
import CapabilityBadges from "@/components/dj/capability-badges";
import DeckWaveform, { type CueMarker } from "@/components/dj/deck-waveform";
import { PlayIcon, PauseIcon } from "@/components/ui/icons";

const [RATE_MIN, RATE_MAX] = LOCAL_RATE_RANGE;
const [EQ_MIN, EQ_MAX] = EQ_GAIN_RANGE;
const [TRIM_MIN, TRIM_MAX] = TRIM_RANGE;

type EqState = { low: number; mid: number; high: number };
type KillState = { low: boolean; mid: boolean; high: boolean };
const FLAT_EQ: EqState = { low: 0, mid: 0, high: 0 };
const NO_KILL: KillState = { low: false, mid: false, high: false };

// The four DJ-1 hot-cue pads.
const CUE_SLOTS = [0, 1, 2, 3] as const;
// A gap longer than this between taps starts a fresh TAP measurement.
const TAP_RESET_SEC = 2;

const EQ_BANDS: readonly { band: EqBand; label: string }[] = [
  { band: "low", label: "Low" },
  { band: "mid", label: "Mid" },
  { band: "high", label: "High" },
];

type Analysis = {
  peaks: readonly number[];
  bpm: number;
  bpmConfidence: number;
  duration: number;
};
const NO_ANALYSIS: Analysis = { peaks: [], bpm: 0, bpmConfidence: 0, duration: 0 };

export default function Deck({
  deckId,
  accent,
  source,
  otherSource,
  onSelectSource,
  volume,
  restore = EMPTY_DECK_SESSION,
  onStateChange,
}: {
  deckId: DeckId;
  accent: "a" | "b";
  source: TrackSource | null;
  otherSource: TrackSource | null;
  onSelectSource: (source: TrackSource | null) => void;
  volume: number;
  // F-6: the snapshot this deck was left in, restored on mount. Defaults to a fresh deck
  // so the component still stands alone (and so a first-ever visit is unaffected).
  restore?: DjDeckSession;
  // Called whenever a persisted setting changes, so the console can snapshot the console.
  onStateChange?: (deck: DjDeckSession) => void;
}) {
  const adapterRef = useRef<YouTubeAdapter | null>(null);
  const engineRef = useRef<DjDeckEngine | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const [deckPos, setDeckPos] = useState(0);
  // The slice of the player bridge a DJ deck genuinely implements. A deck is NOT a queue:
  // it holds one loaded track that the DJ chose, so there is nothing to "advance" to. We
  // say that out loud (return false = nothing was advanced) but still act on the reason:
  // when the video truly ends, the deck stops showing Pause.
  //
  // reportError is the deck's honest failure path. The adapter reports every runtime
  // playback problem here — a blocked embed, a video pulled mid-play, an iframe error —
  // and the deck must show it instead of sitting there with a Pause button over dead
  // sound. A fatal problem also drops the loaded id, because that video can never play.
  const bridgeRef = useRef({
    reportPosition: (positionSec: number) => setDeckPos(positionSec > 0 ? positionSec : 0),
    next: async (reason?: "ended" | "user") => {
      if (reason === "ended") setIsPlaying(false);
      return false; // a deck has no next track — nothing to advance to
    },
    reportError: (info: { message: string; kind: "soft" | "fatal"; code?: number }) => {
      setIsPlaying(false);
      setLoading(false);
      if (info.kind === "fatal") {
        setLoadedId(null);
        setLoadError(`${info.message}. Paste another link to keep going.`);
      } else {
        setLoadError(`${info.message}. Press play to try it again.`);
      }
    },
  });

  const [linkInput, setLinkInput] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // F-6: every persisted knob seeds from the restored snapshot, so the deck's FIRST render
  // is already the deck the DJ left. A fresh visit gets EMPTY_DECK_SESSION's defaults,
  // which are the same values these used to be hard-coded to.
  const [rate, setRate] = useState(restore.rate);

  // Local-files (Web Audio) deck state (U14 + DJ-1).
  const [localName, setLocalName] = useState<string | null>(null);
  const [localLoaded, setLocalLoaded] = useState(false);
  const [trackKey, setTrackKey] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis>(NO_ANALYSIS);
  const [bpm, setBpm] = useState(0); // detected, or overridden by TAP
  const [eq, setEqState] = useState<EqState>(restore.eq);
  const [kills, setKills] = useState<KillState>(restore.kills);
  const [filterAmt, setFilterAmt] = useState(restore.filterAmt);
  const [trim, setTrimState] = useState(restore.trim);
  const [meter, setMeter] = useState(0);
  const [beatLoopBars, setBeatLoopBars] = useState<number | null>(null);
  const [echoOn, setEchoOn] = useState(restore.echo);
  const [scratchVal, setScratchVal] = useState(0);
  const [cues, setCues] = useState<CueMarker[]>([]);
  // Whether the BPM on screen came from the DJ's own taps rather than auto-detection.
  const [bpmTapped, setBpmTapped] = useState(false);
  // A plain line under the cue pads when a save or a clear did not stick. Kept separate
  // from loadError so a cue problem never makes the whole deck read as broken.
  const [cueNotice, setCueNotice] = useState<string | null>(null);
  const tapTimesRef = useRef<number[]>([]);

  // The beatgrid starts at the track's beginning (firstBeat = 0) in DJ-1 — enough to
  // snap loops/cues to the tempo; a movable grid anchor is DJ-2.
  const firstBeatSec = 0;

  const options = resolveDeckSourceOptions({ deck: deckId, otherDeckSource: otherSource });

  // Is there actually something on this deck to act on? The third honesty axis (F-7):
  // a YouTube deck needs a video, a My Files deck needs decoded audio. Spotify can never
  // load anything yet, so it is never "loaded".
  const hasTrack =
    (source === "youtube" && loadedId !== null) || (source === "local" && localLoaded);

  // Every control's live/disabled state and its plain-English reason, from ONE resolved
  // matrix: what the source can do, whether its engine is wired, and whether anything is
  // loaded. Nothing in the render below re-decides any of that locally.
  const controls = source
    ? resolveDeckControlsFor(source, { deck: deckId, otherDeckSource: otherSource }, hasTrack)
    : null;
  const capsPointer = source
    ? capabilityPointer(source, { deck: deckId, otherDeckSource: otherSource })
    : null;

  // F-6: the video this deck held when the DJ last left, waiting to be put back. Consumed
  // once — a later source change must not resurrect it.
  const pendingRestoreIdRef = useRef<string | null>(
    restore.source === "youtube" ? restore.youtubeId : null,
  );
  // F-6: the file whose settings survived but whose audio could not. Cleared as soon as
  // the DJ picks a file (any file) — the notice must not outlive its usefulness.
  const [fileToPickAgain, setFileToPickAgain] = useState<string | null>(
    needsFileAgain(restore) ? restore.localFileName : null,
  );

  // Spin up (and tear down) a private YouTube player when this deck is on YouTube.
  useEffect(() => {
    if (source !== "youtube") return;
    const adapter = createYouTubeAdapter({ store: bridgeRef.current });
    adapterRef.current = adapter;
    const host = hostRef.current;
    if (host) adapter.mount(host);

    // F-6: put back the video this deck was left holding. Loaded and CUED, never played —
    // coming back to a tab must not start sound on its own, exactly as the mini-player's
    // rehydration restores its track paused.
    const restoreId = pendingRestoreIdRef.current;
    pendingRestoreIdRef.current = null;
    if (restoreId) {
      const track: TrackRef = {
        source: "youtube",
        nativeId: restoreId,
        title: `YouTube · ${restoreId}`,
        artist: null,
        artUrl: null,
        durationSec: null,
      };
      void adapter
        .load(track)
        .then(() => {
          adapter.setVolume(volume);
          adapter.setRate(rate);
          setLoadedId(restoreId);
          setIsPlaying(false);
        })
        .catch(() => {
          // The video is gone or refuses to embed now. Say so rather than showing a
          // transport over nothing.
          setLoadedId(null);
          setLoadError("That video won't load any more. Paste another link to keep going.");
        });
    }

    return () => {
      if (host) adapter.unmount(host);
      adapter.unload();
      adapterRef.current = null;
    };
    // `volume`/`rate` are read for the restore only; re-running this effect on a volume
    // change would tear down and rebuild the player mid-track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Spin up (and dispose) a private Web Audio engine when this deck is on My Files.
  useEffect(() => {
    if (source !== "local") return;
    const engine = createDjDeckEngine();
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [source]);

  // Keep the live player's volume in step with the crossfader.
  useEffect(() => {
    adapterRef.current?.setVolume(volume);
    engineRef.current?.setCrossfade(volume);
  }, [volume]);

  // F-6: report every persisted setting up to the console, which owns the one snapshot.
  // One effect over all of them rather than a call inside each handler — a handler that
  // forgot to report would be a silent hole, and this way a knob added later is persisted
  // the moment it is added to this dependency list.
  useEffect(() => {
    onStateChange?.({
      source,
      youtubeId: source === "youtube" ? loadedId : null,
      // Whichever name is current: the freshly picked file, or the one still waiting to
      // be picked again.
      localFileName: source === "local" ? (localName ?? fileToPickAgain) : null,
      rate,
      eq,
      kills,
      filterAmt,
      trim,
      echo: echoOn,
    });
  }, [
    onStateChange,
    source,
    loadedId,
    localName,
    fileToPickAgain,
    rate,
    eq,
    kills,
    filterAmt,
    trim,
    echoOn,
  ]);

  // While a local file is loaded, run an animation loop that reads the engine's REAL
  // position and level so the waveform playhead moves and the meter breathes with the
  // actual sound (never a faked animation).
  useEffect(() => {
    if (source !== "local" || !localLoaded) return;
    let raf = 0;
    const tick = () => {
      const engine = engineRef.current;
      if (engine) {
        const pos = engine.position();
        setDeckPos(pos > 0 ? pos : 0);
        setMeter(engine.getLevel());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source, localLoaded]);

  // Reset everything loaded on this deck when its source changes (honest fresh state).
  //
  // IDEMPOTENT BY LAW (the F-6 collision). Picking the source this deck is ALREADY on is a
  // no-op — it never clears the deck and never hands `null` back up. This used to toggle
  // off, which was invisible while the console always started sourceless: your first tap
  // could only ever be a fresh pick. Once the console started restoring its source on
  // mount, that same tap landed on an already-selected button and silently tore the deck
  // down — the loaded file, the cue pads and the restored video all gone.
  //
  // The class rule this encodes: restored state and an explicit user selection must not
  // fight each other. "Put me on My Files" must mean the same thing whether the deck got
  // there by restore or by an earlier tap, so re-asserting a selection is always safe.
  function selectSource(next: TrackSource) {
    if (next === source) return;
    setLinkInput("");
    setLoadedId(null);
    setIsPlaying(false);
    setLoadError(null);
    setRate(1);
    setDeckPos(0);
    setLocalName(null);
    setLocalLoaded(false);
    setTrackKey(null);
    setAnalysis(NO_ANALYSIS);
    setBpm(0);
    setEqState(FLAT_EQ);
    setKills(NO_KILL);
    setFilterAmt(0);
    setTrimState(1);
    setMeter(0);
    setBeatLoopBars(null);
    setEchoOn(false);
    setScratchVal(0);
    setCues([]);
    setBpmTapped(false);
    setCueNotice(null);
    // A deliberate source change is a deliberate fresh start: the "pick your file again"
    // note is about the deck you came back to, not the one you just chose.
    setFileToPickAgain(null);
    pendingRestoreIdRef.current = null;
    tapTimesRef.current = [];
    onSelectSource(next);
  }

  async function loadYouTube() {
    const id = parseYouTubeId(linkInput);
    if (!id) {
      setLoadError("That doesn't look like a YouTube link or video id.");
      return;
    }
    const adapter = adapterRef.current;
    if (!adapter) return;
    setLoading(true);
    setLoadError(null);
    try {
      const track: TrackRef = {
        source: "youtube",
        nativeId: id,
        title: `YouTube · ${id}`,
        artist: null,
        artUrl: null,
        durationSec: null,
      };
      await adapter.load(track);
      adapter.setVolume(volume);
      adapter.setRate(rate);
      await adapter.play();
      setLoadedId(id);
      setIsPlaying(true);
    } catch {
      setLoadError("Could not load that video. Try another link.");
    } finally {
      setLoading(false);
    }
  }

  async function togglePlay() {
    const adapter = adapterRef.current;
    if (!adapter || !loadedId) return;
    if (isPlaying) {
      adapter.pause();
      setIsPlaying(false);
    } else {
      // Retrying after a soft error: clear the old message so the deck doesn't keep
      // showing a failure it is actively trying again.
      setLoadError(null);
      await adapter.play();
      setIsPlaying(true);
    }
  }

  function changeRate(next: number) {
    setRate(next);
    adapterRef.current?.setRate(next);
    engineRef.current?.setRate(next);
  }

  // ── My Files (Web Audio) handlers (U14 + DJ-1) ─────────────────────────────────

  async function pickFile(file: File | undefined) {
    const engine = engineRef.current;
    if (!engine || !file) return;
    if (!engine.available) {
      setLoadError("Your browser can't play decoded audio, so files can't be loaded here.");
      return;
    }
    setLoadError(null);
    setLoading(true);
    try {
      // Read the bytes once: decode them (never uploaded — R14) AND fingerprint them so
      // this file's saved cues can be found (fingerprint is derived on-device).
      const bytes = await file.arrayBuffer();
      const key = localTrackKey(new Uint8Array(bytes), file.name);
      await engine.resume();
      await engine.loadArrayBuffer(bytes);
      // Re-apply the current control values onto the freshly decoded buffer.
      engine.setRate(rate);
      engine.setCrossfade(volume);
      engine.setEq("low", eq.low);
      engine.setEq("mid", eq.mid);
      engine.setEq("high", eq.high);
      engine.setEqKill("low", kills.low);
      engine.setEqKill("mid", kills.mid);
      engine.setEqKill("high", kills.high);
      engine.setFilter(filterAmt);
      engine.setTrim(trim);
      engine.setEcho(echoOn);
      const a = engine.getAnalysis();
      setAnalysis({ peaks: a.peaks, bpm: a.bpm, bpmConfidence: a.bpmConfidence, duration: a.duration });
      setBpm(a.bpm);
      setBpmTapped(false);
      setCueNotice(null);
      setBeatLoopBars(null);
      engine.play();
      setLocalName(file.name);
      setLocalLoaded(true);
      // Audio is back — the "pick it again" note has done its job.
      setFileToPickAgain(null);
      setTrackKey(key);
      setIsPlaying(true);
      // Load this track's saved hot cues (empty on a keyless / signed-out run).
      void listCuesAction({ source: "local", nativeId: key })
        .then((saved) => {
          setCues(saved.map((c) => ({ slot: c.slot, positionSec: c.positionSec })));
        })
        .catch(() => {
          // The pads stay empty rather than pretending nothing was ever saved.
          setCues([]);
          setCueNotice("Your saved cues didn't load. Reload the page to try again.");
        });
    } catch {
      setLoadError("Couldn't read that audio file. Try another one.");
      setLocalLoaded(false);
      setIsPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  function toggleLocalPlay() {
    const engine = engineRef.current;
    if (!engine || !localLoaded) return;
    const nowPlaying = engine.toggle();
    setIsPlaying(nowPlaying);
  }

  function setEqBand(band: EqBand, db: number) {
    setEqState((prev) => ({ ...prev, [band]: db }));
    engineRef.current?.setEq(band, db);
  }

  function toggleKill(band: EqBand) {
    setKills((prev) => {
      const next = !prev[band];
      engineRef.current?.setEqKill(band, next);
      return { ...prev, [band]: next };
    });
  }

  function changeFilter(amount: number) {
    setFilterAmt(amount);
    engineRef.current?.setFilter(amount);
  }

  function changeTrim(gain: number) {
    setTrimState(gain);
    engineRef.current?.setTrim(gain);
  }

  function toggleEcho() {
    const next = !echoOn;
    setEchoOn(next);
    engineRef.current?.setEcho(next);
  }

  function onScratch(value: number) {
    setScratchVal(value);
    engineRef.current?.scratch(value);
  }

  function releaseScratch() {
    setScratchVal(0);
    engineRef.current?.endScratch();
  }

  // TAP tempo: time the taps and average them into a BPM override for when auto-detection
  // is unsure (or wrong). Resets after a pause so a fresh count starts clean.
  function onTap() {
    const now = performance.now() / 1000;
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > TAP_RESET_SEC) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    const tapped = tapTempo(taps);
    if (tapped !== null) {
      setBpm(tapped);
      setBpmTapped(true);
    }
  }

  // The active beatgrid BPM (TAP override wins over auto-detection).
  const gridBpm = bpm;

  // Hot cue: set on an empty pad (at the live playhead), or jump to a set pad. Persisted
  // per user+track via the server action.
  // A pad shows as set only once the server confirms the save. If the save comes back
  // empty (nothing was written), the pad goes back to empty and the DJ is told — a cue
  // that did not save must never look saved.
  const onCue = useCallback(
    async (slot: number) => {
      const engine = engineRef.current;
      if (!engine || !localLoaded || !trackKey) return;
      const existing = cues.find((c) => c.slot === slot);
      if (existing) {
        engine.seek(existing.positionSec); // JUMP
        return;
      }
      const pos = engine.position(); // SET at the live playhead
      setCues((prev) => [...prev.filter((c) => c.slot !== slot), { slot, positionSec: pos }]);
      setCueNotice(null);
      let saved: Awaited<ReturnType<typeof setCueAction>> = null;
      try {
        saved = await setCueAction({ source: "local", nativeId: trackKey }, slot, pos);
      } catch {
        saved = null;
      }
      if (!saved) {
        setCues((prev) => prev.filter((c) => c.slot !== slot));
        setCueNotice(`Cue ${slot + 1} didn't save. Set it again.`);
        return;
      }
      // Trust the saved row's position over the optimistic one.
      const row = saved;
      setCues((prev) => [
        ...prev.filter((c) => c.slot !== slot),
        { slot: row.slot, positionSec: row.positionSec },
      ]);
    },
    [cues, localLoaded, trackKey],
  );

  // Clearing is the same deal in reverse: if the row survives on the server, put the pad
  // back so it matches what is really saved (it would return on the next reload anyway).
  const onCueClear = useCallback(
    async (slot: number) => {
      if (!trackKey) return;
      const removed = cues.find((c) => c.slot === slot);
      if (!removed) return;
      setCues((prev) => prev.filter((c) => c.slot !== slot));
      setCueNotice(null);
      let ok = false;
      try {
        ok = await deleteCueAction({ source: "local", nativeId: trackKey }, slot);
      } catch {
        ok = false;
      }
      if (!ok) {
        setCues((prev) => [...prev.filter((c) => c.slot !== slot), removed]);
        setCueNotice(`Cue ${slot + 1} is still saved. Try clearing it again.`);
      }
    },
    [cues, trackKey],
  );

  // Beat loop: arm an on-grid loop of `bars` bars, or clear it if already active.
  function onBeatLoop(bars: number) {
    const engine = engineRef.current;
    if (!engine || !localLoaded) return;
    if (beatLoopBars === bars) {
      engine.setBeatLoop(null);
      setBeatLoopBars(null);
      return;
    }
    const region = beatLoopRegion(engine.position(), analysis.duration, gridBpm, firstBeatSec, bars);
    engine.setBeatLoop(region);
    setBeatLoopBars(bars);
  }

  const badge = source ? SOURCE_BADGES[source] : null;
  // Speed now reads straight off the resolved matrix. The old three-branch ternary that
  // re-derived "…but nothing is loaded" here was the bug F-7 is about: the same question
  // answered in one more place, in different words, and only in a hover tooltip. One
  // answer, one wording, one place.
  const speedLive = controls?.rate.available === true;
  const speedReason = controls && !controls.rate.available ? controls.rate.reason : null;

  const deckState = loadError
    ? "error"
    : loading
      ? "loading"
      : isPlaying
        ? "playing"
        : "idle";

  const bpmLabel = gridBpm > 0 ? gridBpm.toFixed(1) : "—";
  // How much the BPM on screen can be trusted, in plain words — the auto-detector hands
  // back a real confidence score, and hiding it would let a shaky guess look certain.
  const bpmTrustText = bpmTrustLabel({
    bpm: gridBpm,
    confidence: analysis.bpmConfidence,
    tapped: bpmTapped,
  });

  return (
    <section
      className={`deck deck-${accent}`}
      aria-label={`Deck ${deckId}`}
      data-testid={`deck-${deckId}`}
      data-deck-state={deckState}
      data-deck-position={deckPos.toFixed(2)}
      data-deck-bpm={gridBpm.toFixed(1)}
    >
      <div className="deck-head">
        <span className="deck-title">Deck {deckId}</span>
        {badge ? <span className={`badge ${badge.className}`}>{badge.label}</span> : null}
      </div>

      <div className="source-pick" role="group" aria-label={`Deck ${deckId} source`}>
        {options.map((opt) => {
          const label = SOURCE_BADGES[opt.source].label;
          const active = source === opt.source;
          return (
            <button
              key={opt.source}
              type="button"
              className={`spick${active ? " active" : ""}${opt.selectable ? "" : " locked"}`}
              data-testid={`deck-${deckId}-source-${opt.source}`}
              onClick={() => selectSource(opt.source)}
              disabled={!opt.selectable}
              aria-pressed={active}
              title={opt.reason ?? undefined}
            >
              <span className="spick-label">{label}</span>
              {opt.selectable ? null : <span className="spick-reason">{opt.reason}</span>}
            </button>
          );
        })}
      </div>

      {source === null ? (
        <p className="deck-hint">Pick a source above to load this deck.</p>
      ) : null}

      {source === "youtube" ? (
        <>
          <div className="deck-video" ref={hostRef} aria-label="Deck video" data-testid={`deck-${deckId}-video`} />
          <p className="deck-speed-only">
            YouTube is a speed-only deck — its sound is sealed in the player, so the
            waveform, EQ, filter, cues and loops stay off. What it can do stays live.
          </p>
          <div className="deck-load">
            <input
              type="text"
              className="deck-link"
              data-testid={`deck-${deckId}-link`}
              placeholder="Paste a YouTube link or video id"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              aria-label={`Deck ${deckId} YouTube link`}
            />
            <button
              type="button"
              className="deck-loadbtn"
              data-testid={`deck-${deckId}-load`}
              onClick={loadYouTube}
              disabled={loading || linkInput.trim() === ""}
            >
              {loading ? "Loading…" : loadedId ? "Swap" : "Load"}
            </button>
          </div>
          {loadError ? <p className="deck-error">{loadError}</p> : null}

          <div className="deck-transport">
            <button
              type="button"
              className="icon-btn primary deck-play"
              data-testid={`deck-${deckId}-play`}
              onClick={togglePlay}
              disabled={!loadedId}
              aria-label={isPlaying ? "Pause deck" : "Play deck"}
              title={loadedId ? undefined : "Load a track first"}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>

            <div className="deck-speed">
              <label className="deck-speed-label" htmlFor={`deck-${deckId}-speed`}>
                Speed <span className="deck-speed-val">{rate.toFixed(2)}×</span>
              </label>
              <input
                id={`deck-${deckId}-speed`}
                type="range"
                className="deck-speed-range"
                min={RATE_MIN}
                max={RATE_MAX}
                step={0.05}
                value={rate}
                onChange={(e) => changeRate(Number(e.target.value))}
                disabled={!speedLive}
                title={speedLive ? undefined : (speedReason ?? undefined)}
                aria-label={`Deck ${deckId} playback speed`}
              />
              {!speedLive && speedReason ? (
                <span className="deck-speed-reason">{speedReason}</span>
              ) : null}
            </div>
          </div>

          {controls ? <CapabilityBadges controls={controls} pointer={capsPointer} /> : null}
        </>
      ) : null}

      {source === "local" ? (
        <>
          <p className="deck-local-promise">
            Files stay on your device — decoded here in your browser, never uploaded. The
            waveform, BPM and cues are all computed on your machine.
          </p>

          {/* F-6: the one thing a returning deck honestly cannot bring back is the audio
              itself — the same promise that keeps it off our servers keeps it out of the
              snapshot. Say so, and name the file, rather than leaving the DJ to wonder
              why an empty deck has all their knobs set. */}
          {fileToPickAgain && !localLoaded ? (
            <p
              className="deck-restore-note"
              data-testid={`deck-${deckId}-restore-note`}
              role="status"
            >
              {fileAgainNotice(fileToPickAgain)}
            </p>
          ) : null}

          <div className="deck-load">
            <label className="deck-filebtn">
              {localName ? "Swap file" : "Choose a file"}
              <input
                type="file"
                accept="audio/*"
                className="deck-file-input"
                onChange={(e) => pickFile(e.target.files?.[0])}
                aria-label={`Deck ${deckId} audio file`}
              />
            </label>
            {localName ? (
              <span className="deck-filename" title={localName}>
                {localName}
              </span>
            ) : null}
          </div>
          {loadError ? <p className="deck-error">{loadError}</p> : null}

          {/* Waveform + overview — the "see the music" view (only local has samples). */}
          {localLoaded ? (
            <DeckWaveform
              deckId={deckId}
              accent={accent}
              peaks={analysis.peaks}
              durationSec={analysis.duration}
              positionSec={deckPos}
              bpm={gridBpm}
              firstBeatSec={firstBeatSec}
              cues={cues}
              onSeek={(p) => engineRef.current?.seek(p)}
            />
          ) : null}

          <div className="deck-transport">
            <button
              type="button"
              className="icon-btn primary deck-play"
              data-testid={`deck-${deckId}-play`}
              onClick={toggleLocalPlay}
              disabled={!localLoaded}
              aria-label={isPlaying ? "Pause deck" : "Play deck"}
              title={localLoaded ? undefined : "Load a file first"}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>

            {/* BPM readout + manual TAP override. */}
            <div className="deck-bpm">
              <span className="deck-bpm-val" data-testid={`deck-${deckId}-bpm`}>
                {bpmLabel}
                <small> BPM</small>
              </span>
              <button
                type="button"
                className="deck-tap"
                data-testid={`deck-${deckId}-tap`}
                onClick={onTap}
                disabled={!localLoaded}
                title={localLoaded ? "Tap the beat to set the tempo" : "Load a file first"}
                aria-label={`Deck ${deckId} tap tempo`}
              >
                TAP
              </button>
              {bpmTrustText ? (
                <span
                  className="deck-bpm-trust"
                  data-testid={`deck-${deckId}-bpm-trust`}
                  style={{ fontSize: "0.68rem", opacity: 0.75, display: "block" }}
                >
                  {bpmTrustText}
                </span>
              ) : null}
            </div>

            <div className="deck-speed">
              <label className="deck-speed-label" htmlFor={`deck-${deckId}-speed`}>
                Speed <span className="deck-speed-val">{rate.toFixed(2)}×</span>
              </label>
              <input
                id={`deck-${deckId}-speed`}
                type="range"
                className="deck-speed-range"
                min={RATE_MIN}
                max={RATE_MAX}
                step={0.05}
                value={rate}
                onChange={(e) => changeRate(Number(e.target.value))}
                disabled={!speedLive}
                title={speedLive ? undefined : (speedReason ?? undefined)}
                aria-label={`Deck ${deckId} playback speed`}
              />
            </div>
          </div>

          {/* Hot cues — 4 pads, set at the playhead / jump back, saved per track. */}
          <div className="deck-cues" role="group" aria-label={`Deck ${deckId} hot cues`}>
            {CUE_SLOTS.map((slot) => {
              const cue = cues.find((c) => c.slot === slot);
              return (
                <div key={slot} className={`deck-cue${cue ? " set" : ""}`}>
                  <button
                    type="button"
                    className="deck-cue-btn"
                    data-testid={`deck-${deckId}-cue-${slot}`}
                    onClick={() => onCue(slot)}
                    disabled={!localLoaded}
                    title={localLoaded ? (cue ? "Jump to cue" : "Set cue here") : "Load a file first"}
                    aria-label={`Deck ${deckId} cue ${slot + 1}${cue ? " (set — jump)" : " (empty — set)"}`}
                  >
                    CUE {slot + 1}
                  </button>
                  {cue ? (
                    <button
                      type="button"
                      className="deck-cue-clear"
                      data-testid={`deck-${deckId}-cue-${slot}-clear`}
                      onClick={() => onCueClear(slot)}
                      aria-label={`Clear cue ${slot + 1}`}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {cueNotice ? (
            <p
              className="deck-cue-notice"
              data-testid={`deck-${deckId}-cue-notice`}
              role="status"
              style={{ fontSize: "0.75rem", color: "#e7b34a", margin: "0.25rem 0 0" }}
            >
              {cueNotice}
            </p>
          ) : null}

          {/* Beat loops — clean bar-length loops, quantised to the grid (replaces the old
              fixed 2-second loop). */}
          <div className="deck-loops" role="group" aria-label={`Deck ${deckId} beat loops`}>
            <span className="deck-loops-label">Loop</span>
            {BEAT_LOOP_BARS.map((bars) => (
              <button
                key={bars}
                type="button"
                className={`deck-loop-btn${beatLoopBars === bars ? " on" : ""}`}
                data-testid={`deck-${deckId}-loop-${bars}`}
                onClick={() => onBeatLoop(bars)}
                disabled={!localLoaded}
                aria-pressed={beatLoopBars === bars}
                title={localLoaded ? `${bars}-bar loop` : "Load a file first"}
              >
                {bars < 1 ? `${Math.round(bars * 4)}/4` : bars}
              </button>
            ))}
          </div>

          {/* 3-band EQ with kills. */}
          <div className="deck-eq" role="group" aria-label={`Deck ${deckId} EQ`}>
            {EQ_BANDS.map(({ band, label }) => (
              <div className="deck-eq-band" key={band}>
                <label className="deck-eq-label" htmlFor={`deck-${deckId}-eq-${band}`}>
                  {label}
                  <span className="deck-eq-val">
                    {eq[band] > 0 ? "+" : ""}
                    {eq[band]} dB
                  </span>
                </label>
                <input
                  id={`deck-${deckId}-eq-${band}`}
                  type="range"
                  className="deck-eq-range"
                  min={EQ_MIN}
                  max={EQ_MAX}
                  step={1}
                  value={eq[band]}
                  onChange={(e) => setEqBand(band, Number(e.target.value))}
                  disabled={!localLoaded || kills[band]}
                  title={localLoaded ? undefined : "Load a file first"}
                  aria-label={`Deck ${deckId} ${label} EQ`}
                />
                <button
                  type="button"
                  className={`deck-eq-kill${kills[band] ? " on" : ""}`}
                  data-testid={`deck-${deckId}-kill-${band}`}
                  onClick={() => toggleKill(band)}
                  disabled={!localLoaded}
                  aria-pressed={kills[band]}
                  title={localLoaded ? `Kill ${label}` : "Load a file first"}
                >
                  Kill
                </button>
              </div>
            ))}
          </div>

          {/* Filter (HP/LP) + Trim with level meter. */}
          <div className="deck-mix-row">
            <div className="deck-filter">
              <label className="deck-filter-label" htmlFor={`deck-${deckId}-filter`}>
                Filter{" "}
                <span className="deck-filter-val">
                  {filterAmt === 0 ? "off" : filterAmt < 0 ? "LP" : "HP"}
                </span>
              </label>
              <input
                id={`deck-${deckId}-filter`}
                type="range"
                className="deck-filter-range"
                data-testid={`deck-${deckId}-filter`}
                min={-1}
                max={1}
                step={0.02}
                value={filterAmt}
                onChange={(e) => changeFilter(Number(e.target.value))}
                onDoubleClick={() => changeFilter(0)}
                disabled={!localLoaded}
                title={localLoaded ? "Low-pass ↔ high-pass sweep" : "Load a file first"}
                aria-label={`Deck ${deckId} filter`}
              />
            </div>

            <div className="deck-trim">
              <label className="deck-trim-label" htmlFor={`deck-${deckId}-trim`}>
                Trim <span className="deck-trim-val">{Math.round(trim * 100)}%</span>
              </label>
              <input
                id={`deck-${deckId}-trim`}
                type="range"
                className="deck-trim-range"
                min={TRIM_MIN}
                max={TRIM_MAX}
                step={0.02}
                value={trim}
                onChange={(e) => changeTrim(Number(e.target.value))}
                disabled={!localLoaded}
                title={localLoaded ? "Match this deck's loudness" : "Load a file first"}
                aria-label={`Deck ${deckId} trim`}
              />
              <div className="deck-meter" aria-hidden="true">
                <div
                  className="deck-meter-fill"
                  data-testid={`deck-${deckId}-meter`}
                  style={{ width: `${Math.min(100, Math.round(meter * 140))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Echo + scratch (kept from U14). */}
          <div className="deck-fx" role="group" aria-label={`Deck ${deckId} effects`}>
            <button
              type="button"
              className={`deck-fx-btn${echoOn ? " on" : ""}`}
              onClick={toggleEcho}
              disabled={!localLoaded}
              aria-pressed={echoOn}
              title={localLoaded ? undefined : "Load a file first"}
            >
              Echo
            </button>
            <div className="deck-scratch">
              <label className="deck-scratch-label" htmlFor={`deck-${deckId}-scratch`}>
                Scratch
              </label>
              <input
                id={`deck-${deckId}-scratch`}
                type="range"
                className="deck-scratch-range"
                min={-1}
                max={1}
                step={0.02}
                value={scratchVal}
                onChange={(e) => onScratch(Number(e.target.value))}
                onPointerUp={releaseScratch}
                onPointerCancel={releaseScratch}
                onBlur={releaseScratch}
                disabled={!localLoaded}
                title={localLoaded ? undefined : "Load a file first"}
                aria-label={`Deck ${deckId} scratch`}
              />
            </div>
          </div>

          {/* F-7: the same honesty chips every other deck shows. On a My Files deck with
              no file picked they read "Load a file first" as VISIBLE text — which is what
              the greyed pads above were previously saying only in a hover tooltip nobody
              on a phone could see. Once a file is loaded they all light up. */}
          {controls ? <CapabilityBadges controls={controls} pointer={capsPointer} /> : null}
        </>
      ) : null}

      {source === "spotify" ? (
        <>
          <p className="deck-notice">{DJ_SPOTIFY_NOTICE}</p>
          {controls ? <CapabilityBadges controls={controls} pointer={capsPointer} /> : null}
        </>
      ) : null}
    </section>
  );
}

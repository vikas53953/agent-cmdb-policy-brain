"use client";

// A single DJ deck (U13 + U14, R12/R13/R14/R17, AE3/AE4, F3). One of the two decks in
// the console. Its source picker and control set are driven entirely by the deck model
// (deck-model.ts), which composes the capability matrix with what actually works in
// THIS commit — so the deck can never show a control that does nothing.
//
// What genuinely works here:
//   - YouTube (U13): select YouTube, load a real video into a VISIBLE player (KTD-7 —
//     never hidden), play / pause, change speed; the crossfader volume applies to it.
//   - My Files (U14): pick a local audio file, decoded IN THE BROWSER and NEVER
//     uploaded (R14), and drive the full Web Audio engine on it — 3-band EQ, loops,
//     echo FX, scratch, speed — with the crossfader blending it against the other deck.
// What is honestly disabled with a plain reason:
//   - Spotify playback (lands in U15) — Spotify can still occupy the deck so the
//     one-deck-at-a-time lock (AE4) is demonstrable, but its transport stays disabled.

import { useEffect, useRef, useState } from "react";
import type { TrackRef, TrackSource } from "@/lib/repos/track";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { REASONS, LOCAL_RATE_RANGE } from "@/lib/player/capabilities";
import {
  createYouTubeAdapter,
  type YouTubeAdapter,
} from "@/lib/player/adapters/youtube";
import {
  createDjDeckEngine,
  EQ_GAIN_RANGE,
  type DjDeckEngine,
  type EqBand,
} from "@/lib/dj/engine";
import {
  parseYouTubeId,
  resolveDeckControls,
  resolveDeckSourceOptions,
  type DeckId,
} from "@/components/dj/deck-model";
import CapabilityBadges from "@/components/dj/capability-badges";
import { PlayIcon, PauseIcon } from "@/components/ui/icons";

// Deck-local player adapters must NOT drive the global player store (that is the
// main mini-player's truth). This inert bridge lets a deck reuse the real, tested
// YouTube adapter while keeping its clock to itself.
const INERT_BRIDGE = {
  reportPosition: () => {},
  next: async () => false,
};

const [RATE_MIN, RATE_MAX] = LOCAL_RATE_RANGE;
const [EQ_MIN, EQ_MAX] = EQ_GAIN_RANGE;

type EqState = { low: number; mid: number; high: number };
const FLAT_EQ: EqState = { low: 0, mid: 0, high: 0 };

const EQ_BANDS: readonly { band: EqBand; label: string }[] = [
  { band: "low", label: "Low" },
  { band: "mid", label: "Mid" },
  { band: "high", label: "High" },
];

export default function Deck({
  deckId,
  accent,
  source,
  otherSource,
  onSelectSource,
  volume,
}: {
  deckId: DeckId;
  accent: "a" | "b";
  source: TrackSource | null;
  otherSource: TrackSource | null;
  onSelectSource: (source: TrackSource | null) => void;
  // 0..1 gain from the crossfader; applied to this deck's live player.
  volume: number;
}) {
  const adapterRef = useRef<YouTubeAdapter | null>(null);
  const engineRef = useRef<DjDeckEngine | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const [linkInput, setLinkInput] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rate, setRate] = useState(1);

  // Local-files (Web Audio) deck state (U14).
  const [localName, setLocalName] = useState<string | null>(null);
  const [localLoaded, setLocalLoaded] = useState(false);
  const [eq, setEq] = useState<EqState>(FLAT_EQ);
  const [loopOn, setLoopOn] = useState(false);
  const [echoOn, setEchoOn] = useState(false);
  const [scratchVal, setScratchVal] = useState(0);

  const options = resolveDeckSourceOptions({ deck: deckId, otherDeckSource: otherSource });
  const controls = source ? resolveDeckControls(source, { deck: deckId, otherDeckSource: otherSource }) : null;

  // Spin up (and tear down) a private YouTube player when this deck is on YouTube.
  useEffect(() => {
    if (source !== "youtube") return;
    const adapter = createYouTubeAdapter({ store: INERT_BRIDGE });
    adapterRef.current = adapter;
    const host = hostRef.current;
    if (host) adapter.mount(host);
    return () => {
      if (host) adapter.unmount(host);
      adapter.unload();
      adapterRef.current = null;
    };
  }, [source]);

  // Spin up (and dispose) a private Web Audio engine when this deck is on My Files.
  // dispose() frees the decoded buffer — the user's bytes leave memory (R14).
  useEffect(() => {
    if (source !== "local") return;
    const engine = createDjDeckEngine();
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [source]);

  // Keep the live player's volume in step with the crossfader — for whichever engine
  // this deck currently runs (YouTube adapter or Web Audio engine).
  useEffect(() => {
    adapterRef.current?.setVolume(volume);
    engineRef.current?.setCrossfade(volume);
  }, [volume]);

  // Switching (or clearing) this deck's source resets everything loaded on it, so the
  // deck never carries a stale track/link across a source change (honest fresh state).
  function selectSource(next: TrackSource) {
    setLinkInput("");
    setLoadedId(null);
    setIsPlaying(false);
    setLoadError(null);
    setRate(1);
    setLocalName(null);
    setLocalLoaded(false);
    setEq(FLAT_EQ);
    setLoopOn(false);
    setEchoOn(false);
    setScratchVal(0);
    onSelectSource(source === next ? null : next);
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
      await adapter.play();
      setIsPlaying(true);
    }
  }

  function changeRate(next: number) {
    setRate(next);
    adapterRef.current?.setRate(next);
    engineRef.current?.setRate(next);
  }

  // ── My Files (Web Audio) handlers (U14) ────────────────────────────────────────

  async function pickFile(file: File | undefined) {
    const engine = engineRef.current;
    if (!engine || !file) return;
    if (!engine.available) {
      // No Web Audio in this browser — say so plainly instead of faking a load (R17).
      setLoadError("Your browser can't play decoded audio, so files can't be loaded here.");
      return;
    }
    setLoadError(null);
    setLoading(true);
    try {
      // Decode straight from the device — no network, ever (R14).
      await engine.resume();
      await engine.loadFile(file);
      // Re-apply the current control values onto the freshly decoded buffer.
      engine.setRate(rate);
      engine.setCrossfade(volume);
      engine.setEq("low", eq.low);
      engine.setEq("mid", eq.mid);
      engine.setEq("high", eq.high);
      engine.setLoop(loopOn);
      engine.setEcho(echoOn);
      engine.play();
      setLocalName(file.name);
      setLocalLoaded(true);
      setIsPlaying(true);
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
    setEq((prev) => ({ ...prev, [band]: db }));
    engineRef.current?.setEq(band, db);
  }

  function toggleLoop() {
    const next = !loopOn;
    setLoopOn(next);
    engineRef.current?.setLoop(next);
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

  const badge = source ? SOURCE_BADGES[source] : null;
  // Speed is live for a YouTube deck with a track loaded, or a local deck with a file
  // decoded — exactly when there is real audio for it to act on.
  const speedLive =
    (source === "youtube" && controls?.rate.available === true && loadedId !== null) ||
    (source === "local" && localLoaded);
  const speedReason =
    controls && !controls.rate.available
      ? controls.rate.reason
      : source === "youtube" && !loadedId
        ? "Load a track to change speed"
        : source === "local" && !localLoaded
          ? "Load a file to change speed"
          : null;

  return (
    <section className={`deck deck-${accent}`} aria-label={`Deck ${deckId}`}>
      <div className="deck-head">
        <span className="deck-title">Deck {deckId}</span>
        {badge ? <span className={`badge ${badge.className}`}>{badge.label}</span> : null}
      </div>

      {/* Source picker (prototype .source-pick). Disabled options carry their reason. */}
      <div className="source-pick" role="group" aria-label={`Deck ${deckId} source`}>
        {options.map((opt) => {
          const label = SOURCE_BADGES[opt.source].label;
          const active = source === opt.source;
          return (
            <button
              key={opt.source}
              type="button"
              className={`spick${active ? " active" : ""}${opt.selectable ? "" : " locked"}`}
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
          <div className="deck-video" ref={hostRef} aria-label="Deck video" />
          <div className="deck-load">
            <input
              type="text"
              className="deck-link"
              placeholder="Paste a YouTube link or video id"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              aria-label={`Deck ${deckId} YouTube link`}
            />
            <button
              type="button"
              className="deck-loadbtn"
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

          {controls ? <CapabilityBadges controls={controls} /> : null}
        </>
      ) : null}

      {source === "local" ? (
        <>
          {/* On-device promise, stated where files are loaded (R14). */}
          <p className="deck-local-promise">
            Files stay on your device — decoded here in your browser, never uploaded.
          </p>

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

              <div className="deck-transport">
                <button
                  type="button"
                  className="icon-btn primary deck-play"
                  onClick={toggleLocalPlay}
                  disabled={!localLoaded}
                  aria-label={isPlaying ? "Pause deck" : "Play deck"}
                  title={localLoaded ? undefined : "Load a file first"}
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

              {/* The full engine — every knob acts on real decoded audio (U14). All are
                  disabled until a file is decoded, so none is ever a dead control (R17). */}
              <div className="deck-eq" role="group" aria-label={`Deck ${deckId} EQ`}>
                {EQ_BANDS.map(({ band, label }) => (
                  <div className="deck-eq-band" key={band}>
                    <label
                      className="deck-eq-label"
                      htmlFor={`deck-${deckId}-eq-${band}`}
                    >
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
                      disabled={!localLoaded}
                      title={localLoaded ? undefined : "Load a file first"}
                      aria-label={`Deck ${deckId} ${label} EQ`}
                    />
                  </div>
                ))}
              </div>

              <div className="deck-fx" role="group" aria-label={`Deck ${deckId} effects`}>
                <button
                  type="button"
                  className={`deck-fx-btn${loopOn ? " on" : ""}`}
                  onClick={toggleLoop}
                  disabled={!localLoaded}
                  aria-pressed={loopOn}
                  title={localLoaded ? undefined : "Load a file first"}
                >
                  Loop
                </button>
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
                  <label
                    className="deck-scratch-label"
                    htmlFor={`deck-${deckId}-scratch`}
                  >
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
        </>
      ) : null}

      {source === "spotify" ? (
        <>
          <p className="deck-notice">{REASONS.spPlaybackSoon}</p>
          {controls ? <CapabilityBadges controls={controls} /> : null}
        </>
      ) : null}
    </section>
  );
}

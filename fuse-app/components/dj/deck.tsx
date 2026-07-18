"use client";

// A single DJ deck (U13, R12/R13/R17, AE3/AE4, F3). One of the two decks in the
// console. Its source picker and control set are driven entirely by the deck model
// (deck-model.ts), which composes the capability matrix with what actually works in
// THIS commit — so the deck can never show a control that does nothing.
//
// What genuinely works here in U13:
//   - Selecting YouTube and loading a real video (paste a link / id) into a VISIBLE
//     player (KTD-7 — never hidden), play / pause, and change speed.
//   - The crossfader volume is applied to this deck's live player by the parent.
// What is honestly disabled with a plain reason:
//   - My Files as a source (its engine lands in U14).
//   - Spotify playback (lands in U15) — Spotify can still occupy the deck so the
//     one-deck-at-a-time lock (AE4) is demonstrable, but its transport stays disabled.
//   - EQ / Loops / FX / Scratch — greyed indicators, not fake knobs (AE3).

import { useEffect, useRef, useState } from "react";
import type { TrackRef, TrackSource } from "@/lib/repos/track";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { REASONS, LOCAL_RATE_RANGE } from "@/lib/player/capabilities";
import {
  createYouTubeAdapter,
  type YouTubeAdapter,
} from "@/lib/player/adapters/youtube";
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
  const hostRef = useRef<HTMLDivElement>(null);

  const [linkInput, setLinkInput] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rate, setRate] = useState(1);

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

  // Keep the live player's volume in step with the crossfader.
  useEffect(() => {
    adapterRef.current?.setVolume(volume);
  }, [volume]);

  // Switching (or clearing) this deck's source resets everything loaded on it, so the
  // deck never carries a stale track/link across a source change (honest fresh state).
  function selectSource(next: TrackSource) {
    setLinkInput("");
    setLoadedId(null);
    setIsPlaying(false);
    setLoadError(null);
    setRate(1);
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
  }

  const badge = source ? SOURCE_BADGES[source] : null;
  // Speed is live only for a YouTube deck with a track actually loaded.
  const speedLive = source === "youtube" && controls?.rate.available === true && loadedId !== null;
  const speedReason =
    controls && !controls.rate.available
      ? controls.rate.reason
      : !loadedId
        ? "Load a track to change speed"
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

      {source === "spotify" ? (
        <>
          <p className="deck-notice">{REASONS.spPlaybackSoon}</p>
          {controls ? <CapabilityBadges controls={controls} /> : null}
        </>
      ) : null}
    </section>
  );
}

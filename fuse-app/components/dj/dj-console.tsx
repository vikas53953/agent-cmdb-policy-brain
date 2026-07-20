"use client";

// The DJ console (U13, R12/R13/R17, F3, F-6). Two decks (A ember, B teal) and a
// crossfader between them, per the approved prototype. This client component owns the
// shared console state: which source each deck holds (so the other deck's Spotify option
// can lock — AE4), the crossfader position and its curve (so both decks' live volumes
// track them).
//
// Honesty (R17): the intro note states plainly that every control does something real
// and that unavailable powers say why. Nothing here is decorative — the source picker,
// load, play, speed, and crossfader all act on real players; EQ/Loops/FX/Scratch show as
// honest greyed indicators carrying the reason they are off.
//
// F-6: the console no longer forgets your set the moment you look at another tab. It owns
// ONE snapshot of the whole console (both decks + crossfader + curve) which it restores on
// mount and re-saves on every change. The persistence itself lives in
// lib/dj/session-state.ts — the same shape and the same sessionStorage reasoning as the
// main player's rehydration.

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackSource } from "@/lib/repos/track";
import { playerStore } from "@/lib/player/store";
import { crossfadeGains, type CrossfadeCurve } from "@/components/dj/deck-model";
import {
  EMPTY_DJ_SESSION,
  loadDjSession,
  saveDjSession,
  type DjDeckSession,
  type DjSession,
} from "@/lib/dj/session-state";
import Deck from "@/components/dj/deck";
import Crossfader from "@/components/dj/crossfader";

export default function DjConsole() {
  // The snapshot to restore FROM, read once in the initializer so the first render is
  // already the restored console — no flash of an empty deck, no restoring effect that
  // fights the user's first interaction.
  const [restored] = useState<DjSession>(() => loadDjSession() ?? EMPTY_DJ_SESSION);

  const [sourceA, setSourceA] = useState<TrackSource | null>(restored.a.source);
  const [sourceB, setSourceB] = useState<TrackSource | null>(restored.b.source);
  // 0 = full Deck A, 1 = full Deck B. Centred by default so both decks are audible.
  const [position, setPosition] = useState(restored.position);
  // The crossfader curve (DJ-1) — smooth blend by default, sharp cut for scratching.
  const [curve, setCurve] = useState<CrossfadeCurve>(restored.curve);

  // The live snapshot. A ref, not state: the decks push their settings up on every knob
  // move, and re-rendering the whole console on each step of an EQ drag would be a real
  // cost for no visible gain. What the user SEES already lives in the decks' own state.
  const snapshotRef = useRef<DjSession>(restored);
  const saveTimerRef = useRef<number | undefined>(undefined);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = undefined;
    saveDjSession(snapshotRef.current);
  }, []);

  // Coalesce writes: a slider drag fires continuously, and one sessionStorage write per
  // pixel would be wasteful.
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushSave, 200);
  }, [flushSave]);

  // One deck reporting its current settings.
  //
  // STRUCTURAL changes — which source the deck is on, which video, which file — are
  // written through IMMEDIATELY; only the knob values are debounced. Those facts are rare
  // and they are the ones that matter most to get back, so they must never depend on a
  // timer still being alive, nor on unmount cleanup happening to run before the route is
  // torn down. Sliders keep the debounce, which is where the write volume actually is.
  const reportDeck = useCallback(
    (deckId: "A" | "B", deck: DjDeckSession) => {
      const slot = deckId === "A" ? "a" : "b";
      const previous = snapshotRef.current[slot];
      const structural =
        previous.source !== deck.source ||
        previous.youtubeId !== deck.youtubeId ||
        previous.localFileName !== deck.localFileName;
      snapshotRef.current = { ...snapshotRef.current, [slot]: deck };
      if (structural) flushSave();
      else scheduleSave();
    },
    [flushSave, scheduleSave],
  );
  const reportA = useCallback((d: DjDeckSession) => reportDeck("A", d), [reportDeck]);
  const reportB = useCallback((d: DjDeckSession) => reportDeck("B", d), [reportDeck]);

  // Crossfader + curve belong to the console itself.
  useEffect(() => {
    snapshotRef.current = { ...snapshotRef.current, position, curve };
    scheduleSave();
  }, [position, curve, scheduleSave]);

  // Leaving the console — by tab, by reload, or by the tab being hidden on a phone —
  // flushes immediately rather than waiting out the debounce, so the very last thing the
  // DJ touched is in the snapshot they come back to. `pagehide` covers the mobile case
  // where a backgrounded tab may never get a clean unmount at all.
  useEffect(() => {
    const onLeave = () => flushSave();
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onLeave);
      flushSave();
    };
  }, [flushSave]);

  // Captured ONCE at entry (a pure store read in the initializer): the title of the main
  // track we are about to take over, or null when nothing was playing. Driving the notice
  // from this — not a setState in the effect — keeps the takeover honest without a
  // cascading render: we say plainly what we paused and that it resumes on leave (the P1
  // fix — no music silently lost, no orphaned uncontrollable chip).
  const [pausedTitle] = useState<string | null>(() => {
    const { isPlaying, current } = playerStore.getState();
    return isPlaying ? current?.title ?? "your track" : null;
  });

  // Taking over the decks pauses the main mini-player so the console's audio is the only
  // thing playing — no overlap, no hidden main track behind the DJ screen. Only when
  // something was actually playing: we pause it here and RESUME it (in place, from where it
  // was) when the user leaves DJ — tapping one tab must never silently stop your music.
  useEffect(() => {
    if (pausedTitle === null) return; // nothing was playing — leave the player untouched
    playerStore.pause();
    return () => {
      // Leaving the console: hand the sound back exactly where we borrowed it.
      void playerStore.resume();
    };
  }, [pausedTitle]);

  const gains = crossfadeGains(position, curve);

  return (
    <div className="dj">
      <header className="dj-head">
        <h1 className="dj-heading">DJ console</h1>
        {pausedTitle ? (
          <p
            className="dj-paused-note"
            data-testid="dj-paused-note"
            role="status"
            aria-live="polite"
          >
            Paused “{pausedTitle}” so the decks have the sound — it picks up again when you
            leave DJ.
          </p>
        ) : null}
        <p className="dj-note">
          Every control here does something real. Your own files get the full engine —
          EQ, loops, echo, scratch — on audio that never leaves your device. YouTube
          greys out what it can&apos;t do and says why; Spotify lights up when its
          support lands.
        </p>
      </header>

      <Deck
        deckId="A"
        accent="a"
        source={sourceA}
        otherSource={sourceB}
        onSelectSource={setSourceA}
        volume={gains.a}
        restore={restored.a}
        onStateChange={reportA}
      />

      <Crossfader position={position} onChange={setPosition} curve={curve} onCurveChange={setCurve} />

      <Deck
        deckId="B"
        accent="b"
        source={sourceB}
        otherSource={sourceA}
        onSelectSource={setSourceB}
        volume={gains.b}
        restore={restored.b}
        onStateChange={reportB}
      />
    </div>
  );
}

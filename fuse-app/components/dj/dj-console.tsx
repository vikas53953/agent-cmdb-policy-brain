"use client";

// The DJ console (U13, R12/R13/R17, F3). Two decks (A ember, B teal) and a crossfader
// between them, per the approved prototype. This client component owns only the shared
// console state: which source each deck holds (so the other deck's Spotify option can
// lock — AE4) and the crossfader position (so both decks' live volumes track it).
//
// Honesty (R17): the intro note states plainly that every control does something real
// and that unavailable powers say why. Nothing here is decorative — the source picker,
// load, play, speed, and crossfader all act on real players; EQ/Loops/FX/Scratch show
// as honest greyed indicators until the local-file engine lands (U14).

import { useEffect, useState } from "react";
import type { TrackSource } from "@/lib/repos/track";
import { playerStore } from "@/lib/player/store";
import { crossfadeGains, type CrossfadeCurve } from "@/components/dj/deck-model";
import Deck from "@/components/dj/deck";
import Crossfader from "@/components/dj/crossfader";

export default function DjConsole() {
  const [sourceA, setSourceA] = useState<TrackSource | null>(null);
  const [sourceB, setSourceB] = useState<TrackSource | null>(null);
  // 0 = full Deck A, 1 = full Deck B. Start centred so both decks are audible.
  const [position, setPosition] = useState(0.5);
  // The crossfader curve (DJ-1) — smooth blend by default, sharp cut for scratching.
  const [curve, setCurve] = useState<CrossfadeCurve>("smooth");
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
      />

      <Crossfader position={position} onChange={setPosition} curve={curve} onCurveChange={setCurve} />

      <Deck
        deckId="B"
        accent="b"
        source={sourceB}
        otherSource={sourceA}
        onSelectSource={setSourceB}
        volume={gains.b}
      />
    </div>
  );
}

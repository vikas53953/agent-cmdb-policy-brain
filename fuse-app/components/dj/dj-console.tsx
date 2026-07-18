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
import { crossfadeGains } from "@/components/dj/deck-model";
import Deck from "@/components/dj/deck";
import Crossfader from "@/components/dj/crossfader";

export default function DjConsole() {
  const [sourceA, setSourceA] = useState<TrackSource | null>(null);
  const [sourceB, setSourceB] = useState<TrackSource | null>(null);
  // 0 = full Deck A, 1 = full Deck B. Start centred so both decks are audible.
  const [position, setPosition] = useState(0.5);

  // Taking over the decks pauses the main mini-player so the console's audio is the
  // only thing playing — no overlap, no hidden main track behind the DJ screen.
  useEffect(() => {
    playerStore.pause();
  }, []);

  const gains = crossfadeGains(position);

  return (
    <div className="dj">
      <header className="dj-head">
        <h1 className="dj-heading">DJ console</h1>
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

      <Crossfader position={position} onChange={setPosition} />

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

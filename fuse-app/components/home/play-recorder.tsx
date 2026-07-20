"use client";

// Play recorder (U12, R11/R18, KTD-4). A headless client component mounted once in the
// app shell. It watches the single player store and, when a NEW track actually starts
// playing, fires a one-shot POST to /api/plays so the play is recorded for the user's
// "recently played" row and the anonymous trending aggregate.
//
// Deliberately fire-and-forget: recording is a side effect of listening, never a
// gate on it, so a failed or offline POST is swallowed and never surfaces to the user
// (R18 — errors are logged/handled, listening is never blocked). It records only when
// `isPlaying` is true, so the store never records a track it merely focused but could
// not actually play (R17 honesty carried through to the history).

import { useEffect, useRef } from "react";
import { usePlayerState } from "@/lib/player/use-player";
import { trackKey } from "@/lib/home/recommend";
import { withResolvedArt } from "@/lib/home/art";

export default function PlayRecorder() {
  const { current, isPlaying } = usePlayerState();
  // The last (source:nativeId) we recorded, so re-renders while the same track plays
  // do not record it again — one play per track start, including blended transitions
  // (each melt-in is a genuine new play).
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!current || !isPlaying) return;
    const key = trackKey(current);
    if (lastRecorded.current === key) return;
    lastRecorded.current = key;

    // Record the art too (R5). If the playing track reached us without one — an older
    // restored session, a source that handed back no thumbnail — derive it from the
    // track's own id so the Play row we write is renderable on Home instead of becoming
    // another blank cover. Derivation only; a source we can't derive still stores null.
    const recorded = withResolvedArt(current);

    void fetch("/api/plays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: recorded.source,
        nativeId: recorded.nativeId,
        title: recorded.title,
        artist: recorded.artist,
        artUrl: recorded.artUrl,
      }),
      keepalive: true,
    }).catch(() => {
      // Best-effort: never let a recording failure interrupt playback. Allow a retry
      // on the next distinct play by clearing the marker.
      lastRecorded.current = null;
    });
  }, [current, isPlaying]);

  return null;
}

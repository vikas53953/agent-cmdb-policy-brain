"use client";

// Spotify connect result — the missing consumer (AUDIT 1).
//
// THE BUG THIS KILLS: both Spotify routes end by sending the user home with
// `?spotify=connected|denied|error|unconfigured`, and NOTHING anywhere read it. So the
// user finished (or cancelled, or failed) a sign-in and landed on a home screen that
// said nothing at all — the app knew the outcome and kept it to itself.
//
// This reads the parameter once, states the outcome plainly in the shared write-status
// live region, and then STRIPS the parameter from the address bar (replaceState, so no
// history entry and no reload) — a stale `?spotify=connected` must not re-announce
// itself every time the user comes back to this URL.

import { useEffect, useState } from "react";
import WriteStatus from "@/components/ui/write-status";
import { WRITE_STATUS_MS, type WriteMessage } from "@/lib/ui/write-status";

// Plain words, active voice, and what happens next. AUDIT 33: the success line says
// where Spotify actually fits — it finds the songs, YouTube plays them — and never
// promises Spotify playback.
const OUTCOMES: Record<string, WriteMessage> = {
  connected: {
    text: "Spotify connected — search now includes your Spotify. Songs play as their matched YouTube version.",
    tone: "ok",
  },
  denied: {
    text: "Spotify wasn't connected — you stopped the sign-in. Connect again any time from Settings.",
    tone: "note",
  },
  error: {
    text: "Couldn't finish connecting Spotify — try again from Settings.",
    tone: "problem",
  },
  unconfigured: {
    text: "Spotify sign-in isn't set up on this server yet.",
    tone: "note",
  },
};

export default function SpotifyConnectStatus() {
  const [message, setMessage] = useState<WriteMessage | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("spotify");
    if (!outcome) return;

    // Clear it first, so an unknown value is still swept out of the address bar.
    url.searchParams.delete("spotify");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    const found = OUTCOMES[outcome];
    if (!found) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-shot read of the browser URL on mount; the value cannot exist before hydration
    setMessage(found);
    const timer = setTimeout(() => setMessage(null), WRITE_STATUS_MS * 2);
    return () => clearTimeout(timer);
  }, []);

  return (
    <WriteStatus
      message={message}
      className="write-status-block"
      testId="spotify-connect-status"
    />
  );
}

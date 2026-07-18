"use client";

// Melt panel (U11, R3, F2) — the visual of a blend in progress.
//
// While the auto-crossfade engine overlaps the outgoing and incoming tracks, this
// panel shows what is melting in: the incoming track's title/artist and a progress
// bar that fills across the crossfade. For a YouTube incoming it also hosts the SECOND
// visible player (KTD-7 — the incoming video is on screen, never hidden) by handing
// its container to the adapter's blend surface.
//
// HONESTY (R17): the panel renders ONLY while a real blend is active (meltState.active
// from the engine). No blend, no panel — it can never be decorative, because it is
// driven by the same state that controls the actual audio ramp.

import { useEffect, useRef } from "react";
import { useMeltState } from "@/lib/player/blend-controller";
import { youtubeAdapter } from "@/lib/player/adapters/youtube";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { MusicIcon } from "@/components/ui/icons";

// Hosts the incoming YouTube player inside the melt panel (visible-player rule). Mirrors
// VideoSurface but targets the adapter's INCOMING slot so both videos are on screen
// during the overlap.
function IncomingVideoSurface() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    youtubeAdapter.mountIncoming(el);
    return () => youtubeAdapter.unmountIncoming(el);
  }, []);
  return <div ref={ref} className="melt-video" />;
}

export default function MeltPanel() {
  const melt = useMeltState();
  if (!melt.active || !melt.incoming) return null;

  const incoming = melt.incoming;
  const badge = SOURCE_BADGES[incoming.source] ?? { className: "mp3", label: incoming.source };
  const pct = Math.round(melt.progress * 100);

  return (
    <div className="melt-panel" role="status" aria-live="polite">
      <div className="melt-head">
        <span className="melt-kicker">Melting in</span>
        <span className={`badge ${badge.className}`}>{badge.label}</span>
      </div>

      <div className="melt-body">
        <div className="melt-art" aria-hidden="true">
          {incoming.source === "youtube" ? (
            <IncomingVideoSurface />
          ) : incoming.artUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external source CDN, allowed by CSP img-src
            <img src={incoming.artUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <MusicIcon size={20} />
          )}
        </div>
        <div className="melt-meta">
          <div className="melt-title">{incoming.title}</div>
          <div className="melt-sub">{incoming.artist ?? "Unknown artist"}</div>
        </div>
      </div>

      <div
        className="melt-bar"
        role="progressbar"
        aria-label="Crossfade progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="melt-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

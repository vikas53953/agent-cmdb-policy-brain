"use client";

// Visible YouTube video surface (U7, KTD-7).
//
// This is the on-screen home for the single YouTube <iframe>. It renders an empty
// container and, on mount, hands that container to the YouTube adapter, which
// re-parents its owned player host into it. On unmount it releases the container so
// the adapter parks the host (keeping playback alive) instead of the iframe being
// destroyed by React.
//
// The surface is ALWAYS a real visible box — never 0x0, never display:none. That is
// the fix for the old app's hidden player (a YouTube ToS violation). In U7 it fills
// the mini-player art slot ("small visible video"); U8 mounts the same surface at the
// full Now Playing art size (the 200x200+ primary surface).

import { useEffect, useRef } from "react";
import { youtubeAdapter } from "@/lib/player/adapters/youtube";

export default function VideoSurface({
  variant = "mini",
}: {
  variant?: "mini" | "np";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    youtubeAdapter.mount(el);
    return () => youtubeAdapter.unmount(el);
  }, []);

  return <div ref={ref} className={`yt-surface yt-surface-${variant}`} />;
}

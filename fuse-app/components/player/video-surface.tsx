"use client";

// Visible YouTube video placeholder (U7, KTD-7) — now a pure geometry SLOT.
//
// THE OWNERSHIP FIX. This surface used to hand its container to the adapter, which
// re-parented the single <iframe> into it on mount and parked it on unmount. Re-parenting
// an iframe RELOADS it — so every Now Playing open/close and tab switch silently reloaded
// the video (R1/R3/R4). It no longer hosts the iframe at all. Instead it registers its own
// empty box as a "slot" with the host coordinator, which keeps the ONE never-re-parented,
// position:fixed player host positioned exactly over whichever slot is active. Switching
// surfaces is now a geometry move, not a DOM move — the iframe never reloads.
//
// The surface is still ALWAYS a real visible box (never 0x0, never display:none): the
// coordinator lays the live video directly over it. In the mini it is the small art slot;
// in Now Playing it is the full 16:9 art surface.

import { useEffect, useRef } from "react";
import { playerHostCoordinator } from "@/lib/player/host-coordinator";

export default function VideoSurface({
  variant = "mini",
}: {
  variant?: "mini" | "np";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    playerHostCoordinator.registerSlot(variant, el);
    return () => playerHostCoordinator.releaseSlot(variant, el);
  }, [variant]);

  return <div ref={ref} className={`yt-surface yt-surface-${variant}`} data-testid={`video-slot-${variant}`} />;
}

"use client";

// Top-level overlay portal (Owner fix 1 — popovers behind the video).
//
// THE BUG THIS KILLS: the persistent YouTube player host is a position:fixed element
// parented to <body> at z-index 39, laid by geometry over whichever art slot is active
// so the video shows AS the artwork (host-coordinator.ts). A popover opened from INSIDE
// a lower surface — the sleep menu lives in the Now Playing header, and Now Playing is a
// z-index:38 stacking context — is trapped in that context: however high its own z-index,
// it can never rise above the host, which is a SIBLING of Now Playing at the body level.
// So the video won a stacking contest it should always lose to a menu.
//
// THE FIX (the class-level one the owner asked for): every transient popover/menu renders
// into ONE body-level portal root that sits in its own stacking context ABOVE the player
// host. Because the portal root is a direct child of <body>, a menu inside it escapes any
// parent surface's stacking context — it is judged against the host at the body level and
// always wins. The host stays at a fixed mid z-index (39) and never claims a max z, so the
// portal layer is guaranteed above it.
//
// SSR-safe: the root is created lazily in the browser only; on the server (and the first
// client render, before mount) the portal renders nothing, so hydration never mismatches.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// The single body-level container every overlay portals into. Created once, on demand.
// pointer-events:none so the empty layer never blocks clicks; each menu re-enables events
// on its own box. The high z-index is the whole point: it is above the player host (39)
// and above the slide-up sheets (41/43), so a portaled popover is never occluded.
const OVERLAY_ROOT_ID = "fuse-overlay-root";

function ensureOverlayRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let root = document.getElementById(OVERLAY_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = OVERLAY_ROOT_ID;
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.zIndex = "60"; // above the player host (39) and every slide-up sheet
    root.style.pointerEvents = "none";
    document.body.appendChild(root);
  }
  return root;
}

// Render `children` into the top-level overlay layer. Anything visual inside must set its
// own `pointer-events: auto` (the root is inert). Renders nothing until mounted in the
// browser (SSR-safe).
export default function Portal({ children }: { children: React.ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Intentional one-shot: the body-level portal root is a browser-only DOM node, created
    // after mount so SSR and the first client render agree on rendering nothing (no hydration
    // mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoot(ensureOverlayRoot());
  }, []);
  if (!root) return null;
  return createPortal(children, root);
}

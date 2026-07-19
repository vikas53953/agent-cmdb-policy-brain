// The single persistent player-host coordinator (the class fix for the reparent-reload
// bug at the heart of R1/R3/R4).
//
// THE BUG THIS KILLS: the old model re-parented the YouTube <iframe> into whichever
// screen surface was on screen (mini art / Now Playing art / melt panel) via
// container.appendChild(host). Every browser RELOADS an iframe's src when the node is
// detached and re-inserted — so opening Now Playing, minimising it, or switching tabs
// silently reloaded the video: it self-played (autoplay re-applied), reset to 0, and the
// polled clock froze (read as a false stall). The premise "moving the host does not
// reload the video" was simply false.
//
// THE FIX: the video lives in ONE host element that is created once, parented to
// <body> once, and NEVER re-parented for the whole session. Because the host is
// position:fixed, its DOM parent is irrelevant to layout — we position it by GEOMETRY,
// continuously syncing its top/left/width/height/border-radius to the on-screen
// bounding box of the currently-active placeholder "slot" (the mini art box, the Now
// Playing art box, or the melt box). Switching surfaces is now just re-pointing
// geometry at a different slot — the iframe never moves in the DOM, so it never reloads.
//
// This module is framework-free and SSR-safe: it touches no DOM at import. Everything is
// lazy and guarded on `document` existing, so tsc / vitest (node) / next build never see
// a window. It is a singleton (like the store) that the app shell starts once.

// The placeholder slots a screen can advertise. Priority is fixed and deterministic:
// a live blend's incoming video wins, then the open Now Playing art, then the mini art.
export type SlotVariant = "mini" | "np" | "melt";

// The two hosts the coordinator owns: the PRIMARY player's home (follows np/mini) and
// the INCOMING blend player's home (follows the melt slot). "incoming" becomes "primary"
// on a seamless blend promotion via promoteIncoming() — a reference swap, never a
// DOM move, so the promoted iframe keeps playing without a reload.
type HostRole = "primary" | "incoming";

export interface PlayerHostCoordinator {
  // Start the geometry sync (called once by the app shell on mount). Idempotent.
  // Returns a stop function; while stopped the hosts stay in the DOM (a session-long
  // fixture) but are no longer repositioned.
  start(): () => void;
  // The element the PRIMARY player must live inside. Lazily creates the host (parented
  // to <body> once) so the adapter can build its iframe in a home that never moves.
  primaryHost(): HTMLElement | null;
  // The element the INCOMING (blend) player must live inside.
  incomingHost(): HTMLElement | null;
  // Swap which host element is "primary" after a seamless blend promotion. No DOM move.
  promoteIncoming(): void;
  // A screen advertises "the video belongs here" by registering its placeholder box.
  registerSlot(variant: SlotVariant, el: HTMLElement): void;
  // Release a slot on unmount. `el` guards against a stale release from a remounted
  // surface clobbering the current registrant.
  releaseSlot(variant: SlotVariant, el?: HTMLElement): void;
  // The adapter tells the coordinator whether a real player currently exists, so the
  // host is kept visible (ToS: never a hidden YouTube player while a track is live) and
  // hidden only when nothing is playing at all.
  setPlaybackLive(role: HostRole, live: boolean): void;
  // Test/diagnostic reads (used by unit tests to prove the geometry invariants without a
  // real browser layout engine).
  activeSlot(): SlotVariant | null;
}

// A minimal DOM surface so the coordinator can be unit-tested with a fake document.
export type CoordinatorDoc = {
  createElement(tag: string): HTMLElement;
  body: HTMLElement;
};

export type CoordinatorDeps = {
  doc?: CoordinatorDoc | null;
  // Injectable rAF/observer seams so node tests can drive the sync loop deterministically.
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
  makeResizeObserver?: (cb: () => void) => { observe(el: Element): void; disconnect(): void } | null;
  addWindowListener?: (type: string, handler: () => void) => void;
  removeWindowListener?: (type: string, handler: () => void) => void;
};

// The fallback chip geometry when a YouTube track is live but no slot is on screen (a
// rare edge — the mini is present on every main tab). Small but a REAL visible box
// (ToS-safe), pinned just above the bottom dock. Never 0x0, never display:none while
// playback is live.
const FALLBACK_CHIP = { width: 96, height: 54, right: 12, bottom: 96 };

export function createPlayerHostCoordinator(
  deps: CoordinatorDeps = {},
): PlayerHostCoordinator {
  const doc: CoordinatorDoc | null =
    deps.doc ?? (typeof document !== "undefined" ? document : null);

  const requestFrame =
    deps.requestFrame ??
    ((cb: () => void) =>
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(cb)
        : (setTimeout(cb, 16) as unknown as number));
  const cancelFrame =
    deps.cancelFrame ??
    ((id: number) => {
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(id);
      else clearTimeout(id);
    });
  const makeResizeObserver =
    deps.makeResizeObserver ??
    ((cb: () => void) =>
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(cb) : null);
  const addWindowListener =
    deps.addWindowListener ??
    ((type: string, handler: () => void) => {
      if (typeof window !== "undefined") window.addEventListener(type, handler, true);
    });
  const removeWindowListener =
    deps.removeWindowListener ??
    ((type: string, handler: () => void) => {
      if (typeof window !== "undefined") window.removeEventListener(type, handler, true);
    });

  // The two host elements, created lazily and parented to <body> exactly once.
  let primary: HTMLElement | null = null;
  let incoming: HTMLElement | null = null;

  const slots: Record<SlotVariant, HTMLElement | null> = {
    mini: null,
    np: null,
    melt: null,
  };
  const live: Record<HostRole, boolean> = { primary: false, incoming: false };

  let running = false;
  let frameId: number | null = null;
  let resizeObserver: { observe(el: Element): void; disconnect(): void } | null = null;
  const observedSlots = new Set<HTMLElement>();

  function styleHost(el: HTMLElement): void {
    const s = el.style;
    s.position = "fixed";
    s.top = "0";
    s.left = "0";
    s.margin = "0";
    s.padding = "0";
    s.border = "0";
    s.overflow = "hidden";
    // Above the dock (30) and the Now Playing panel (38) so the video shows AS the art in
    // both the mini and the open Now Playing surface; below the profile sheet (40/41),
    // which may momentarily cover it — a rare, user-initiated modal, never a reload.
    s.zIndex = "39";
    s.pointerEvents = "none";
    s.background = "#000";
  }

  function ensureHost(role: HostRole): HTMLElement | null {
    if (!doc) return null;
    if (role === "primary") {
      if (!primary) {
        primary = doc.createElement("div");
        primary.id = "fuse-player-host";
        primary.className = "yt-host fuse-player-host";
        primary.setAttribute("aria-hidden", "true");
        styleHost(primary);
        primary.style.display = "none"; // hidden until a player exists
        doc.body.appendChild(primary);
      }
      return primary;
    }
    if (!incoming) {
      incoming = doc.createElement("div");
      incoming.id = "fuse-player-host-incoming";
      incoming.className = "yt-host fuse-player-host";
      incoming.setAttribute("aria-hidden", "true");
      styleHost(incoming);
      incoming.style.display = "none";
      doc.body.appendChild(incoming);
    }
    return incoming;
  }

  // The active PRIMARY slot by priority: Now Playing art (when open) beats the mini art.
  function activePrimarySlot(): SlotVariant | null {
    if (slots.np) return "np";
    if (slots.mini) return "mini";
    return null;
  }

  function borderRadiusOf(el: HTMLElement): string {
    if (typeof getComputedStyle === "undefined") return "0px";
    try {
      return getComputedStyle(el).borderRadius || "0px";
    } catch {
      return "0px";
    }
  }

  // Position `host` over `slotEl`'s bounding box, or hide/fallback when there is no slot.
  function positionHost(host: HTMLElement, slotEl: HTMLElement | null, isLive: boolean): void {
    if (slotEl && typeof slotEl.getBoundingClientRect === "function") {
      const r = slotEl.getBoundingClientRect();
      // A zero-area slot (e.g. an element still laying out) is treated as "no slot" so we
      // never shrink the player to 0x0 (a ToS-hidden player) — fall through to fallback.
      if (r.width > 0 && r.height > 0) {
        host.style.display = "block";
        host.style.top = `${Math.round(r.top)}px`;
        host.style.left = `${Math.round(r.left)}px`;
        host.style.width = `${Math.round(r.width)}px`;
        host.style.height = `${Math.round(r.height)}px`;
        host.style.borderRadius = borderRadiusOf(slotEl);
        return;
      }
    }
    if (isLive) {
      // No slot but a real player is running: keep a small VISIBLE chip (never hidden
      // while a YouTube track plays — the ToS line). Rare: the mini is on every main tab.
      host.style.display = "block";
      host.style.width = `${FALLBACK_CHIP.width}px`;
      host.style.height = `${FALLBACK_CHIP.height}px`;
      host.style.left = "auto";
      host.style.top = "auto";
      host.style.right = `${FALLBACK_CHIP.right}px`;
      host.style.bottom = `${FALLBACK_CHIP.bottom}px`;
      host.style.borderRadius = "8px";
      return;
    }
    // Nothing playing on this host — hide it entirely (no track means no ToS obligation).
    host.style.display = "none";
  }

  function sync(): void {
    if (primary) {
      const slot = activePrimarySlot();
      positionHost(primary, slot ? slots[slot] : null, live.primary);
    }
    if (incoming) {
      positionHost(incoming, slots.melt, live.incoming);
    }
  }

  function reobserve(): void {
    if (!resizeObserver) return;
    resizeObserver.disconnect();
    observedSlots.clear();
    for (const v of ["mini", "np", "melt"] as SlotVariant[]) {
      const el = slots[v];
      if (el && !observedSlots.has(el)) {
        resizeObserver.observe(el);
        observedSlots.add(el);
      }
    }
  }

  // Schedule a geometry sync on the next frame (coalesces bursts of scroll/resize/observer
  // callbacks into one measurement per frame).
  function scheduleSync(): void {
    if (!running) {
      sync();
      return;
    }
    if (frameId != null) return;
    frameId = requestFrame(() => {
      frameId = null;
      sync();
    });
  }

  const onWindowChange = () => scheduleSync();

  function stop(): void {
    running = false;
    if (frameId != null) {
      cancelFrame(frameId);
      frameId = null;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedSlots.clear();
    removeWindowListener("resize", onWindowChange);
    removeWindowListener("scroll", onWindowChange);
    removeWindowListener("transitionend", onWindowChange);
  }

  return {
    start() {
      if (running) return stop;
      running = true;
      resizeObserver = makeResizeObserver(() => scheduleSync());
      reobserve();
      addWindowListener("resize", onWindowChange);
      addWindowListener("scroll", onWindowChange);
      // The Now Playing panel slides up/down via a CSS transform; re-measure when it ends
      // so the video lands exactly on the settled art box rather than lagging the slide.
      addWindowListener("transitionend", onWindowChange);
      sync();
      return stop;
    },

    primaryHost() {
      return ensureHost("primary");
    },

    incomingHost() {
      return ensureHost("incoming");
    },

    promoteIncoming() {
      // Swap the two host ELEMENT references: the element that held the incoming (still-
      // playing) iframe becomes primary and starts following the np/mini slot; the emptied
      // old primary becomes the reusable incoming host for the next blend. No DOM reparent.
      // The `live` flags are left for the adapter to set explicitly after it retires the
      // old primary player and adopts the incoming one, so they reflect real players.
      const oldPrimary = primary;
      primary = incoming;
      incoming = oldPrimary;
      scheduleSync();
    },

    registerSlot(variant, el) {
      slots[variant] = el;
      reobserve();
      scheduleSync();
    },

    releaseSlot(variant, el) {
      if (el && slots[variant] !== el) return; // a newer registrant already owns it
      slots[variant] = null;
      reobserve();
      scheduleSync();
    },

    setPlaybackLive(role, isLive) {
      live[role] = isLive;
      scheduleSync();
    },

    activeSlot() {
      return activePrimarySlot();
    },
  };
}

// The app's single coordinator. Importing it is pure (no DOM touched until start() /
// primaryHost() run in the browser), so it is safe from server code and node tests.
export const playerHostCoordinator = createPlayerHostCoordinator();

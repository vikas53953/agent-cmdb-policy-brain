"use client";

// Sleep timer control (Wave 1) — a clock button that opens presets, and doubles as the
// armed countdown chip. Used in both the Now Playing overflow and the profile sheet from
// one definition so the two never drift. Renders from the sleep-timer singleton (the
// single source of sleep-timer truth); every option does something real (R17): the minute
// presets arm a real countdown that pauses playback, "End of track" arms the real store
// flag, and Cancel truly disarms.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  sleepTimer,
  useSleepTimer,
  formatSleepRemaining,
} from "@/lib/player/sleep-timer-controller";
import { SLEEP_PRESETS_MIN } from "@/lib/player/sleep-timer";
import { ClockIcon } from "@/components/ui/icons";
import Portal from "@/components/ui/portal";

// Where the portaled menu sits, as fixed viewport coordinates measured from the trigger.
type MenuPos = { top: number; right: number };

export default function SleepTimerControl({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const state = useSleepTimer();
  const [open, setOpen] = useState(false);
  // The trigger and the portaled menu live in different DOM subtrees now (the menu escapes
  // to the top-level overlay layer so the video can never cover it — owner fix 1), so BOTH
  // are tracked for outside-click detection.
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const armed = state.mode !== "off";

  // Anchor the portaled menu to the trigger: drop it just below, right-aligned, using fixed
  // viewport coordinates. Measured with a layout effect so it paints in the right place with
  // no flash. Re-measured on scroll/resize while open so it tracks the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Prefer dropping below the trigger; flip above when that would run off the bottom of
      // the viewport (the case inside the tall profile sheet). ~260px is the menu's max
      // height (label + up to six items); the flipped top is clamped to stay on screen.
      const EST_H = 260;
      const below = r.bottom + 6;
      const top = below + EST_H > window.innerHeight - 8 ? Math.max(8, r.top - EST_H - 6) : below;
      setPos({ top: Math.round(top), right: Math.round(window.innerWidth - r.right) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const inTrigger = ref.current?.contains(t);
      const inMenu = menuRef.current?.contains(t);
      if (!inTrigger && !inMenu) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The armed summary, in plain words: a live countdown for minutes, or the honest
  // "Ends with this track" for end-of-track mode (which has no truthful countdown).
  const summary =
    state.mode === "minutes"
      ? formatSleepRemaining(state.remainingSec)
      : state.mode === "end-of-track"
        ? "Ends with track"
        : null;

  function armMinutes(min: number) {
    sleepTimer.armMinutes(min);
    setOpen(false);
  }
  function armEndOfTrack() {
    sleepTimer.armEndOfTrack();
    setOpen(false);
  }
  function cancel() {
    sleepTimer.cancel();
    setOpen(false);
  }

  const triggerClass =
    variant === "row"
      ? armed
        ? "sleep-trigger row on"
        : "sleep-trigger row"
      : armed
        ? "icon-btn toggle on sleep-trigger"
        : "icon-btn sleep-trigger";

  return (
    <div className="sleep-control" ref={ref}>
      <button
        type="button"
        className={triggerClass}
        data-testid="sleep-trigger"
        data-armed={armed ? "true" : "false"}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={armed ? `Sleep timer: ${summary}` : "Sleep timer"}
        aria-label={armed ? `Sleep timer armed — ${summary}. Change or cancel` : "Set a sleep timer"}
      >
        <ClockIcon size={variant === "row" ? 18 : 20} />
        {variant === "row" ? <span className="sleep-row-label">Sleep timer</span> : null}
        {armed && summary ? (
          <span className="sleep-chip" data-testid="sleep-chip">
            {summary}
          </span>
        ) : null}
      </button>

      {open ? (
        // Portaled to the top-level overlay layer so the persistent video host can never
        // cover it (owner fix 1). Positioned by fixed coordinates anchored to the trigger.
        <Portal>
          <div
            ref={menuRef}
            className="sleep-menu sleep-menu-portal"
            role="menu"
            data-testid="sleep-menu"
            style={pos ? { top: pos.top, right: pos.right } : { visibility: "hidden" }}
          >
            <div className="sleep-menu-label">Stop playback</div>
            {SLEEP_PRESETS_MIN.map((min) => (
              <button
                key={min}
                type="button"
                role="menuitem"
                className="sleep-menu-item"
                data-testid={`sleep-${min}`}
                onClick={() => armMinutes(min)}
              >
                After {min} min
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="sleep-menu-item"
              data-testid="sleep-end-of-track"
              onClick={armEndOfTrack}
            >
              At end of track
            </button>
            {armed ? (
              <button
                type="button"
                role="menuitem"
                className="sleep-menu-item danger"
                data-testid="sleep-cancel"
                onClick={cancel}
              >
                Cancel timer
              </button>
            ) : null}
          </div>
        </Portal>
      ) : null}
    </div>
  );
}

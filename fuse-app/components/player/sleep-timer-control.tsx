"use client";

// Sleep timer control (Wave 1) — a clock button that opens presets, and doubles as the
// armed countdown chip. Used in both the Now Playing overflow and the profile sheet from
// one definition so the two never drift. Renders from the sleep-timer singleton (the
// single source of sleep-timer truth); every option does something real (R17): the minute
// presets arm a real countdown that pauses playback, "End of track" arms the real store
// flag, and Cancel truly disarms.

import { useEffect, useRef, useState } from "react";
import {
  sleepTimer,
  useSleepTimer,
  formatSleepRemaining,
} from "@/lib/player/sleep-timer-controller";
import { SLEEP_PRESETS_MIN } from "@/lib/player/sleep-timer";
import { ClockIcon } from "@/components/ui/icons";

export default function SleepTimerControl({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const state = useSleepTimer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const armed = state.mode !== "off";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
        <div className="sleep-menu" role="menu" data-testid="sleep-menu">
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
      ) : null}
    </div>
  );
}

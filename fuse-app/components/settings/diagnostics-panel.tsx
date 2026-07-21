"use client";

// Diagnostics panel (U16 — completes R18's activity log by SURFACING it).
//
// R18 promises the app records its own playback events and errors so failures can be
// diagnosed from evidence, not guesses. This panel is where the owner reads that log:
// a real, working control in the profile sheet's About group. It shows the most recent
// events (newest first), a "N events, M errors" summary, and a Clear button.
//
// HONESTY (R17): every control here does something real. "Show activity" reveals the
// live in-memory log; "Clear" empties it; the list updates as new events land. When
// the log is empty it says so plainly rather than showing a blank box.
//
// SECRET-SAFE: the panel renders each event through `formatActivityLine`, which prints
// a redacted value only as its length ("[N chars]") — never the value. No secret can
// reach the screen, matching the owner standing rule that logs record lengths only.

import { useEffect, useState } from "react";
import {
  clearActivity,
  formatActivityLine,
  formatActivitySummary,
  getActivity,
  onActivity,
  summarizeActivity,
  type ActivityEvent,
} from "@/lib/activity-log";

// How many recent lines to show — enough to diagnose the last few minutes without a wall.
const MAX_SHOWN = 30;

export default function DiagnosticsPanel() {
  const [shown, setShown] = useState(false);
  const [events, setEvents] = useState<readonly ActivityEvent[]>([]);

  // While the panel is open, mirror the live log into state and stay subscribed so a
  // new event (a stall, an error) appears without reopening. The initial snapshot is
  // deferred to a microtask (not a synchronous effect setState) — the same pattern the
  // rest of the app uses — then live updates follow; unsubscribe on close.
  useEffect(() => {
    if (!shown) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setEvents(getActivity());
    });
    const off = onActivity(() => {
      if (active) setEvents(getActivity());
    });
    return () => {
      active = false;
      off();
    };
  }, [shown]);

  const summary = summarizeActivity(events);
  // Newest first for a diagnostics read; cap the list so a long session stays scannable.
  const recent = [...events].reverse().slice(0, MAX_SHOWN);

  return (
    <div className="diag">
      <button
        type="button"
        className="diag-toggle"
        onClick={() => setShown((v) => !v)}
        aria-expanded={shown}
      >
        {shown ? "Hide activity log" : "Show activity log"}
      </button>

      {shown ? (
        <div className="diag-body">
          <div className="diag-summary" role="status" aria-live="polite">
            {formatActivitySummary(summary)}
          </div>

          {recent.length > 0 ? (
            <>
              <ul className="diag-list" aria-label="Recent activity">
                {recent.map((e, i) => (
                  <li
                    key={`${e.at}-${i}`}
                    className={e.level === "error" ? "diag-line error" : "diag-line"}
                  >
                    {formatActivityLine(e)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="diag-clear"
                onClick={() => {
                  clearActivity();
                  setEvents([]);
                }}
              >
                Clear log
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

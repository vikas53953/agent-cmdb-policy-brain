"use client";

// DJ capability badges (U13, R13/R17, AE3, F-7). The honest on/off readout of a deck's
// "full engine" powers — EQ, Loops, FX, Scratch. These are NOT interactive knobs (the
// live controls live on the deck itself), so rendering them as controls would be exactly
// the decorative-button dishonesty the rebuild exists to kill. Instead each power is a
// plain indicator: lit when it is genuinely usable right now, greyed with a plain-English
// reason when it is not.
//
// The state comes entirely from a resolved capability matrix — this component decides
// nothing. F-7 widened what that matrix accounts for: as well as "this source can't do
// it" and "its engine isn't wired yet", it now also carries "there's nothing loaded to do
// it to". That is why these chips render on EVERY deck now, My Files included: an empty
// deck says "Load a file first" here as VISIBLE text, instead of leaving four dead-looking
// pads explained only by a hover tooltip nobody on a phone can see.

import type { CapabilityMatrix } from "@/lib/player/types";
import { DECK_CAPABILITY_CHIPS } from "@/components/dj/deck-model";

// Re-exported so existing importers keep one name for this string. The decision about
// WHEN it is the honest thing to say now lives in deck-model's `capabilityPointer`.
export { FULL_ENGINE_POINTER } from "@/components/dj/deck-model";

export default function CapabilityBadges({
  controls,
  pointer,
}: {
  controls: CapabilityMatrix;
  // The one-line capability-difference note, or null/undefined when none applies.
  pointer?: string | null;
}) {
  return (
    <div className="caps-block">
      <ul className="caps" aria-label="Deck effects">
        {DECK_CAPABILITY_CHIPS.map(({ key, label }) => {
          const state = controls[key];
          return (
            <li
              key={key}
              className={state.available ? "cap on" : "cap off"}
              // The reason is the accessible explanation for the greyed state (R17).
              title={state.reason ?? undefined}
            >
              <span className="cap-dot" aria-hidden="true" />
              <span className="cap-label">{label}</span>
              {state.available ? (
                <span className="cap-state">On</span>
              ) : (
                <span className="cap-hint">{state.reason}</span>
              )}
            </li>
          );
        })}
      </ul>
      {pointer ? (
        <p className="caps-pointer" data-testid="caps-pointer">
          {pointer}
        </p>
      ) : null}
    </div>
  );
}

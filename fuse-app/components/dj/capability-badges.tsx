"use client";

// DJ capability badges (U13, R13/R17, AE3). The honest on/off readout of a deck's
// "full engine" powers — EQ, Loops, FX, Scratch. These are NOT interactive knobs in
// U13 (no source that can be loaded today can actually do them), so rendering them as
// live controls would be exactly the decorative-button dishonesty the rebuild exists
// to kill. Instead each power is a plain indicator: lit when the loaded source truly
// supports it, greyed with a plain-English reason when it does not. When the local
// engine lands (U14) these light up for a My Files deck with no change here — the
// state comes entirely from resolveDeckControls.

import type { CapabilityMatrix } from "@/lib/player/types";
import { DECK_CAPABILITY_CHIPS } from "@/components/dj/deck-model";

// One-line pointer shown under the chips when a deck's full-engine powers are off. It
// reframes the greyed controls as a CAPABILITY DIFFERENCE — this source simply doesn't
// have these powers — rather than something broken (Complaint 3). Stated once, not per
// chip. My Files decks (all powers on) never show it.
export const FULL_ENGINE_POINTER = "Full engine works with My Files";

export default function CapabilityBadges({ controls }: { controls: CapabilityMatrix }) {
  // Any full-engine power greyed out → show the pointer once beneath the chips.
  const anyOff = DECK_CAPABILITY_CHIPS.some(({ key }) => !controls[key].available);

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
      {anyOff ? (
        <p className="caps-pointer" data-testid="caps-pointer">
          {FULL_ENGINE_POINTER}
        </p>
      ) : null}
    </div>
  );
}

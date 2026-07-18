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

export default function CapabilityBadges({ controls }: { controls: CapabilityMatrix }) {
  return (
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
  );
}

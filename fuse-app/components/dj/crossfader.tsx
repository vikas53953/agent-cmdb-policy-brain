"use client";

// DJ crossfader (U13, R12/R13). A real control: it sets the equal-power volume mix
// between Deck A and Deck B. The parent applies the resolved gains to each deck's live
// player, so dragging this genuinely blends the two YouTube decks by volume — never a
// decorative slider. The readout shows the real mix percentages so the owner can see
// the crossfader is doing something (R17).

import { crossfadeGains } from "@/components/dj/deck-model";

export default function Crossfader({
  position,
  onChange,
}: {
  // 0 = full Deck A, 1 = full Deck B.
  position: number;
  onChange: (position: number) => void;
}) {
  const gains = crossfadeGains(position);
  const aPct = Math.round(gains.a * 100);
  const bPct = Math.round(gains.b * 100);

  return (
    <div className="xfader">
      <div className="xfader-head">
        <span className="xfader-cap xfader-cap-a">A</span>
        <span className="xfader-title">Crossfader</span>
        <span className="xfader-cap xfader-cap-b">B</span>
      </div>
      <input
        type="range"
        className="xfader-range"
        min={0}
        max={1}
        step={0.01}
        value={position}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Crossfade between Deck A and Deck B"
        aria-valuetext={`Deck A ${aPct} percent, Deck B ${bPct} percent`}
      />
      <div className="xfader-readout" aria-live="polite">
        <span>A {aPct}%</span>
        <span>B {bPct}%</span>
      </div>
    </div>
  );
}

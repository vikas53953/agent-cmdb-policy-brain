"use client";

// A horizontally scrolling Home carousel with an HONEST "more to the right" cue
// (U12, R10/R17). The right-edge fade + chevron appear ONLY when the rail can actually
// scroll further right — measured from real layout, not assumed — so the cue never
// promises content that is not there. The chevron is a real control: it scrolls the
// rail. When everything fits (or the user has scrolled to the end) the cue is removed.
//
// prefers-reduced-motion is honored: the chevron's programmatic scroll jumps instantly
// (no smooth animation) for users who ask for reduced motion.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";

export default function Rail({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // Whether the rail can scroll back LEFT — true once the user has scrolled right at all
  // (owner fix 7). Mirrors the right cue so the left control appears only when it does
  // something, never as dead decoration (R17).
  const [canScrollLeft, setCanScrollLeft] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A few px of tolerance so sub-pixel rounding at the true end doesn't keep the cue.
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    setCanScrollLeft(el.scrollLeft > 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);

  function scrollByDir(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div className="rail-wrap">
      {/* Left scroll cue (owner fix 7) — appears only once scrolled right, mirroring the
          right one. A real control: it scrolls the rail back. */}
      {canScrollLeft ? (
        <>
          <div className="rail-fade rail-fade-left" aria-hidden="true" />
          <button
            type="button"
            className="rail-chev rail-chev-left"
            onClick={() => scrollByDir(-1)}
            aria-label="Scroll back"
          >
            <ChevronLeftIcon />
          </button>
        </>
      ) : null}
      <div className="rail" ref={ref}>
        {children}
      </div>
      {canScrollRight ? (
        <>
          <div className="rail-fade" aria-hidden="true" />
          <button
            type="button"
            className="rail-chev"
            onClick={() => scrollByDir(1)}
            aria-label="Scroll for more"
          >
            <ChevronRightIcon />
          </button>
        </>
      ) : null}
    </div>
  );
}

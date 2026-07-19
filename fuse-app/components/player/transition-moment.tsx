"use client";

// The Transition Moment (F-0 item 1) — the hero block that shows, honestly, what happens
// when this song ends: NOW, NEXT (with small art), and a live "Fusing in N seconds"
// countdown that reflects the ACTUAL adapted melt length. A compact echo rides in the
// mini-player.
//
// HONESTY: it renders only what is true. The energy/BPM line appears ONLY when both tracks
// carry genuinely-computed analysis (never for a YouTube pair). When nothing is next it
// says playback will end. All of that truth is decided by the pure computeTransitionView;
// this component is a thin render of it.

import { usePlayerState } from "@/lib/player/use-player";
import {
  blendController,
  useMeltState,
  getLiveCrossfadeSec,
} from "@/lib/player/blend-controller";
import { clampCrossfadeSec } from "@/lib/player/blend";
import { computeTransitionView } from "@/lib/player/transition-moment";
import { MusicIcon } from "@/components/ui/icons";

// Build the honest transition view from the single player truth. Called inside a render
// that already re-runs on every store change (usePlayerState) so the countdown ticks with
// the ~2/s position poll. The blend controller supplies the adapted length + fuse-ability
// for the current pair, so the countdown length always matches the real melt.
function useTransitionView() {
  const state = usePlayerState();
  const melt = useMeltState();
  const next = state.queue[0] ?? null;
  return computeTransitionView({
    current: state.current,
    next,
    positionSec: state.positionSec,
    durationSec: state.durationSec,
    crossfadeSec: blendController.adaptedCrossfadeForCurrentPair() ?? 0,
    canFuse: blendController.canFuseCurrentPair(),
    meltActive: melt.active,
    maxCrossfadeSec: clampCrossfadeSec(getLiveCrossfadeSec()),
    // No analysis is attached to YouTube/Spotify tracks in the player pipeline, so the
    // energy/BPM line stays honestly off. When locally-analyzed audio is wired through the
    // player, pass its real analysis here and the line lights up truthfully.
  });
}

function NextArt({ artUrl }: { artUrl: string | null }) {
  if (artUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external source CDN, allowed by CSP img-src
      <img src={artUrl} alt="" referrerPolicy="no-referrer" />
    );
  }
  return (
    <span className="tm-next-art-fallback" aria-hidden="true">
      <MusicIcon size={16} />
    </span>
  );
}

// The full block, shown on Now Playing.
export default function TransitionMoment() {
  const view = useTransitionView();
  const state = usePlayerState();
  if (!state.current) return null;

  if (view.kind === "ending") {
    return (
      <div className="transition-moment tm-ending" data-testid="transition-moment" data-kind="ending">
        <p className="tm-ending-text">
          Last one queued — playback will end after this song.
        </p>
      </div>
    );
  }

  const { next } = view;
  const fusing = view.kind === "fusing";
  const inWindow = fusing && view.inWindow;
  const seconds = fusing ? view.secondsUntilFuse : null;

  return (
    <div
      className="transition-moment"
      data-testid="transition-moment"
      data-kind={view.kind}
      data-fusing-seconds={fusing && !inWindow ? String(seconds) : undefined}
      role="status"
      aria-live="polite"
    >
      <div className="tm-row tm-now">
        <span className="tm-tag">NOW</span>
        <span className="tm-title" data-testid="tm-now-title">
          {state.current.title}
        </span>
      </div>

      <div className="tm-row tm-next">
        <span className="tm-tag">NEXT</span>
        <span className="tm-next-art" aria-hidden="true">
          <NextArt artUrl={next.artUrl} />
        </span>
        <span className="tm-title" data-testid="tm-next-title">
          {next.title}
        </span>
      </div>

      {fusing ? (
        <div className="tm-fuse">
          <span className="tm-fuse-line" data-testid="tm-countdown">
            {inWindow
              ? "Fusing now"
              : `Fusing in ${seconds} second${seconds === 1 ? "" : "s"}`}
          </span>
          <span className="tm-hint">{view.hint}</span>
          {view.energyLine ? <span className="tm-energy">{view.energyLine}</span> : null}
        </div>
      ) : (
        // A next track exists but the two cannot truly fuse (a hard cut) — honest, no fake
        // countdown.
        <p className="tm-hardcut">Up next — this one plays right after.</p>
      )}
    </div>
  );
}

// The compact echo for the mini-player: one honest line about what is next.
export function TransitionMomentCompact() {
  const view = useTransitionView();
  const state = usePlayerState();
  if (!state.current) return null;
  if (view.kind === "ending") return null; // nothing to tease when the queue is empty

  const { next } = view;
  const fusing = view.kind === "fusing";
  const inWindow = fusing && view.inWindow;
  const seconds = fusing ? view.secondsUntilFuse : null;

  return (
    <div
      className="tm-compact"
      data-testid="transition-moment-compact"
      data-kind={view.kind}
      data-fusing-seconds={fusing && !inWindow ? String(seconds) : undefined}
    >
      <span className="tm-compact-tag">NEXT</span>
      <span className="tm-compact-title">{next.title}</span>
      {fusing ? (
        <span className="tm-compact-fuse">
          {inWindow ? "· fusing now" : `· fusing in ${seconds}s`}
        </span>
      ) : null}
    </div>
  );
}

"use client";

// App shell chrome (U4). One client component owns the persistent frame around
// every page: the top bar (brand wordmark + profile avatar), the scrolling screen
// area, and the fixed bottom dock (mini-player + tab bar). It also owns the single
// piece of shell state — whether the profile sheet is open — so the avatar button
// and the sheet stay in sync without a global store.
//
// The page itself is passed in as `children` (rendered on the server) and simply
// slotted into the scrolling area, so this client boundary does not pull page data
// into the client bundle.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
// Side-effect import: registering the Spotify adapter at app load is what flips
// Spotify search results from disabled to a real, enabled play button (its honest
// YouTube fallback — U15/KTD-2). Mirrors how the YouTube adapter self-registers when
// the mini-player mounts. No secret is read; the module load is pure.
import "@/lib/player/adapters/spotify";
import { showsMiniPlayer } from "@/lib/ui/shell";
import { blendController, setLiveCrossfadeSec } from "@/lib/player/blend-controller";
import { playerHostCoordinator } from "@/lib/player/host-coordinator";
import { usePlaybackRecovery } from "@/lib/player/use-playback-recovery";
import { playerStore } from "@/lib/player/store";
import { createRadioProvider } from "@/lib/player/radio";
import { setVolumeAction } from "@/lib/actions";
import {
  useSleepTimer,
  formatSleepRemaining,
  sleepTimer,
} from "@/lib/player/sleep-timer-controller";
import TabBar from "@/components/ui/tab-bar";
import MiniPlayer from "@/components/player/mini-player";
import NowPlaying from "@/components/player/now-playing";
import QueuePanel from "@/components/player/queue-panel";
import ProfileSheet from "@/components/settings/profile-sheet";
import PlayRecorder from "@/components/home/play-recorder";
import PlayerPersistence from "@/components/player/player-persistence";
import { ClockIcon } from "@/components/ui/icons";
import WriteStatus, { useWriteStatus } from "@/components/ui/write-status";
import { couldNot, runWrite } from "@/lib/ui/write-status";

// A small armed-sleep-timer chip in the top bar, visible on every screen so the listener
// always knows a stop is scheduled (not only inside Now Playing). Tapping it cancels the
// timer — a real, honest control. Renders nothing when no timer is armed.
function SleepChip() {
  const state = useSleepTimer();
  if (state.mode === "off") return null;
  const label =
    state.mode === "minutes" ? formatSleepRemaining(state.remainingSec) : "Ends with track";
  return (
    <button
      type="button"
      className="topbar-sleep-chip"
      data-testid="topbar-sleep-chip"
      onClick={() => sleepTimer.cancel()}
      title={`Sleep timer: ${label} — tap to cancel`}
      aria-label={`Sleep timer armed, ${label}. Tap to cancel`}
    >
      <ClockIcon size={15} />
      <span>{label}</span>
    </button>
  );
}

// The subset of the signed-in user the shell needs. Serializable so it can cross
// the server→client boundary from the layout.
export type ShellUser = {
  name: string | null;
  email: string | null;
  image: string | null;
};

function initialOf(user: ShellUser | null): string {
  const source = user?.name || user?.email || "";
  return source.trim().charAt(0).toUpperCase() || "?";
}

export default function AppChrome({
  user,
  lyricsEnabled: initialLyricsEnabled,
  crossfadeSec: initialCrossfadeSec,
  preferAudio: initialPreferAudio,
  autoplaySimilar: initialAutoplaySimilar,
  volume: initialVolume,
  children,
}: {
  user: ShellUser | null;
  // The persisted Lyrics on/off setting (U9, R16). Owned here as shell state so the
  // profile-sheet toggle and the Now Playing lyrics panel stay in sync instantly,
  // while the toggle also persists to the user's settings for the next session.
  lyricsEnabled: boolean;
  // The persisted crossfade length in seconds (U11, R3/R16). Owned here so the slider
  // updates the live blend engine instantly while also persisting for next session.
  crossfadeSec: number;
  // The persisted "prefer audio versions" setting (Complaint 1, R16). Owned here so the
  // profile-sheet toggle reflects and persists the choice the search route reads.
  preferAudio: boolean;
  // The persisted "autoplay similar when queue ends" setting (Wave 1, R16). Owned here so
  // the profile-sheet toggle reflects/persists it AND the player's radio provider honours it.
  autoplaySimilar: boolean;
  // The persisted output volume 0..1 (owner fix 3). Seeds the player store on mount; the
  // shell persists later changes the slider makes so the level survives reload.
  volume: number;
  children: React.ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Whether the full Now Playing screen is expanded over the phone frame (R4). Owned
  // here so the mini-player's expand tap and the overlay stay in sync, and so the mini
  // can hand the single visible YouTube video up to Now Playing while it is open.
  const [npOpen, setNpOpen] = useState(false);
  // Whether the queue screen is open (Wave 1). Owned here so both the mini-player and
  // Now Playing can open the same single queue sheet.
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsEnabled, setLyricsEnabled] = useState(initialLyricsEnabled);
  const [crossfadeSec, setCrossfadeSec] = useState(initialCrossfadeSec);
  const [preferAudio, setPreferAudio] = useState(initialPreferAudio);
  const [autoplaySimilar, setAutoplaySimilar] = useState(initialAutoplaySimilar);
  const pathname = usePathname() ?? "/";
  const withMiniPlayer = showsMiniPlayer(pathname);
  // AUDIT 24: the volume persist ended in an empty `.catch(() => {})`, so a level that
  // failed to save looked saved until the next reload quietly undid it. The shell now
  // owns one status pill for that write. `say` is read through a ref because the
  // subscription effect below is mounted once and must not re-subscribe.
  const { message, say } = useWriteStatus();
  const sayRef = useRef(say);
  useEffect(() => {
    sayRef.current = say;
  }, [say]);

  // Mount the ONE app-wide playback recovery monitor (AE1). It runs the bounded stall
  // ladder for whatever is playing, no matter which screen is open — so a track played
  // from search can never freeze silently just because Now Playing is closed.
  usePlaybackRecovery();

  // Start the single player-host coordinator once, on shell mount. It owns the ONE
  // never-re-parented, position:fixed YouTube host and keeps it laid over whichever
  // on-screen slot (mini / Now Playing / melt) is active — the geometry model that makes
  // opening/closing Now Playing and switching tabs a MOVE, not an iframe reload (R1/R3/R4).
  useEffect(() => playerHostCoordinator.start(), []);

  // Seed the live blend length from the persisted value and start the auto-crossfade
  // engine watching the player. The engine is a singleton and start() is idempotent,
  // so this is safe across re-renders; it is torn down if the shell ever unmounts.
  useEffect(() => {
    setLiveCrossfadeSec(initialCrossfadeSec);
    return blendController.start();
  }, [initialCrossfadeSec]);

  // Wire the RADIO CONTINUATION provider once (Wave 1): it reuses the real search engine to
  // find similar tracks when the queue ends. Registering it is inert until the queue runs
  // out AND the user's consent (autoplaySimilar) is on — so this never causes uninvited music.
  useEffect(() => {
    playerStore.setRadioProvider(createRadioProvider());
    return () => playerStore.setRadioProvider(null);
  }, []);

  // Keep the player's live consent flag in step with the persisted setting + the toggle, so
  // the one sanctioned auto-play only ever fires when the user has it on.
  useEffect(() => {
    playerStore.setAutoplaySimilar(autoplaySimilar);
  }, [autoplaySimilar]);

  // Seed the store's volume from the persisted value (owner fix 3) so playback starts at the
  // level the user last chose. Applying it to the (possibly not-yet-built) adapter is a safe
  // no-op until a track loads, at which point the store re-asserts it.
  useEffect(() => {
    playerStore.setVolume(initialVolume);
  }, [initialVolume]);

  // The latest consent value, read inside the store subscription below without re-subscribing.
  const autoplayRef = useRef(autoplaySimilar);
  useEffect(() => {
    autoplayRef.current = autoplaySimilar;
  }, [autoplaySimilar]);

  // One store subscription drives two shell responsibilities:
  //   • AUTOPLAY UP-NEXT (owner fix 2): when a track is playing with an EMPTY queue and the
  //     user has consented, seed radio-continuation picks so "Up next" is never empty and the
  //     crossfade engine has a next track to melt into. Attempted at most once per current
  //     track while the queue is empty, so a 500ms position tick can never spam the network.
  //   • VOLUME PERSISTENCE (owner fix 3): debounce-save the level the slider set so it
  //     survives reload, without a write per slider step.
  useEffect(() => {
    let seeding = false;
    let seededFor: string | null = null;
    let lastPersisted = playerStore.getState().volume;
    let persistTimer: number | undefined;

    const maybeSeedAutoplay = () => {
      const s = playerStore.getState();
      if (!s.current || s.queue.length > 0 || !autoplayRef.current) return;
      const key = `${s.current.source}:${s.current.nativeId}`;
      if (seeding || seededFor === key) return;
      seededFor = key;
      seeding = true;
      void playerStore.seedAutoplayQueue().finally(() => {
        seeding = false;
      });
    };

    const persistVolume = () => {
      const v = playerStore.getState().volume;
      if (v === lastPersisted) return;
      if (persistTimer) window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        lastPersisted = v;
        // Keep the live level either way — the sound the user set stays. What changes is
        // that a failed save now SAYS it did not stick, instead of pretending it did.
        void runWrite(() => setVolumeAction(v), () => true).then((result) => {
          if (!result.ok) {
            sayRef.current({
              text: couldNot("save the volume for next time"),
              tone: "problem",
            });
          }
        });
      }, 500);
    };

    const unsub = playerStore.subscribe(() => {
      maybeSeedAutoplay();
      persistVolume();
    });
    maybeSeedAutoplay();
    return () => {
      unsub();
      if (persistTimer) window.clearTimeout(persistTimer);
    };
  }, []);

  // Keep the live blend length in step with the slider between renders.
  function changeCrossfade(seconds: number) {
    setCrossfadeSec(seconds);
    setLiveCrossfadeSec(seconds);
  }

  return (
    <div className="app-frame">
      {/* First stop for a keyboard user — jump past the top bar to the page (U16, a11y).
          Off-screen until focused. */}
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      {/* Headless: records a play whenever a new track actually starts, feeding the
          Home "recently played" row and anonymous trending (U12). */}
      <PlayRecorder />

      {/* Headless: restores the mini-player (paused) + persists it across reloads (FIX 2).
          Never auto-plays — the user's tap is the only thing that starts sound. */}
      <PlayerPersistence />

      <header className="topbar">
        <span className="brand">Fuse</span>
        {/* Armed sleep-timer chip — visible app-wide so the scheduled stop is never hidden. */}
        <SleepChip />
        <button
          type="button"
          className="avatar"
          data-testid="open-settings"
          onClick={() => setSheetOpen(true)}
          aria-label="Open settings"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Google avatar; next/image remote config is out of U4 scope
            <img src={user.image} alt="" referrerPolicy="no-referrer" />
          ) : (
            initialOf(user)
          )}
        </button>
      </header>

      <main id="main-content" className="screen" tabIndex={-1}>
        {children}
      </main>

      {/* Shell-level status: the one write that happens with no control on screen to
          attach to (volume persistence). Floats clear of the dock. */}
      <WriteStatus message={message} className="write-status-shell" testId="shell-status" />

      <div className="dock">
        {withMiniPlayer ? (
          <MiniPlayer
            onExpand={() => setNpOpen(true)}
            onQueue={() => setQueueOpen(true)}
          />
        ) : null}
        <TabBar />
      </div>

      <NowPlaying
        open={npOpen}
        onClose={() => setNpOpen(false)}
        onQueue={() => setQueueOpen(true)}
        lyricsEnabled={lyricsEnabled}
      />

      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />

      <ProfileSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        user={user}
        lyricsEnabled={lyricsEnabled}
        onLyricsChange={setLyricsEnabled}
        crossfadeSec={crossfadeSec}
        onCrossfadeChange={changeCrossfade}
        preferAudio={preferAudio}
        onPreferAudioChange={setPreferAudio}
        autoplaySimilar={autoplaySimilar}
        onAutoplaySimilarChange={setAutoplaySimilar}
      />
    </div>
  );
}

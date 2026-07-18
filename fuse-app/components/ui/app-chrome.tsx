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

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
// Side-effect import: registering the Spotify adapter at app load is what flips
// Spotify search results from disabled to a real, enabled play button (its honest
// YouTube fallback — U15/KTD-2). Mirrors how the YouTube adapter self-registers when
// the mini-player mounts. No secret is read; the module load is pure.
import "@/lib/player/adapters/spotify";
import { showsMiniPlayer } from "@/lib/ui/shell";
import { blendController, setLiveCrossfadeSec } from "@/lib/player/blend-controller";
import TabBar from "@/components/ui/tab-bar";
import MiniPlayer from "@/components/player/mini-player";
import NowPlaying from "@/components/player/now-playing";
import ProfileSheet from "@/components/settings/profile-sheet";
import PlayRecorder from "@/components/home/play-recorder";

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
  children: React.ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Whether the full Now Playing screen is expanded over the phone frame (R4). Owned
  // here so the mini-player's expand tap and the overlay stay in sync, and so the mini
  // can hand the single visible YouTube video up to Now Playing while it is open.
  const [npOpen, setNpOpen] = useState(false);
  const [lyricsEnabled, setLyricsEnabled] = useState(initialLyricsEnabled);
  const [crossfadeSec, setCrossfadeSec] = useState(initialCrossfadeSec);
  const pathname = usePathname() ?? "/";
  const withMiniPlayer = showsMiniPlayer(pathname);

  // Seed the live blend length from the persisted value and start the auto-crossfade
  // engine watching the player. The engine is a singleton and start() is idempotent,
  // so this is safe across re-renders; it is torn down if the shell ever unmounts.
  useEffect(() => {
    setLiveCrossfadeSec(initialCrossfadeSec);
    return blendController.start();
  }, [initialCrossfadeSec]);

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

      <header className="topbar">
        <span className="brand">Fuse</span>
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

      <div className="dock">
        {withMiniPlayer ? (
          <MiniPlayer npOpen={npOpen} onExpand={() => setNpOpen(true)} />
        ) : null}
        <TabBar />
      </div>

      <NowPlaying
        open={npOpen}
        onClose={() => setNpOpen(false)}
        lyricsEnabled={lyricsEnabled}
      />

      <ProfileSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        user={user}
        lyricsEnabled={lyricsEnabled}
        onLyricsChange={setLyricsEnabled}
        crossfadeSec={crossfadeSec}
        onCrossfadeChange={changeCrossfade}
      />
    </div>
  );
}

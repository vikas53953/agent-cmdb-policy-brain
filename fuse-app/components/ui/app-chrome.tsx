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

import { useState } from "react";
import { usePathname } from "next/navigation";
import { showsMiniPlayer } from "@/lib/ui/shell";
import TabBar from "@/components/ui/tab-bar";
import MiniPlayer from "@/components/player/mini-player";
import NowPlaying from "@/components/player/now-playing";
import ProfileSheet from "@/components/settings/profile-sheet";

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
  children,
}: {
  user: ShellUser | null;
  // The persisted Lyrics on/off setting (U9, R16). Owned here as shell state so the
  // profile-sheet toggle and the Now Playing lyrics panel stay in sync instantly,
  // while the toggle also persists to the user's settings for the next session.
  lyricsEnabled: boolean;
  children: React.ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Whether the full Now Playing screen is expanded over the phone frame (R4). Owned
  // here so the mini-player's expand tap and the overlay stay in sync, and so the mini
  // can hand the single visible YouTube video up to Now Playing while it is open.
  const [npOpen, setNpOpen] = useState(false);
  const [lyricsEnabled, setLyricsEnabled] = useState(initialLyricsEnabled);
  const pathname = usePathname() ?? "/";
  const withMiniPlayer = showsMiniPlayer(pathname);

  return (
    <div className="app-frame">
      <header className="topbar">
        <span className="brand">Fuse</span>
        <button
          type="button"
          className="avatar"
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

      <main className="screen">{children}</main>

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
      />
    </div>
  );
}

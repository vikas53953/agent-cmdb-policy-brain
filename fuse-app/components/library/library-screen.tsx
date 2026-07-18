"use client";

// Library screen (U10, R8/R9/R14). The prototype's three-tab library: Liked,
// Playlists, Uploads. This client component owns only the active-tab state; the
// per-tab data (liked tracks, playlists) is fetched on the server and passed in, so
// no per-user data crosses into the client bundle beyond what is rendered.

import { useState } from "react";
import type { LikedTrackDTO, PlaylistDTO } from "@/lib/library/dto";
import LikedList from "@/components/library/liked-list";
import PlaylistsPane from "@/components/library/playlists-pane";
import UploadsPane from "@/components/library/uploads-pane";

type LibTab = "liked" | "playlists" | "uploads";

const TABS: readonly { id: LibTab; label: string }[] = [
  { id: "liked", label: "Liked" },
  { id: "playlists", label: "Playlists" },
  { id: "uploads", label: "Uploads" },
];

export default function LibraryScreen({
  likes,
  playlists,
}: {
  likes: LikedTrackDTO[];
  playlists: PlaylistDTO[];
}) {
  const [tab, setTab] = useState<LibTab>("liked");

  return (
    <div className="library">
      <h1 className="library-heading">Library</h1>

      <div className="lib-tabs" role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`lib-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`lib-panel-${t.id}`}
            className={tab === t.id ? "lib-tab active" : "lib-tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`lib-panel-${tab}`}
        aria-labelledby={`lib-tab-${tab}`}
        className="lib-panel"
      >
        {tab === "liked" ? <LikedList initial={likes} /> : null}
        {tab === "playlists" ? <PlaylistsPane initial={playlists} /> : null}
        {tab === "uploads" ? <UploadsPane /> : null}
      </div>
    </div>
  );
}

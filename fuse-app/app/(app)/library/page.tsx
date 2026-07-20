// Library route (U10, R8/R9/R14). Server component: it resolves the signed-in user
// and reads their liked tracks and playlists through the repos layer (ownerId-scoped),
// then hands plain DTOs to the client Library screen. The read itself lives in
// lib/home/load.ts, which is unit-testable without rendering React.
//
// KEYLESS / SIGNED-OUT SAFETY: the whole app is auth-gated by the proxy, but this read
// is still guarded — with no session it renders an honest empty library, and because
// the layout is force-dynamic this never runs at build time.
//
// HONESTY ON FAILURE (R17): a database outage now arrives as LoadResult status
// "failed", so we say the read failed instead of rendering "No liked songs yet." over
// a library that is actually full. A user's saves must never look deleted because a
// query timed out.

import Link from "next/link";
import { loadLibrary } from "@/lib/home/load-server";
import LibraryScreen from "@/components/library/library-screen";

export default async function LibraryPage() {
  const result = await loadLibrary();

  if (result.status === "failed") {
    // TODO(components): give LibraryScreen a `loadFailed: boolean` prop and pass
    // `result.status === "failed"`, so the tabs stay on screen and each pane shows this
    // message in place of its empty copy ("No liked songs yet." / "No playlists yet.")
    // rather than the whole screen being replaced.
    return (
      <div className="library">
        <h1 className="library-heading">Library</h1>
        <div className="np-stall" role="alert">
          <span>We couldn&apos;t load your library. Nothing has been deleted — this is a connection problem.</span>
          {/* A fresh navigation to this same dynamic route re-runs the server read — the
              retry the old silent-empty-state gave the user no way to ask for. */}
          <Link className="np-stall-skip" href="/library" prefetch={false}>
            Try again
          </Link>
        </div>
      </div>
    );
  }

  return <LibraryScreen likes={result.data.likes} playlists={result.data.playlists} />;
}

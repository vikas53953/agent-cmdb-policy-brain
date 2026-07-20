// Home route (U12, R10/R11, F4, KTD-4). Server component: it resolves the signed-in
// user and assembles the home feed from the repos layer, then hands plain DTOs to the
// client Home screen.
//
// The feed "learns": with no history the rows are generic (curated trending seed +
// popular picks); as the user plays and likes, their history pulls related items up
// (recommend()) and real aggregate trending graduates in once enough data exists
// (chooseTrending() / KTD-4). The assembly itself lives in lib/home/load.ts so it is
// unit-testable without rendering React; this file is purely the surface.
//
// KEYLESS / SIGNED-OUT SAFETY: the app is auth-gated by the proxy and the layout is
// force-dynamic, so this never runs at build time. A signed-out / keyless render is an
// honest generic home, so `next build` with no env is unaffected.
//
// HONESTY ON FAILURE (R17): the loader answers with a LoadResult, so a database outage
// arrives here as status "failed" — NOT as an empty feed. We render a plain failure
// notice with a retry instead of HomeScreen's "your home fills in as you listen", which
// would tell a user with real history that they have none.

import Link from "next/link";
import { loadHome } from "@/lib/home/load-server";
import HomeScreen from "@/components/home/home-screen";
import SpotifyConnectStatus from "@/components/ui/spotify-connect-status";

export default async function HomePage() {
  const result = await loadHome();

  if (result.status === "failed") {
    // TODO(components): give HomeScreen a `loadFailed: boolean` prop and pass
    // `result.status === "failed"`, so the failure reads inside the normal home chrome
    // (blend strip + rails) instead of replacing the screen. HomeScreen must suppress
    // its "Your home fills in as you listen…" empty copy whenever `loadFailed` is true.
    return (
      <div className="home">
        <div className="np-stall" role="alert">
          <span>We couldn&apos;t reach your music. Nothing is lost — this is a connection problem.</span>
          {/* A fresh navigation to this same dynamic route re-runs the server read — the
              retry the old silent-empty-state gave the user no way to ask for. */}
          <Link className="np-stall-skip" href="/" prefetch={false}>
            Try again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* The Spotify routes land the user back here with `?spotify=...`. This is the
          consumer that finally says what happened (AUDIT 1) and clears the parameter. */}
      <SpotifyConnectStatus />
      <HomeScreen data={result.data} />
    </>
  );
}

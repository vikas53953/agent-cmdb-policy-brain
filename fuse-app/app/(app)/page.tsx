// Home route (U12, R10/R11, F4, KTD-4). Server component: it resolves the signed-in
// user and assembles the home feed from the repos layer, then hands plain DTOs to the
// client Home screen.
//
// The feed "learns": with no history the rows are generic (curated trending seed +
// popular picks); as the user plays and likes, their history pulls related items up
// (recommend()) and real aggregate trending graduates in once enough data exists
// (chooseTrending() / KTD-4).
//
// KEYLESS / SIGNED-OUT SAFETY: the app is auth-gated by the proxy and the layout is
// force-dynamic, so this never runs at build time. Every read is still guarded — with
// no DATABASE_URL / no session it degrades to an honest empty home instead of throwing,
// so `next build` with no env is unaffected and a real session gets real data.

import { getUser } from "@/lib/auth-session";
import { listLikes } from "@/lib/repos/likes";
import { listRecentPlays, trendingSeed, trendingTracks } from "@/lib/repos/plays";
import { isTrackSource, type TrackRef } from "@/lib/repos/track";
import { recommend, chooseTrending, dedupeTracks } from "@/lib/home/recommend";
import HomeScreen, { type HomeData } from "@/components/home/home-screen";

// Coerce any stored track-bearing row (seed / play / like) into the source-agnostic
// TrackRef the UI renders. A corrupt/unknown source defaults to "youtube" so a bad row
// still renders a sensible badge rather than crashing.
function toHomeTrack(row: {
  source: string;
  nativeId: string;
  title: string;
  artist?: string | null;
  artUrl?: string | null;
  durationSec?: number | null;
}): TrackRef {
  return {
    source: isTrackSource(row.source) ? row.source : "youtube",
    nativeId: row.nativeId,
    title: row.title,
    artist: row.artist ?? null,
    artUrl: row.artUrl ?? null,
    durationSec: row.durationSec ?? null,
  };
}

const EMPTY_HOME: HomeData = {
  recentlyPlayed: [],
  trending: [],
  recommended: [],
  personalised: false,
};

async function loadHome(): Promise<HomeData> {
  try {
    const user = await getUser();
    const seedTracks = (await trendingSeed(20)).map(toHomeTrack);

    // Signed-out / no session (keyless dev): a generic home from the curated seed only.
    if (!user) {
      return {
        recentlyPlayed: [],
        trending: seedTracks,
        recommended: seedTracks.slice(0, 12),
        personalised: false,
      };
    }

    const [likeRows, recentRows, countTracks] = await Promise.all([
      listLikes(user.id),
      // Fetch a deeper slice than we show so de-duplication still leaves a full row: the
      // same track played several times must appear ONCE, at its most-recent position
      // (owner fix 6), like every big player. Rows come back newest-first, so keeping the
      // FIRST occurrence of each track keeps the most recent play and its order.
      listRecentPlays(user.id, 60),
      trendingTracks(20),
    ]);
    const likes = likeRows.map(toHomeTrack);
    const recent = dedupeTracks([recentRows.map(toHomeTrack)]).slice(0, 12);

    // KTD-4: real aggregate trending once it has grown enough, else the curated seed.
    const trending = chooseTrending(seedTracks, countTracks);

    // The candidate pool for "more like what you love": trending plus the user's own
    // tracks, deduped. With no history this is just the seed (generic); as history
    // grows, the user's loved artists appear in the pool and recommend() ranks them up.
    const pool = dedupeTracks([trending, recent, likes]);
    const recommended = recommend({ likes, recent, pool, limit: 12 });

    return {
      recentlyPlayed: recent,
      trending,
      recommended,
      personalised: likes.length > 0 || recent.length > 0,
    };
  } catch {
    // No DB / keyless — degrade to an honest empty home, never a crash.
    return EMPTY_HOME;
  }
}

export default async function HomePage() {
  const data = await loadHome();
  return <HomeScreen data={data} />;
}

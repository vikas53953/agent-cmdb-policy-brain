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
import {
  listRecentPlayEvents,
  listRecentPlays,
  trendingSeed,
  trendingTracks,
} from "@/lib/repos/plays";
import { isTrackSource, type TrackRef } from "@/lib/repos/track";
import {
  recommend,
  chooseTrending,
  dedupeTracks,
  isRealTrending,
  trackKey,
} from "@/lib/home/recommend";
import { coPlayAffinity } from "@/lib/home/coplay";
import { withResolvedArt, withResolvedArtAll } from "@/lib/home/art";
import { diversifyHomeRows } from "@/lib/home/diversify";
import HomeScreen, { type HomeData } from "@/components/home/home-screen";
import SpotifyConnectStatus from "@/components/ui/spotify-connect-status";

// Coerce any stored track-bearing row (seed / play / like) into the source-agnostic
// TrackRef the UI renders. A corrupt/unknown source defaults to "youtube" so a bad row
// still renders a sensible badge rather than crashing.
//
// COVER ART (R5): Home renders PERSISTED rows, whose `artUrl` column is nullable — a row
// written before art was captured comes back with no art and used to render a plain grey
// box, even though the very same video shows artwork on Search (which renders live
// provider results that always carry a thumbnail). So this single boundary resolves art
// for every Home row via withResolvedArt(): a YouTube track's thumbnail is DERIVED from
// its video id (keyless, CSP-allowed) rather than left blank. Nothing is invented — a
// source whose art can't be derived from an id keeps a null artUrl.
function toHomeTrack(row: {
  source: string;
  nativeId: string;
  title: string;
  artist?: string | null;
  artUrl?: string | null;
  durationSec?: number | null;
}): TrackRef {
  return withResolvedArt({
    source: isTrackSource(row.source) ? row.source : "youtube",
    nativeId: row.nativeId,
    title: row.title,
    artist: row.artist ?? null,
    artUrl: row.artUrl ?? null,
    durationSec: row.durationSec ?? null,
  });
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
    // Both rows draw from the SAME seed, so diversify so a seed track never shows twice
    // (F-0 item 3) — Trending fills first, More-like backfills from what's left.
    if (!user) {
      const generic = diversifyHomeRows({
        recentlyPlayed: [],
        trendingPool: seedTracks,
        recommendedPool: seedTracks,
      });
      return {
        recentlyPlayed: [],
        trending: generic.trending,
        recommended: generic.recommended,
        personalised: false,
        // Seed data by definition — the row says "Starter picks", never "Trending".
        trendingIsReal: false,
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
    // `trendingTracks` already returns TrackRefs (it does its own row → TrackRef mapping),
    // so it never passes through toHomeTrack — resolve its art here so the aggregate
    // trending row is covered by the same rule as every other row.
    const trendingCounts = withResolvedArtAll(countTracks);
    const likes = likeRows.map(toHomeTrack);
    const recent = dedupeTracks([recentRows.map(toHomeTrack)]).slice(0, 12);

    // KTD-4: real aggregate trending once it has grown enough, else the curated seed.
    // The SAME predicate decides the contents and the row's name, so the two can never
    // disagree — the row only calls itself "Trending" when real play data backs it.
    const trendingIsReal = isRealTrending(trendingCounts);
    const trendingPool = chooseTrending(seedTracks, trendingCounts);

    // Co-play signal (AUDIT 36): what people actually play in the same sitting as the
    // tracks this user loves. Fetched separately and allowed to fail — a recommendation
    // signal going missing must degrade the ranking, never blank the whole home feed.
    const coPlay = await listRecentPlayEvents()
      .then((events) => coPlayAffinity(events, [...likes, ...recent].map(trackKey)))
      .catch(() => undefined);

    // The candidate pool for "more like what you love": trending plus the user's own
    // tracks, deduped. With no history this is just the seed (generic); as history
    // grows, the user's loved artists appear in the pool and recommend() ranks them up.
    // Ask recommend() for a DEEPER pool than we display so, after cross-row de-duplication
    // (F-0 item 3), the row can still backfill to a full 12.
    const pool = dedupeTracks([trendingPool, recent, likes]);
    const recommendedPool = recommend({ likes, recent, pool, coPlay, limit: 24 });

    // F-0 item 3: no track appears in more than one row. Recently played keeps its tracks;
    // Trending and More-like exclude what's already shown and backfill from their pools.
    const rows = diversifyHomeRows({
      recentlyPlayed: recent,
      trendingPool,
      recommendedPool,
    });

    return {
      recentlyPlayed: rows.recentlyPlayed,
      trending: rows.trending,
      recommended: rows.recommended,
      personalised: likes.length > 0 || recent.length > 0,
      trendingIsReal,
    };
  } catch {
    // No DB / keyless — degrade to an honest empty home, never a crash.
    return EMPTY_HOME;
  }
}

export default async function HomePage() {
  const data = await loadHome();
  return (
    <>
      {/* The Spotify routes land the user back here with `?spotify=...`. This is the
          consumer that finally says what happened (AUDIT 1) and clears the parameter. */}
      <SpotifyConnectStatus />
      <HomeScreen data={data} />
    </>
  );
}

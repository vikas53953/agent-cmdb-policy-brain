// Server-side loaders for the signed-in surfaces (Home, Library) and the load-result
// contract they answer with.
//
// THE BUG THIS KILLS: both pages used to `catch { return EMPTY_… }`. A Postgres blip
// therefore rendered as "Your home fills in as you listen…" and "No liked songs yet."
// — the app telling a user with 200 liked songs that they have none, with no way to
// retry. That is the app lying, which R17 forbids more strongly than any empty row.
//
// The fix is class-level, not a per-page patch: the DATA CONTRACT itself now carries
// the distinction. `LoadResult` is either "ok" or "failed", so NO surface built on it
// can accidentally collapse a failure into an empty state — the status has to be
// handled to get at the data. `data` is still populated on failure (with the empty
// fallback) so a caller that only wants to render a shell never crashes; it simply
// cannot claim the shell is the truth.
//
// The loaders live here rather than inline in the page files so they are unit-testable
// without rendering React: a page.tsx cannot be imported by the node-env unit run. They
// take their repo/session calls as arguments and import NOTHING from the auth or
// database stack, so the failure path can be exercised in plain node. The pure home
// helpers (recommend / co-play / art / diversify) ARE imported directly — they are
// plain functions with no runtime dependencies, and injecting them would only let the
// test prove a different ranking than production runs. The production wiring — which
// real repo goes in which slot — lives next door in `load-server.ts`.

import type { TrackRef } from "@/lib/repos/track";
import type { LikedTrackDTO, PlaylistDTO } from "@/lib/library/dto";
import type { PlayEvent } from "@/lib/home/coplay";
import { toLikedTrackDTO, toPlaylistDTO } from "@/lib/library/dto";
import { isTrackSource } from "@/lib/repos/track";
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

// A read either succeeded or it did not. "failed" is NOT "empty" — the whole point of
// the type is that those two can never again be confused by a rendering surface.
export type LoadResult<T> =
  | { status: "ok"; data: T }
  | { status: "failed"; data: T };

export function ok<T>(data: T): LoadResult<T> {
  return { status: "ok", data };
}

export function failed<T>(fallback: T): LoadResult<T> {
  return { status: "failed", data: fallback };
}

// Structurally identical to the client HomeScreen's `HomeData`. Declared here so the
// server contract owns its own shape and the loader stays importable by unit tests
// (importing the component would drag JSX into the node test run).
export type HomeFeed = {
  recentlyPlayed: TrackRef[];
  trending: TrackRef[];
  recommended: TrackRef[];
  // Whether "more like what you love" is tuned to real history yet (R11).
  personalised: boolean;
  // Whether `trending` is real aggregate play-count data or the hand-picked starter
  // seed. Absence means "starter picks" — the row only names itself on a positive fact.
  trendingIsReal?: boolean;
};

export type LibraryData = {
  likes: LikedTrackDTO[];
  playlists: PlaylistDTO[];
};

export const EMPTY_HOME: HomeFeed = {
  recentlyPlayed: [],
  trending: [],
  recommended: [],
  personalised: false,
};

export const EMPTY_LIBRARY: LibraryData = { likes: [], playlists: [] };

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

// The repo calls the loaders make, injected so the failure path can be proven in a unit
// test without a database — and so this module stays free of the auth/Prisma imports
// that cannot load outside a Next runtime.
type SessionUserLike = { id: string; email: string | null; name: string | null; image: string | null };
type TrackRowLike = {
  source: string;
  nativeId: string;
  title: string;
  artist?: string | null;
  artUrl?: string | null;
  durationSec?: number | null;
};
type LikeRowLike = TrackRowLike & { id: string; artist: string | null; artUrl: string | null; durationSec: number | null };
type PlaylistRowLike = {
  id: string;
  name: string;
  tracks: (TrackRowLike & { id: string; artist: string | null; artUrl: string | null; durationSec: number | null })[];
};

export type HomeDeps = {
  getUser: () => Promise<SessionUserLike | null>;
  listLikes: (userId: string) => Promise<LikeRowLike[]>;
  listRecentPlays: (userId: string, limit: number) => Promise<TrackRowLike[]>;
  listRecentPlayEvents: () => Promise<PlayEvent[]>;
  trendingSeed: (limit: number) => Promise<TrackRowLike[]>;
  trendingTracks: (limit: number) => Promise<TrackRef[]>;
};

export type LibraryDeps = {
  getUser: () => Promise<SessionUserLike | null>;
  listLikes: (userId: string) => Promise<LikeRowLike[]>;
  listPlaylists: (userId: string) => Promise<PlaylistRowLike[]>;
};

// Assemble the home feed. A signed-out / keyless environment is a legitimate "ok" with
// a generic feed; only a thrown read (DB down) is "failed".
export async function loadHomeFeed(deps: HomeDeps): Promise<LoadResult<HomeFeed>> {
  try {
    const user = await deps.getUser();
    const seedTracks = (await deps.trendingSeed(20)).map(toHomeTrack);

    // Signed-out / no session (keyless dev): a generic home from the curated seed only.
    // Both rows draw from the SAME seed, so diversify so a seed track never shows twice
    // (F-0 item 3) — Trending fills first, More-like backfills from what's left.
    // This is a real answer, not a failure — the shell is honest about being generic.
    if (!user) {
      const generic = diversifyHomeRows({
        recentlyPlayed: [],
        trendingPool: seedTracks,
        recommendedPool: seedTracks,
      });
      return ok({
        recentlyPlayed: [],
        trending: generic.trending,
        recommended: generic.recommended,
        personalised: false,
        // Seed data by definition — the row says "Starter picks", never "Trending".
        trendingIsReal: false,
      });
    }

    const [likeRows, recentRows, countTracks] = await Promise.all([
      deps.listLikes(user.id),
      // Fetch a deeper slice than we show so de-duplication still leaves a full row: the
      // same track played several times must appear ONCE, at its most-recent position
      // (owner fix 6), like every big player. Rows come back newest-first, so keeping the
      // FIRST occurrence of each track keeps the most recent play and its order.
      deps.listRecentPlays(user.id, 60),
      deps.trendingTracks(20),
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
    // Note this catch is INSIDE the ok path on purpose: a missing co-play signal is a
    // weaker feed, not a failed read, so it must not flip the result to "failed".
    const coPlay = await deps
      .listRecentPlayEvents()
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

    return ok({
      recentlyPlayed: rows.recentlyPlayed,
      trending: rows.trending,
      recommended: rows.recommended,
      personalised: likes.length > 0 || recent.length > 0,
      trendingIsReal,
    });
  } catch {
    // The DB is unreachable. We do NOT know the user has no music — say so, and let the
    // surface offer a retry instead of printing a false empty state.
    return failed(EMPTY_HOME);
  }
}

// The caller's liked tracks + playlists. Signed-out is an honest empty library ("ok");
// a thrown read is "failed" so the surface never claims the user's saves are gone.
export async function loadLibraryData(deps: LibraryDeps): Promise<LoadResult<LibraryData>> {
  try {
    const user = await deps.getUser();
    if (!user) return ok(EMPTY_LIBRARY);
    const [likeRows, playlistRows] = await Promise.all([
      deps.listLikes(user.id),
      deps.listPlaylists(user.id),
    ]);
    return ok({
      likes: likeRows.map(toLikedTrackDTO),
      playlists: playlistRows.map(toPlaylistDTO),
    });
  } catch {
    return failed(EMPTY_LIBRARY);
  }
}

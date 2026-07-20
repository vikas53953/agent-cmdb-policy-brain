// Production wiring for the Home/Library loaders.
//
// `load.ts` holds the logic and the LoadResult contract but imports nothing from the
// auth or Prisma stack, so it can be unit-tested in plain node. This file is the one
// place that binds the real session helper and the real repos into it — the pages call
// these two functions and nothing else. Keeping the seam here means the failure
// behaviour proven by the unit tests is the SAME code that runs in production; only the
// repo function references differ.

import { getUser } from "@/lib/auth-session";
import { listLikes } from "@/lib/repos/likes";
import { listPlaylists } from "@/lib/repos/playlists";
import {
  listRecentPlayEvents,
  listRecentPlays,
  trendingSeed,
  trendingTracks,
} from "@/lib/repos/plays";
import {
  loadHomeFeed,
  loadLibraryData,
  type HomeDeps,
  type LibraryDeps,
  type HomeFeed,
  type LibraryData,
  type LoadResult,
} from "./load";

const HOME_DEPS: HomeDeps = {
  getUser,
  listLikes,
  listRecentPlays: (userId, limit) => listRecentPlays(userId, limit),
  // Defaults for the window/cap live in the repo — the loader has no opinion on them.
  listRecentPlayEvents: () => listRecentPlayEvents(),
  trendingSeed: (limit) => trendingSeed(limit),
  trendingTracks: (limit) => trendingTracks(limit),
};

const LIBRARY_DEPS: LibraryDeps = {
  getUser,
  listLikes,
  listPlaylists,
};

export function loadHome(): Promise<LoadResult<HomeFeed>> {
  return loadHomeFeed(HOME_DEPS);
}

export function loadLibrary(): Promise<LoadResult<LibraryData>> {
  return loadLibraryData(LIBRARY_DEPS);
}

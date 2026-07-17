// Source-agnostic track identity shared by every owned row that references a song
// (Like, PlaylistTrack, Play) and by the trending seed. There is no canonical Track
// table (KTD-6 / U3 schema): songs live in external sources, so each row carries the
// display fields it needs to render real cover art (R5) without a second lookup.
//
// This is the single definition of "what a track looks like" across the repos layer,
// so the player store (U5) and the UI can pass one shape everywhere.

export type TrackSource = "youtube" | "spotify" | "local";

export const TRACK_SOURCES: readonly TrackSource[] = ["youtube", "spotify", "local"];

export function isTrackSource(value: unknown): value is TrackSource {
  return typeof value === "string" && (TRACK_SOURCES as readonly string[]).includes(value);
}

// The identity + display fields for a track from any source. `nativeId` is the id
// within its source (YouTube video id, Spotify track uri, local-file key).
export type TrackRef = {
  source: TrackSource;
  nativeId: string;
  title: string;
  artist: string | null;
  artUrl: string | null;
  durationSec: number | null;
};

// The persisted columns a track contributes to a row. Kept separate from TrackRef so
// repo writes spread exactly these fields onto a create input.
export type TrackColumns = {
  source: string;
  nativeId: string;
  title: string;
  artist: string | null;
  artUrl: string | null;
  durationSec: number | null;
};

// Narrow a loose track input to the persisted columns, normalizing optionals to null.
// Callers (routes, player) may hand us partial objects; this keeps a single coercion
// point so no repo has to defensively re-null every field.
export function toTrackColumns(input: {
  source: string;
  nativeId: string;
  title: string;
  artist?: string | null;
  artUrl?: string | null;
  durationSec?: number | null;
}): TrackColumns {
  return {
    source: input.source,
    nativeId: input.nativeId,
    title: input.title,
    artist: input.artist ?? null,
    artUrl: input.artUrl ?? null,
    durationSec: input.durationSec ?? null,
  };
}

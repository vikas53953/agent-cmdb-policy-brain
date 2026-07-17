// Library DTOs (U10, R8/R9).
//
// The Library screen is a client component, so the data it renders must cross the
// server→client boundary as plain serializable values. Prisma rows carry Date
// objects and extra columns; these DTOs are the trimmed, source-agnostic shapes the
// UI actually needs — a track's identity + display fields (real cover art per R5)
// plus the row id the UI uses as a stable key and for mutations.
//
// One mapper per row type keeps the coercion in a single place: the page and the
// server actions both return these shapes, so the client never sees a raw Prisma row.

import type { TrackRef, TrackSource } from "@/lib/repos/track";
import { isTrackSource } from "@/lib/repos/track";

// A liked track as the Library renders it: the track itself plus the Like row id
// (used as the React key; unlike is keyed by source+nativeId, not this id).
export type LikedTrackDTO = TrackRef & { likeId: string };

// One track inside a playlist: the track plus its PlaylistTrack row id, which the
// UI needs to reorder or remove exactly that entry (two identical tracks can appear).
export type PlaylistTrackDTO = TrackRef & { itemId: string };

// A playlist with its ordered tracks.
export type PlaylistDTO = {
  id: string;
  name: string;
  tracks: PlaylistTrackDTO[];
};

// Narrow a stored source string to the TrackSource union, defaulting unknown values
// to "youtube" so a corrupt row still renders a sensible badge rather than crashing.
function toSource(value: string): TrackSource {
  return isTrackSource(value) ? value : "youtube";
}

// The persisted track columns shared by Like and PlaylistTrack rows.
type TrackRow = {
  source: string;
  nativeId: string;
  title: string;
  artist: string | null;
  artUrl: string | null;
  durationSec: number | null;
};

function toTrackRef(row: TrackRow): TrackRef {
  return {
    source: toSource(row.source),
    nativeId: row.nativeId,
    title: row.title,
    artist: row.artist,
    artUrl: row.artUrl,
    durationSec: row.durationSec,
  };
}

export function toLikedTrackDTO(row: TrackRow & { id: string }): LikedTrackDTO {
  return { ...toTrackRef(row), likeId: row.id };
}

export function toPlaylistTrackDTO(row: TrackRow & { id: string }): PlaylistTrackDTO {
  return { ...toTrackRef(row), itemId: row.id };
}

export function toPlaylistDTO(row: {
  id: string;
  name: string;
  tracks: (TrackRow & { id: string })[];
}): PlaylistDTO {
  return {
    id: row.id,
    name: row.name,
    tracks: row.tracks.map(toPlaylistTrackDTO),
  };
}

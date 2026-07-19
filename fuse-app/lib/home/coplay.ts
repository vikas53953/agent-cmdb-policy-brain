// Co-play signal for "More like what you love" (audit 36).
//
// WHY THIS EXISTS: the row used to score candidates on artist affinity alone, so it
// really delivered "more by artists you already played". A second, genuinely different
// signal was needed — one this app can actually compute from data it already stores,
// never an invented score.
//
// WHAT WE HAVE: every Play row carries ownerId + playedAt (prisma/schema.prisma, model
// Play). That is enough to reconstruct listening SESSIONS — a run of plays by one
// person with no long gap between them — and to count which songs keep turning up in
// the same session as each other. Two songs people repeatedly listen to back to back
// are related in a way artist name cannot see (same mood, same scene, same era).
//
// WHAT WE DO NOT HAVE: genres, audio features, and embeddings are nowhere in this
// database, so nothing here pretends to use them.
//
// PRIVACY: co-play is aggregated across everyone and returns only counts keyed by
// track. Sessions are grouped by ownerId to keep one person's listening from bleeding
// into another's, but no owner id ever leaves this module.
//
// Pure and framework-free so it unit-tests without a database.

import { trackKey } from "./recommend";

// Two plays belong to the same listening session when less than this much time passes
// between them. 30 minutes: long enough to survive a pause or a skip-heavy stretch,
// short enough that this morning and tonight are not treated as one sitting.
export const SESSION_GAP_MS = 30 * 60 * 1000;

export type PlayEvent = {
  ownerId: string;
  source: string;
  nativeId: string;
  playedAt: Date;
};

// Split raw play events into per-person listening sessions. Each session is the set of
// distinct track keys played in that sitting (a song on repeat counts once, so looping
// one track cannot inflate its links).
export function buildSessions(events: readonly PlayEvent[]): string[][] {
  const byOwner = new Map<string, PlayEvent[]>();
  for (const event of events) {
    const list = byOwner.get(event.ownerId);
    if (list) list.push(event);
    else byOwner.set(event.ownerId, [event]);
  }

  const sessions: string[][] = [];
  for (const list of byOwner.values()) {
    const ordered = [...list].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
    let current: Set<string> | null = null;
    let previousAt = 0;
    for (const event of ordered) {
      const at = event.playedAt.getTime();
      if (!current || at - previousAt >= SESSION_GAP_MS) {
        current = new Set<string>();
        sessions.push([]);
      }
      const key = trackKey(event);
      if (!current.has(key)) {
        current.add(key);
        sessions[sessions.length - 1].push(key);
      }
      previousAt = at;
    }
  }
  return sessions.filter((session) => session.length > 0);
}

// How strongly each track co-occurs with the tracks the user already loves.
//
// `seedKeys` are the user's own tracks (likes + recent plays) as trackKey strings. For
// every session that contains at least one seed track, every OTHER track in that
// session earns one point. A track the user already has scores nothing here — this row
// is for finding new songs, not replaying the old ones.
export function coPlayAffinity(
  events: readonly PlayEvent[],
  seedKeys: readonly string[],
): Map<string, number> {
  const seeds = new Set(seedKeys);
  const scores = new Map<string, number>();
  if (seeds.size === 0) return scores;

  for (const session of buildSessions(events)) {
    if (!session.some((key) => seeds.has(key))) continue;
    for (const key of session) {
      if (seeds.has(key)) continue;
      scores.set(key, (scores.get(key) ?? 0) + 1);
    }
  }
  return scores;
}

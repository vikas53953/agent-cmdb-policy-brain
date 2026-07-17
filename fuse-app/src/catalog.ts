// Demo catalog. The YouTube videoIds are real, so in demo mode (no API keys)
// the app still plays actual audio through the YouTube IFrame player.
// Swap/extend freely, or replace entirely once live search is wired to your keys.

import type { Playlist, Track } from './integrations/types';

function yt(nativeId: string, title: string, artist: string, durationSec: number, quality = 'YouTube'): Track {
  return { id: `youtube:${nativeId}`, source: 'youtube', nativeId, title, artist, durationSec, quality };
}

export const TRACKS: Track[] = [
  yt('a5uQMwRMHcs', 'Instant Crush', 'Daft Punk ft. Julian Casablancas', 337, '4K'),
  yt('dX3k_QDnzHE', 'Midnight City', 'M83', 243),
  yt('MV_3Dpw-BRY', 'Nightcall', 'Kavinsky', 258),
  yt('FGBhQbmPwH8', 'One More Time', 'Daft Punk', 320),
  yt('8GW6sLrK40k', 'Resonance', 'HOME', 212),
  yt('UfcAVejslrU', 'Weightless', 'Marconi Union', 490),
  yt('jfKfPfyJRdk', 'lofi hip hop radio', 'Lofi Girl', 0, 'Live'),
  yt('4xDzrJKXOOY', 'Around the World', 'Daft Punk', 429),
  yt('h4rkmm79r-4', 'Digital Love', 'Daft Punk', 301),
  yt('QN1odfjtMoo', 'Tokyo Drift', 'Teriyaki Boyz', 260),
];

const byId = (nativeId: string) => `youtube:${nativeId}`;

export const PLAYLISTS: Playlist[] = [
  {
    id: 'late-night-drive',
    title: 'Late Night Drive',
    subtitle: 'Cross-source · 6 songs',
    sources: ['spotify', 'youtube'],
    trackIds: [byId('MV_3Dpw-BRY'), byId('8GW6sLrK40k'), byId('QN1odfjtMoo'), byId('dX3k_QDnzHE'), byId('a5uQMwRMHcs'), byId('h4rkmm79r-4')],
  },
  {
    id: 'focus-flow',
    title: 'Focus Flow',
    subtitle: 'YouTube · 3 songs',
    sources: ['youtube'],
    trackIds: [byId('UfcAVejslrU'), byId('jfKfPfyJRdk'), byId('8GW6sLrK40k')],
  },
  {
    id: 'deep-cuts',
    title: 'Deep Cuts',
    subtitle: 'YouTube · 4 songs',
    sources: ['youtube'],
    trackIds: [byId('4xDzrJKXOOY'), byId('h4rkmm79r-4'), byId('FGBhQbmPwH8'), byId('QN1odfjtMoo')],
  },
];

export const LIKED: Playlist = {
  id: 'liked',
  title: 'Liked Songs',
  subtitle: 'Mixed · all sources',
  sources: ['youtube', 'spotify'],
  trackIds: TRACKS.map((t) => t.id),
};

export function trackById(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}

export function playlistById(id: string): Playlist | undefined {
  return [LIKED, ...PLAYLISTS].find((p) => p.id === id);
}

/** Local demo "search": fuzzy match over the catalog when no live keys are set. */
export function demoSearch(query: string): Track[] {
  const q = query.trim().toLowerCase();
  if (!q) return TRACKS.slice(0, 6);
  return TRACKS.filter((t) => (t.title + ' ' + t.artist).toLowerCase().includes(q));
}

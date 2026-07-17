// Unified model shared across every music source (the "adapter" contract).
// Each provider (YouTube, Spotify, …) maps its own API onto these shapes so the
// rest of the app never needs to know where a track actually lives.

export type SourceId = 'youtube' | 'spotify' | 'soundcloud' | 'apple' | 'local';

export interface Track {
  id: string; // unique within Fuse: `${source}:${nativeId}`
  source: SourceId;
  title: string;
  artist: string;
  durationSec?: number;
  /** Provider-native id used to actually play (YouTube videoId, Spotify uri, …). */
  nativeId: string;
  quality?: string; // e.g. "320 kbps", "4K", "Lossless"
  /** Cover art URL (YouTube thumbnail, Spotify album art, …). */
  artUrl?: string;
}

export interface Playlist {
  id: string;
  title: string;
  subtitle: string;
  sources: SourceId[]; // may be cross-source
  trackIds: string[];
}

/** What a source adapter must provide. Playback is handled per-source below. */
export interface SourceAdapter {
  id: SourceId;
  label: string;
  /** True once the user has connected / a key is configured. */
  isConnected(): boolean;
  /** Search this source. Should resolve to unified Tracks. */
  search(query: string): Promise<Track[]>;
}

export const SOURCE_META: Record<SourceId, { label: string; color: string; short: string }> = {
  spotify: { label: 'Spotify', color: '#1ed760', short: 'SP' },
  youtube: { label: 'YouTube', color: '#ff2f43', short: 'YT' },
  soundcloud: { label: 'SoundCloud', color: '#ff6a2b', short: 'SC' },
  apple: { label: 'Apple Music', color: '#fa5a7d', short: 'AP' },
  local: { label: 'Local file', color: '#7a7a84', short: 'FILE' },
};

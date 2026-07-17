// YouTube integration.
//
// TWO separate capabilities, on purpose:
//  1. PLAYBACK via the IFrame Player API — needs NO API key. Works in demo mode.
//  2. SEARCH via the YouTube Data API v3 — needs VITE_YOUTUBE_API_KEY.
//
// This is why the demo can actually play audio with zero credentials: the demo
// catalog carries real videoIds and we hand them to the IFrame player.

import type { SourceAdapter, Track } from './types';

const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

// ---- IFrame Player (playback) -------------------------------------------------

let ytApiPromise: Promise<void> | null = null;

function loadIframeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if ((window as any).YT && (window as any).YT.Player) return resolve();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    (window as any).onYouTubeIframeAPIReady = () => resolve();
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

export interface YouTubePlayer {
  play(videoId: string): void;
  resume(): void;
  pause(): void;
  seekTo(sec: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  setVolume(pct: number): void;
  onStateChange(cb: (playing: boolean) => void): void;
  onEnded(cb: () => void): void;
}

/** Create a hidden YouTube player mounted into `el`. */
export async function createYouTubePlayer(el: HTMLElement): Promise<YouTubePlayer> {
  await loadIframeApi();
  const YT = (window as any).YT;
  let ready = false;
  let pending: string | null = null;
  let stateCb: ((playing: boolean) => void) | null = null;
  let endedCb: (() => void) | null = null;

  const player = new YT.Player(el, {
    height: '0',
    width: '0',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1 },
    events: {
      onReady: () => {
        ready = true;
        if (pending) {
          player.loadVideoById(pending);
          pending = null;
        }
      },
      onStateChange: (e: any) => {
        // 1 = playing, 2 = paused, 0 = ended
        if (stateCb) stateCb(e.data === 1);
        if (e.data === 0 && endedCb) endedCb();
      },
    },
  });

  return {
    play(videoId) {
      if (!ready) { pending = videoId; return; }
      player.loadVideoById(videoId);
    },
    resume() { if (ready) player.playVideo(); },
    pause() { if (ready) player.pauseVideo(); },
    seekTo(sec) { if (ready) player.seekTo(sec, true); },
    getCurrentTime() { return ready ? player.getCurrentTime() || 0 : 0; },
    getDuration() { return ready ? player.getDuration() || 0 : 0; },
    setVolume(pct) { if (ready) player.setVolume(pct); },
    onStateChange(cb) { stateCb = cb; },
    onEnded(cb) { endedCb = cb; },
  };
}

// ---- Data API (search) --------------------------------------------------------

export const youtubeAdapter: SourceAdapter = {
  id: 'youtube',
  label: 'YouTube',
  isConnected: () => Boolean(API_KEY),
  async search(query: string): Promise<Track[]> {
    if (!API_KEY) return []; // demo mode falls back to the local catalog
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15` +
      `&q=${encodeURIComponent(query)}&key=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`YouTube search failed: ${res.status}`);
    const data = await res.json();
    return (data.items ?? []).map((item: any): Track => ({
      id: `youtube:${item.id.videoId}`,
      source: 'youtube',
      nativeId: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      quality: 'YouTube',
      artUrl: item.snippet.thumbnails?.high?.url ?? `https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,
    }));
  },
};

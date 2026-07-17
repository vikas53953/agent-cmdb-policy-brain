import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Track } from './integrations/types';
import { createYouTubePlayer, type YouTubePlayer } from './integrations/youtube';

interface PlayerState {
  current: Track | null;
  queue: Track[];
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  play: (track: Track, queue?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
}

const Ctx = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  const ytRef = useRef<YouTubePlayer | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Lazily create the hidden YouTube player on first play.
  const ensureYouTube = useCallback(async (): Promise<YouTubePlayer> => {
    if (ytRef.current) return ytRef.current;
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.width = '0';
    host.style.height = '0';
    host.style.overflow = 'hidden';
    document.body.appendChild(host);
    hostRef.current = host;
    const p = await createYouTubePlayer(host);
    p.onStateChange((playing) => setIsPlaying(playing));
    ytRef.current = p;
    return p;
  }, []);

  const play = useCallback((track: Track, q?: Track[]) => {
    setCurrent(track);
    if (q) setQueue(q);
    setPositionSec(0);
    if (track.source === 'youtube') {
      void ensureYouTube().then((p) => p.play(track.nativeId));
      setIsPlaying(true);
    } else {
      // Spotify/other sources: playback lands here once their SDK is wired.
      setIsPlaying(true);
    }
  }, [ensureYouTube]);

  const toggle = useCallback(() => {
    const p = ytRef.current;
    if (current?.source === 'youtube' && p) {
      if (isPlaying) p.pause(); else p.resume();
    }
    setIsPlaying((v) => !v);
  }, [current, isPlaying]);

  const indexInQueue = useCallback(() => (current ? queue.findIndex((t) => t.id === current.id) : -1), [current, queue]);

  const next = useCallback(() => {
    const i = indexInQueue();
    if (i >= 0 && i < queue.length - 1) play(queue[i + 1], queue);
  }, [indexInQueue, queue, play]);

  const prev = useCallback(() => {
    const i = indexInQueue();
    if (i > 0) play(queue[i - 1], queue);
  }, [indexInQueue, queue, play]);

  const seek = useCallback((sec: number) => {
    ytRef.current?.seekTo(sec);
    setPositionSec(sec);
  }, []);

  // Poll position/duration from the active player.
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = ytRef.current;
      if (p && current?.source === 'youtube' && isPlaying) {
        setPositionSec(p.getCurrentTime());
        setDurationSec(p.getDuration());
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [current, isPlaying]);

  const value = useMemo<PlayerState>(() => ({
    current, queue, isPlaying, positionSec, durationSec, play, toggle, next, prev, seek,
  }), [current, queue, isPlaying, positionSec, durationSec, play, toggle, next, prev, seek]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayer(): PlayerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlayer must be used within PlayerProvider');
  return v;
}

export function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

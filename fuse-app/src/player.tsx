import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Track } from './integrations/types';
import { createYouTubePlayer, type YouTubePlayer } from './integrations/youtube';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  current: Track | null;
  queue: Track[];
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  shuffle: boolean;
  repeat: RepeatMode;
  play: (track: Track, queue?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const Ctx = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');

  const ytRef = useRef<YouTubePlayer | null>(null);
  // Refs mirror state so the track-ended callback never sees stale values.
  const currentRef = useRef(current); currentRef.current = current;
  const queueRef = useRef(queue); queueRef.current = queue;
  const shuffleRef = useRef(shuffle); shuffleRef.current = shuffle;
  const repeatRef = useRef(repeat); repeatRef.current = repeat;
  const playRef = useRef<(t: Track, q?: Track[]) => void>(() => {});

  function pickNextIndex(q: Track[], i: number): number | null {
    if (!q.length) return null;
    if (shuffleRef.current && q.length > 1) {
      let n = i;
      while (n === i) n = Math.floor(Math.random() * q.length);
      return n;
    }
    const n = i + 1;
    if (n < q.length) return n;
    return repeatRef.current === 'all' ? 0 : null;
  }

  const handleEnded = useCallback(() => {
    const p = ytRef.current;
    if (repeatRef.current === 'one' && p) { p.seekTo(0); p.resume(); return; }
    const q = queueRef.current;
    const cur = currentRef.current;
    const i = cur ? q.findIndex((t) => t.id === cur.id) : -1;
    const ni = pickNextIndex(q, i);
    if (ni === null) { setIsPlaying(false); return; }
    playRef.current(q[ni], q);
  }, []);

  const ensureYouTube = useCallback(async (): Promise<YouTubePlayer> => {
    if (ytRef.current) return ytRef.current;
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.width = '0';
    host.style.height = '0';
    host.style.overflow = 'hidden';
    document.body.appendChild(host);
    const p = await createYouTubePlayer(host);
    p.onStateChange((playing) => setIsPlaying(playing));
    p.onEnded(handleEnded);
    ytRef.current = p;
    return p;
  }, [handleEnded]);

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
  playRef.current = play;

  const toggle = useCallback(() => {
    const p = ytRef.current;
    if (current?.source === 'youtube' && p) {
      if (isPlaying) p.pause(); else p.resume();
    }
    setIsPlaying((v) => !v);
  }, [current, isPlaying]);

  const next = useCallback(() => {
    const q = queueRef.current;
    const cur = currentRef.current;
    const i = cur ? q.findIndex((t) => t.id === cur.id) : -1;
    const ni = pickNextIndex(q, i);
    if (ni !== null) play(q[ni], q);
  }, [play]);

  const prev = useCallback(() => {
    const q = queueRef.current;
    const cur = currentRef.current;
    const i = cur ? q.findIndex((t) => t.id === cur.id) : -1;
    if (i > 0) play(q[i - 1], q);
    else if (ytRef.current) { ytRef.current.seekTo(0); }
  }, [play]);

  const seek = useCallback((sec: number) => {
    ytRef.current?.seekTo(sec);
    setPositionSec(sec);
  }, []);

  const toggleShuffle = useCallback(() => setShuffle((v) => !v), []);
  const cycleRepeat = useCallback(() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')), []);

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
    current, queue, isPlaying, positionSec, durationSec, shuffle, repeat,
    play, toggle, next, prev, seek, toggleShuffle, cycleRepeat,
  }), [current, queue, isPlaying, positionSec, durationSec, shuffle, repeat,
    play, toggle, next, prev, seek, toggleShuffle, cycleRepeat]);

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

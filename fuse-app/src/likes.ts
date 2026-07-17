// Liked-songs store: persisted to localStorage, reactive via useSyncExternalStore.
import { useSyncExternalStore } from 'react';

const KEY = 'fuse.likes';

function load(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')); }
  catch { return new Set(); }
}

let cache = load();
let version = 0;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function toggleLike(id: string): void {
  if (cache.has(id)) cache.delete(id); else cache.add(id);
  localStorage.setItem(KEY, JSON.stringify([...cache]));
  version++;
  subs.forEach((f) => f());
}

export function likedIds(): string[] {
  return [...cache];
}

/** Reactive: is this track liked? */
export function useLiked(id: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => (id ? cache.has(id) : false));
}

/** Reactive: bumps whenever likes change (for lists that derive from likes). */
export function useLikesVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

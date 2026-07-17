// Spotify integration (scaffold).
//
// Auth uses the Authorization Code + PKCE flow, which is safe for browser apps
// (no client secret). Search works on any account; in-app PLAYBACK requires a
// Spotify Premium account and the Web Playback SDK.
//
// This module is fully wired for auth + search. Playback via the Web Playback
// SDK is left as a clearly-marked next step because it needs a Premium account
// to test end-to-end.

import type { SourceAdapter, Track } from './types';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
const REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined;
const SCOPES = [
  'user-read-private',
  'streaming',
  'user-read-email',
  'playlist-read-private',
].join(' ');

const TOKEN_KEY = 'fuse.spotify.token';

function randString(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Kick off the PKCE login redirect. */
export async function beginSpotifyLogin(): Promise<void> {
  if (!CLIENT_ID || !REDIRECT_URI) {
    throw new Error('Set VITE_SPOTIFY_CLIENT_ID and VITE_SPOTIFY_REDIRECT_URI to connect Spotify.');
  }
  const verifier = randString(64);
  sessionStorage.setItem('fuse.spotify.verifier', verifier);
  const challenge = await sha256(verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

/** Call on the /callback route to exchange the code for a token. */
export async function completeSpotifyLogin(code: string): Promise<void> {
  const verifier = sessionStorage.getItem('fuse.spotify.verifier');
  if (!CLIENT_ID || !REDIRECT_URI || !verifier) throw new Error('Missing PKCE state.');
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (data.access_token) localStorage.setItem(TOKEN_KEY, data.access_token);
}

function token(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export const spotifyAdapter: SourceAdapter = {
  id: 'spotify',
  label: 'Spotify',
  isConnected: () => Boolean(token()),
  async search(query: string): Promise<Track[]> {
    const t = token();
    if (!t) return [];
    const res = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=15&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${t}` } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tracks?.items ?? []).map((it: any): Track => ({
      id: `spotify:${it.id}`,
      source: 'spotify',
      nativeId: it.uri,
      title: it.name,
      artist: (it.artists ?? []).map((a: any) => a.name).join(', '),
      durationSec: Math.round((it.duration_ms ?? 0) / 1000),
      quality: 'Spotify',
      artUrl: it.album?.images?.[0]?.url,
    }));
  },
};

// NEXT STEP (needs Premium to verify): initialize the Web Playback SDK, create a
// device, and control it via https://api.spotify.com/v1/me/player/play.
// See https://developer.spotify.com/documentation/web-playback-sdk

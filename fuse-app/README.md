# Fuse

One player for every music service — plus a real Web Audio DJ console.

Fuse unifies Spotify, YouTube, SoundCloud and Apple Music into a single library,
search and player, and flips into a dual-deck DJ mode. It's built as a **unified
remote control**: it plays *through* each service's official playback engine
rather than re-streaming audio itself (which keeps it legal and pays artists).

Built with **React + TypeScript + Vite**. Clean-Minimal light theme with a
user-selectable accent colour (Settings → Appearance).

## Quick start

```bash
cd fuse-app
npm install
npm run dev          # http://localhost:5173
```

That's it — the app runs in **demo mode** with no API keys. The demo catalog
carries real YouTube video IDs and plays audio through the YouTube IFrame API
(which needs no key). DJ mode is fully functional out of the box (synthesized
loops + your own local files).

```bash
npm run build        # typecheck + production bundle to dist/
npm run preview      # serve the built app
```

## What actually works right now

| Feature | Status |
| --- | --- |
| Onboarding, navigation, playlist detail, queue, lyrics, Now Playing (with swipe-to-dismiss) | ✅ real UI |
| Accent colour picker, persisted to `localStorage` | ✅ |
| Music playback (demo catalog) via YouTube IFrame API | ✅ no key needed |
| **DJ mode**: dual decks, per-deck play, 3-band EQ, crossfader, load your own audio file | ✅ real Web Audio API |
| Cross-service search | ⚙️ live with keys; demo-catalog search without |
| Spotify search + playback | ⚙️ scaffolded (add keys; playback needs Premium) |

## Enabling real cross-service search & Spotify

Copy `.env.example` to `.env.local` and add the keys you have:

- **`VITE_YOUTUBE_API_KEY`** — a YouTube Data API v3 key unlocks live YouTube
  search. (Playback already works without it.)
- **`VITE_SPOTIFY_CLIENT_ID`** / **`VITE_SPOTIFY_REDIRECT_URI`** — register an app
  at the Spotify dashboard, add `http://localhost:5173/callback` as a redirect
  URI. Auth uses PKCE (no client secret). Search works on any account; in-app
  playback needs a Premium account + the Web Playback SDK (marked as the next
  step in `src/integrations/spotify.ts`).

No keys are ever committed — `.env.local` is gitignored.

## Architecture

```
src/
  integrations/     # per-source adapters onto a unified Track/Playlist model
    types.ts        #   SourceAdapter contract + source metadata
    youtube.ts      #   IFrame playback (no key) + Data API search (key)
    spotify.ts      #   PKCE auth + search; Web Playback SDK = next step
  dj/DJEngine.ts    # real dual-deck Web Audio graph (EQ, crossfader, file load)
  player.tsx        # global player state + YouTube playback wiring
  theme/accent.tsx  # accent colour context, persisted
  catalog.ts        # demo tracks/playlists (real YouTube IDs)
  screens/          # Home, Search, Library, PlaylistDetail, DJ, Settings, Onboarding
  components/       # Nav, MiniPlayer, NowPlaying, Sheets (Queue/Lyrics), common
  App.tsx           # shell: tab navigation + overlays
```

Adding a new source = implement `SourceAdapter` in `src/integrations/` and register
it in `src/screens/Search.tsx`. The rest of the app is source-agnostic.

## Notes & honest limits

- Real DJ mixing (scratch, beatmatch, EQ) needs raw audio, which Spotify's and
  YouTube's SDKs don't allow — so DJ decks load **your own files** or
  DJ-licensed streaming. That split is intentional, not a limitation to fix.
- Demo YouTube video IDs can occasionally go unavailable/region-locked; swap them
  in `src/catalog.ts` or wire live search with a key.
- Lyrics are placeholder text; a real build fetches time-synced lyrics from a
  licensed provider.

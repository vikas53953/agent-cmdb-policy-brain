import { useEffect, useState } from 'react';
import './styles.css';
import { AccentProvider } from './theme/accent';
import { PlayerProvider, usePlayer } from './player';
import { completeSpotifyLogin } from './integrations/spotify';
import { Nav, type TabId } from './components/Nav';
import { MiniPlayer } from './components/MiniPlayer';
import { NowPlaying } from './components/NowPlaying';
import { QueueSheet, LyricsSheet } from './components/Sheets';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Search } from './screens/Search';
import { Library } from './screens/Library';
import { PlaylistDetail } from './screens/PlaylistDetail';
import { DJ } from './screens/DJ';
import { Settings } from './screens/Settings';
import type { Playlist } from './integrations/types';

const ONBOARDED_KEY = 'fuse.onboarded';

function Shell() {
  const [tab, setTab] = useState<TabId>('home');
  const [openedPlaylist, setOpenedPlaylist] = useState<Playlist | null>(null);
  const [npOpen, setNpOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDED_KEY) === '1');
  const [spotifyConnecting] = useState(() => window.location.pathname === '/callback');
  const { current } = usePlayer();

  function openPlaylist(p: Playlist) { setOpenedPlaylist(p); }
  function goTab(t: TabId) { setOpenedPlaylist(null); setTab(t); }
  function finishOnboarding() { localStorage.setItem(ONBOARDED_KEY, '1'); setOnboarded(true); }

  // Spotify OAuth redirect handler.
  useEffect(() => {
    if (window.location.pathname !== '/callback') return;
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) { window.location.replace('/'); return; }
    completeSpotifyLogin(code).catch(() => {}).finally(() => window.location.replace('/'));
  }, []);

  if (spotifyConnecting) {
    return (
      <div className="app">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 24 }}>
          <div className="onb-logo" style={{ margin: '0 auto 16px' }}>🎧</div>
          <div className="h-lg">Connecting Spotify…</div>
          <div className="h-sm" style={{ marginTop: 6 }}>One sec — bringing you back.</div>
        </div>
      </div>
    );
  }

  // The playlist page renders in place of the tab content, but the player + nav stay put.
  const screenKey = openedPlaylist ? `pl-${openedPlaylist.id}` : tab;

  return (
    <div className="app">
      <div className="screens">
        <div className="screen enter" key={screenKey}>
          {openedPlaylist ? (
            <PlaylistDetail playlist={openedPlaylist} onBack={() => setOpenedPlaylist(null)} />
          ) : (
            <>
              {tab === 'home' && <Home onOpenPlaylist={openPlaylist} onOpenProfile={() => goTab('you')} />}
              {tab === 'search' && <Search />}
              {tab === 'library' && <Library onOpenPlaylist={openPlaylist} />}
              {tab === 'dj' && <DJ />}
              {tab === 'you' && <Settings onReplayOnboarding={() => setOnboarded(false)} />}
            </>
          )}
        </div>
      </div>

      {current && <MiniPlayer onOpen={() => setNpOpen(true)} />}
      <Nav tab={tab} onChange={goTab} />

      <NowPlaying open={npOpen} onClose={() => setNpOpen(false)}
        onQueue={() => setQueueOpen(true)} onLyrics={() => setLyricsOpen(true)} />
      <QueueSheet open={queueOpen} onClose={() => setQueueOpen(false)} />
      <LyricsSheet open={lyricsOpen} onClose={() => setLyricsOpen(false)} />

      {!onboarded && <Onboarding onDone={finishOnboarding} />}
    </div>
  );
}

export default function App() {
  return (
    <AccentProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </AccentProvider>
  );
}

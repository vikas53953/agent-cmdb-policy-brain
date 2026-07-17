import { useState } from 'react';
import './styles.css';
import { AccentProvider } from './theme/accent';
import { PlayerProvider } from './player';
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
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [npOpen, setNpOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDED_KEY) === '1');

  function openPlaylist(p: Playlist) { setPlaylist(p); setDetailOpen(true); }
  function finishOnboarding() { localStorage.setItem(ONBOARDED_KEY, '1'); setOnboarded(true); }

  return (
    <div className="app">
      <div className="screens">
        <div className="screen enter" key={tab}>
          {tab === 'home' && <Home onOpenPlaylist={openPlaylist} />}
          {tab === 'search' && <Search />}
          {tab === 'library' && <Library onOpenPlaylist={openPlaylist} />}
          {tab === 'dj' && <DJ />}
          {tab === 'you' && <Settings onReplayOnboarding={() => setOnboarded(false)} />}
        </div>
      </div>

      <MiniPlayer onOpen={() => setNpOpen(true)} />
      <Nav tab={tab} onChange={setTab} />

      <PlaylistDetail playlist={playlist} open={detailOpen} onClose={() => setDetailOpen(false)} />
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

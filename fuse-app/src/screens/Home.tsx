import { useState } from 'react';
import { PLAYLISTS, TRACKS, playlistArt } from '../catalog';
import { usePlayer } from '../player';
import { TrackRow, Art } from '../components/common';
import type { Playlist } from '../integrations/types';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Home({ onOpenPlaylist, onOpenProfile }: {
  onOpenPlaylist: (p: Playlist) => void; onOpenProfile: () => void;
}) {
  const { play, current } = usePlayer();
  const [filter, setFilter] = useState('All');
  const visible = filter === 'All' ? TRACKS : TRACKS.filter((t) => t.source === filter.toLowerCase());
  const quick = visible.slice(0, 4);
  const recommended = visible.slice(4); // disjoint from the quick grid — no duplicates

  return (
    <>
      <div className="row-head">
        <div><div className="h-sm">{greeting()}</div><div className="h-lg" style={{ fontSize: 21 }}>Vikas</div></div>
        <button className="avatar-btn" aria-label="Open profile" onClick={onOpenProfile}>
          <span className="avatar" style={{ width: 36, height: 36, display: 'block' }} />
        </button>
      </div>
      <div className="pills">
        {['All', 'Spotify', 'YouTube'].map((f) => (
          <button key={f} className={`pl${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {quick.length > 0 && (
        <div className="quick-grid">
          {quick.map((t) => (
            <button className={`quick${current?.id === t.id ? ' active' : ''}`} key={t.id} onClick={() => play(t, visible)}>
              <Art src={t.artUrl} className="qart" />
              <span className="qt">{t.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="sec">Jump back in</div>
      <div className="hscroll">
        {PLAYLISTS.map((p) => (
          <button className="hc" key={p.id} onClick={() => onOpenPlaylist(p)}>
            <Art src={playlistArt(p)} className="hc-art" />
            <span className="t">{p.title}</span>
            <span className="s">{p.subtitle.split('·').pop()?.trim()}</span>
          </button>
        ))}
      </div>

      <div className="sec">{filter === 'All' ? 'Made for you' : `Made for you · ${filter}`}</div>
      {recommended.map((t) => (
        <TrackRow key={t.id} track={t} onPlay={(tt) => play(tt, visible)} active={current?.id === t.id} />
      ))}
      {!visible.length && (
        <div className="empty-note">
          Nothing from {filter} here yet. Connect {filter} in the You tab, then search — results will play from {filter} too.
        </div>
      )}
    </>
  );
}

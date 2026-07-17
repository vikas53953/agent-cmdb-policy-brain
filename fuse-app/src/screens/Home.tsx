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

export function Home({ onOpenPlaylist }: { onOpenPlaylist: (p: Playlist) => void }) {
  const { play, current } = usePlayer();
  const [filter, setFilter] = useState('All');
  const recommended = TRACKS.slice(1, 6);
  const quick = TRACKS.slice(0, 4);

  return (
    <>
      <div className="row-head">
        <div><div className="h-sm">{greeting()}</div><div className="h-lg" style={{ fontSize: 21 }}>Vikas</div></div>
        <div className="avatar" style={{ width: 36, height: 36 }} />
      </div>
      <div className="pills">
        {['All', 'Spotify', 'YouTube'].map((f) => (
          <button key={f} className={`pl${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      <div className="quick-grid">
        {quick.map((t) => (
          <button className={`quick${current?.id === t.id ? ' active' : ''}`} key={t.id} onClick={() => play(t, quick)}>
            <Art src={t.artUrl} className="qart" />
            <span className="qt">{t.title}</span>
          </button>
        ))}
      </div>

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

      <div className="sec">Made for you</div>
      {recommended.map((t) => (
        <TrackRow key={t.id} track={t} onPlay={(tt) => play(tt, recommended)} active={current?.id === t.id} />
      ))}
    </>
  );
}

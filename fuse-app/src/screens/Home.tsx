import { useState } from 'react';
import { PLAYLISTS, TRACKS, trackById } from '../catalog';
import { usePlayer } from '../player';
import { TrackRow } from '../components/common';
import type { Playlist } from '../integrations/types';

export function Home({ onOpenPlaylist }: { onOpenPlaylist: (p: Playlist) => void }) {
  const { play } = usePlayer();
  const [filter] = useState('All');
  const recommended = TRACKS.slice(1, 5);

  return (
    <>
      <div className="row-head">
        <div><div className="h-sm">Good evening</div><div className="h-lg" style={{ fontSize: 19 }}>Vikas</div></div>
        <div className="avatar" style={{ width: 34, height: 34 }} />
      </div>
      <div className="pills">
        {['All', 'Spotify', 'YouTube'].map((f) => (
          <button key={f} className={`pl${filter === f ? ' on' : ''}`}>{f}</button>
        ))}
      </div>

      <div className="sec">Jump back in</div>
      <div className="hscroll">
        {PLAYLISTS.map((p) => (
          <button className="hc" key={p.id} onClick={() => onOpenPlaylist(p)}>
            <span className="art th a" style={{ width: 116, height: 116 }} />
            <span className="t">{p.title}</span>
            <span className="s">{p.subtitle.split('·').pop()?.trim()}</span>
          </button>
        ))}
      </div>

      <div className="sec">Made for you · across sources</div>
      {recommended.map((id) => {
        const t = trackById(id.id) ?? id;
        return <TrackRow key={t.id} track={t} onPlay={(tt) => play(tt, recommended)} />;
      })}
    </>
  );
}

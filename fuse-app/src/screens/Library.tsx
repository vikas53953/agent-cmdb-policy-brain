import { LIKED, PLAYLISTS } from '../catalog';
import { SourceBadge } from '../components/common';
import type { Playlist } from '../integrations/types';

export function Library({ onOpenPlaylist }: { onOpenPlaylist: (p: Playlist) => void }) {
  const all = [LIKED, ...PLAYLISTS];
  return (
    <>
      <div className="row-head"><div className="h-lg">Your Library</div><span style={{ fontSize: 20, color: 'var(--muted)' }}>＋</span></div>
      <div className="pills">
        {['Playlists', 'Artists', 'Albums'].map((f, i) => (
          <button key={f} className={`pl${i === 0 ? ' on' : ''}`}>{f}</button>
        ))}
      </div>
      {all.map((p) => (
        <button className="row" key={p.id} onClick={() => onOpenPlaylist(p)}>
          <span className="th a" />
          <span className="rc">
            <span className="t">{p.title}</span>
            <span className="s">
              {p.sources.map((s) => <SourceBadge key={s} source={s} short />)}
              {p.subtitle}
            </span>
          </span>
          <span className="dur">{p.trackIds.length}</span>
        </button>
      ))}
    </>
  );
}

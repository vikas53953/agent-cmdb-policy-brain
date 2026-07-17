import { useMemo, useState } from 'react';
import { LIKED, PLAYLISTS, TRACKS, playlistArt } from '../catalog';
import { SourceBadge, Art } from '../components/common';
import { usePlayer } from '../player';
import type { Playlist } from '../integrations/types';

type Filter = 'Playlists' | 'Artists' | 'Albums';

export function Library({ onOpenPlaylist }: { onOpenPlaylist: (p: Playlist) => void }) {
  const { play } = usePlayer();
  const [filter, setFilter] = useState<Filter>('Playlists');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);

  const artists = useMemo(() => {
    const map = new Map<string, number>();
    TRACKS.forEach((t) => map.set(t.artist, (map.get(t.artist) ?? 0) + 1));
    return [...map.entries()].map(([artist, count]) => ({ artist, count }));
  }, []);

  function create() {
    const title = name.trim();
    if (!title) return;
    setUserPlaylists((p) => [{ id: `user-${p.length}`, title, subtitle: 'Your playlist · 0 songs', sources: [], trackIds: [] }, ...p]);
    setName(''); setCreating(false);
  }

  return (
    <>
      <div className="row-head">
        <div className="h-lg">Your Library</div>
        <button className="round-btn" aria-label="New playlist" onClick={() => setCreating((v) => !v)}>＋</button>
      </div>

      {creating && (
        <div className="create-box">
          <input autoFocus value={name} placeholder="Playlist name…" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
          <button className="btn-primary sm" onClick={create}>Create</button>
        </div>
      )}

      <div className="pills">
        {(['Playlists', 'Artists', 'Albums'] as Filter[]).map((f) => (
          <button key={f} className={`pl${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {filter === 'Playlists' && [LIKED, ...userPlaylists, ...PLAYLISTS].map((p) => (
        <button className="row" key={p.id} onClick={() => onOpenPlaylist(p)}>
          <Art src={playlistArt(p)} className="th" />
          <span className="rc">
            <span className="t">{p.title}</span>
            <span className="s">{p.sources.map((s) => <SourceBadge key={s} source={s} />)}{p.subtitle}</span>
          </span>
          <span className="dur">›</span>
        </button>
      ))}

      {filter === 'Artists' && artists.map((a) => (
        <button className="row" key={a.artist} onClick={() => play(TRACKS.find((t) => t.artist === a.artist)!, TRACKS)}>
          <Art src={TRACKS.find((t) => t.artist === a.artist)?.artUrl} className="th round" />
          <span className="rc"><span className="t">{a.artist}</span><span className="s">Artist · {a.count} songs</span></span>
          <span className="dur">▶</span>
        </button>
      ))}

      {filter === 'Albums' && (
        <div className="album-grid">
          {PLAYLISTS.map((p) => (
            <button className="album-card" key={p.id} onClick={() => onOpenPlaylist(p)}>
              <Art src={playlistArt(p)} className="alb-art" />
              <span className="t">{p.title}</span>
              <span className="s">{p.subtitle.split('·').pop()?.trim()}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

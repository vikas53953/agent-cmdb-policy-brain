import { trackById } from '../catalog';
import { usePlayer } from '../player';
import { TrackRow } from '../components/common';
import type { Playlist } from '../integrations/types';

export function PlaylistDetail({ playlist, open, onClose }: {
  playlist: Playlist | null; open: boolean; onClose: () => void;
}) {
  const { play } = usePlayer();
  const tracks = playlist ? playlist.trackIds.map((id) => trackById(id)).filter(Boolean) : [];
  const list = tracks as NonNullable<(typeof tracks)[number]>[];

  return (
    <div className={`panel detail${open ? ' open' : ''}`}>
      <div className="p-head"><button className="back" onClick={onClose}>‹</button><span className="ttl">Playlist</span></div>
      <div className="d-hero">
        <div className="cover" />
        <div>
          <div className="h-sm">{playlist?.subtitle ?? ''}</div>
          <div className="t">{playlist?.title ?? ''}</div>
          <div className="h-sm">{list.length} songs</div>
        </div>
      </div>
      <div className="d-actions">
        <button className="btn-primary" onClick={() => list[0] && play(list[0], list)}>▶ Play all</button>
        <button className="icon-btn" aria-label="Shuffle">⤮</button>
        <button className="icon-btn" aria-label="Download">⤓</button>
      </div>
      <div className="d-list">
        {list.map((t) => <TrackRow key={t.id} track={t} onPlay={(tt) => play(tt, list)} />)}
      </div>
    </div>
  );
}

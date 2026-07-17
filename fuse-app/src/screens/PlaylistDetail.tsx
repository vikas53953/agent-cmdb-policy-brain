import { trackById, playlistArt } from '../catalog';
import { usePlayer } from '../player';
import { TrackRow, Art } from '../components/common';
import type { Playlist } from '../integrations/types';

export function PlaylistDetail({ playlist, onBack }: { playlist: Playlist; onBack: () => void }) {
  const { play, current } = usePlayer();
  const list = playlist.trackIds.map((id) => trackById(id)).filter(Boolean) as NonNullable<ReturnType<typeof trackById>>[];

  return (
    <>
      <div className="sub-head">
        <button className="back" aria-label="Back" onClick={onBack}>‹</button>
        <span className="sub-ttl">Playlist</span>
      </div>
      <div className="d-hero">
        <Art src={playlistArt(playlist)} className="cover" />
        <div>
          <div className="h-sm">{playlist.subtitle}</div>
          <div className="d-title">{playlist.title}</div>
          <div className="h-sm">{list.length} songs</div>
        </div>
      </div>
      <div className="d-actions">
        <button className="btn-primary" onClick={() => list[0] && play(list[0], list)}>▶ Play all</button>
        <button className="icon-btn" aria-label="Shuffle">⤮</button>
        <button className="icon-btn" aria-label="Download">⤓</button>
      </div>
      <div className="d-list">
        {list.map((t) => (
          <TrackRow key={t.id} track={t} onPlay={(tt) => play(tt, list)} active={current?.id === t.id} />
        ))}
      </div>
    </>
  );
}

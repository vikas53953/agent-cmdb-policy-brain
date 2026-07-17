import { usePlayer } from '../player';
import { Art } from './common';

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { current, isPlaying, toggle, positionSec, durationSec } = usePlayer();
  if (!current) return null;
  const dur = durationSec || current.durationSec || 0;
  const pct = dur ? Math.min(100, (positionSec / dur) * 100) : 0;
  return (
    <div className="mini" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="mini-prog"><i style={{ width: `${pct}%` }} /></div>
      <Art src={current.artUrl} className="th" />
      <span className="rc">
        <span className="t">{current.title}</span>
        <span className="s">{current.artist}</span>
      </span>
      <button className="miniplay" aria-label={isPlaying ? 'Pause' : 'Play'}
        onClick={(e) => { e.stopPropagation(); toggle(); }}>
        {isPlaying ? '❚❚' : '▶'}
      </button>
    </div>
  );
}

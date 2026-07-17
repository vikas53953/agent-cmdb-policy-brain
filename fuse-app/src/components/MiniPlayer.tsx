import { usePlayer } from '../player';

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { current, isPlaying, toggle } = usePlayer();
  if (!current) return null;
  return (
    <div className="mini" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <span className="th a" />
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

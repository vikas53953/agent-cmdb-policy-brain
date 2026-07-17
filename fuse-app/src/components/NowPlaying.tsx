import { useRef, useState } from 'react';
import { usePlayer, fmtTime } from '../player';
import { SourceBadge, Art } from './common';

export function NowPlaying({ open, onClose, onQueue, onLyrics }: {
  open: boolean; onClose: () => void; onQueue: () => void; onLyrics: () => void;
}) {
  const { current, isPlaying, toggle, next, prev, positionSec, durationSec, seek } = usePlayer();
  const drag = useRef({ active: false, startY: 0, dy: 0 });
  const [dragY, setDragY] = useState(0);

  const dur = durationSec || current?.durationSec || 0;
  const pct = dur ? Math.min(100, (positionSec / dur) * 100) : 0;

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { active: true, startY: e.clientY, dy: 0 };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.active) return;
    const dy = Math.max(0, e.clientY - drag.current.startY);
    drag.current.dy = dy;
    setDragY(dy);
  }
  function onPointerUp() {
    if (!drag.current.active) return;
    const dy = drag.current.dy;
    drag.current.active = false;
    setDragY(0);
    if (dy > 110) onClose();
  }

  function onSeek(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - r.left) / r.width;
    if (dur) seek(ratio * dur);
  }

  return (
    <div className={`panel np${open ? ' open' : ''}`}
      style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}>
      {current?.artUrl && (
        <div className="np-bg" style={{ backgroundImage: `url(${current.artUrl})` }} />
      )}
      <div className="np-inner">
        <div className="np-grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="np-handle" />
        </div>
        <div className="np-top">
          <button aria-label="Close" onClick={onClose}>⌄</button>
          <span className="ctx">Now playing</span>
          <span>⋯</span>
        </div>
        <Art src={current?.artUrl} className="np-art" />
        <div className="np-meta">
          <div>
            <div className="t">{current?.title ?? '—'}</div>
            <div className="s">{current?.artist ?? ''}</div>
          </div>
          <div style={{ fontSize: 18, opacity: .7 }}>♡</div>
        </div>
        <div style={{ marginTop: 10 }}>{current && <SourceBadge source={current.source} />}</div>
        <div className="prog" onClick={onSeek}>
          <i style={{ width: `${pct}%` }} />
          <b style={{ left: `${pct}%` }} />
        </div>
        <div className="times"><span>{fmtTime(positionSec)}</span><span>{fmtTime(dur)}</span></div>
        <div className="np-ctrl">
          <button className="c" aria-label="Shuffle">⤮</button>
          <button className="c" aria-label="Previous" onClick={prev}>⏮</button>
          <button className="btn-play" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={toggle}>{isPlaying ? '❚❚' : '▶'}</button>
          <button className="c" aria-label="Next" onClick={next}>⏭</button>
          <button className="c" aria-label="Repeat">↻</button>
        </div>
        <div className="np-foot">
          <button onClick={onLyrics}>Lyrics</button>
          <span>◍ This device</span>
          <button onClick={onQueue}>Queue ≡</button>
        </div>
      </div>
    </div>
  );
}

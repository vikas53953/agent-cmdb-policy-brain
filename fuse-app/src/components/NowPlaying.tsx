import { useRef, useState } from 'react';
import { usePlayer, fmtTime } from '../player';
import { SourceBadge, Art } from './common';
import { useLiked, toggleLike } from '../likes';

export function NowPlaying({ open, onClose, onQueue, onLyrics }: {
  open: boolean; onClose: () => void; onQueue: () => void; onLyrics: () => void;
}) {
  const { current, isPlaying, toggle, next, prev, positionSec, durationSec, seek,
    shuffle, repeat, toggleShuffle, cycleRepeat } = usePlayer();
  const liked = useLiked(current?.id);
  const drag = useRef({ active: false, startY: 0, dy: 0 });
  const [dragY, setDragY] = useState(0);
  const [menu, setMenu] = useState<null | 'more' | 'device'>(null);
  const [copied, setCopied] = useState(false);

  const dur = durationSec || current?.durationSec || 0;
  const pct = dur ? Math.min(100, (positionSec / dur) * 100) : 0;
  const ytUrl = current?.source === 'youtube' ? `https://www.youtube.com/watch?v=${current.nativeId}` : undefined;

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

  async function share() {
    if (!current) return;
    const text = `${current.title} — ${current.artist}`;
    try {
      if (navigator.share && ytUrl) { await navigator.share({ title: text, url: ytUrl }); setMenu(null); return; }
      await navigator.clipboard.writeText(ytUrl ? `${text} ${ytUrl}` : text);
      setCopied(true);
      setTimeout(() => { setCopied(false); setMenu(null); }, 900);
    } catch { setMenu(null); }
  }

  return (
    <div className={`panel np${open ? ' open' : ''}`}
      style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}>
      {current?.artUrl && (
        <div className="np-bg" style={{ backgroundImage: `url(${current.artUrl})` }} />
      )}
      <div className="np-inner" onClick={() => menu && setMenu(null)}>
        <div className="np-grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="np-handle" />
        </div>
        <div className="np-top">
          <button aria-label="Close" onClick={onClose}>⌄</button>
          <span className="ctx">Now playing</span>
          <button aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'more' ? null : 'more'); }}>⋯</button>
        </div>

        {menu === 'more' && (
          <div className="np-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={share}>{copied ? 'Copied ✓' : 'Share'}</button>
            {ytUrl && <button onClick={() => { window.open(ytUrl, '_blank'); setMenu(null); }}>Open on YouTube</button>}
            <button onClick={() => { if (current) toggleLike(current.id); setMenu(null); }}>
              {liked ? 'Remove from Liked' : 'Add to Liked Songs'}
            </button>
          </div>
        )}

        <Art src={current?.artUrl} className="np-art" />
        <div className="np-meta">
          <div>
            <div className="t">{current?.title ?? '—'}</div>
            <div className="s">{current?.artist ?? ''}</div>
          </div>
          <button className={`like-btn${liked ? ' on' : ''}`} aria-label={liked ? 'Unlike' : 'Like'}
            onClick={() => current && toggleLike(current.id)}>
            {liked ? '♥' : '♡'}
          </button>
        </div>
        <div style={{ marginTop: 10 }}>{current && <SourceBadge source={current.source} />}</div>
        <div className="prog" onClick={onSeek}>
          <i style={{ width: `${pct}%` }} />
          <b style={{ left: `${pct}%` }} />
        </div>
        <div className="times"><span>{fmtTime(positionSec)}</span><span>{fmtTime(dur)}</span></div>
        <div className="np-ctrl">
          <button className={`c${shuffle ? ' on' : ''}`} aria-label="Shuffle" onClick={toggleShuffle}>⤮</button>
          <button className="c" aria-label="Previous" onClick={prev}>⏮</button>
          <button className="btn-play" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={toggle}>{isPlaying ? '❚❚' : '▶'}</button>
          <button className="c" aria-label="Next" onClick={next}>⏭</button>
          <button className={`c${repeat !== 'off' ? ' on' : ''}`} aria-label="Repeat" onClick={cycleRepeat}>
            ↻{repeat === 'one' && <sup className="rep1">1</sup>}
          </button>
        </div>
        <div className="np-foot">
          <button onClick={onLyrics}>Lyrics</button>
          <button onClick={(e) => { e.stopPropagation(); setMenu(menu === 'device' ? null : 'device'); }}>◍ This device</button>
          <button onClick={onQueue}>Queue ≡</button>
        </div>
        {menu === 'device' && (
          <div className="np-menu bottom" onClick={(e) => e.stopPropagation()}>
            <div className="menu-title">Playing on</div>
            <button onClick={() => setMenu(null)}>✓ This device</button>
            <div className="menu-hint">Cast &amp; speakers: use your phone's own output controls.</div>
          </div>
        )}
      </div>
    </div>
  );
}

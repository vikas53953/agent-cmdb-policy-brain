import { usePlayer } from '../player';
import { SourceBadge } from './common';

export function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { current, queue } = usePlayer();
  const idx = current ? queue.findIndex((t) => t.id === current.id) : -1;
  const upNext = idx >= 0 ? queue.slice(idx + 1) : queue;
  return (
    <div className={`panel sheet${open ? ' open' : ''}`}>
      <div className="p-head"><button className="back" onClick={onClose}>⌄</button><span className="ttl">Queue</span></div>
      {current && (
        <>
          <div className="h-sm" style={{ padding: '2px 18px 8px' }}>Now playing</div>
          <div className="q-now">
            <span className="th a" />
            <span className="rc"><span className="t">{current.title}</span>
              <span className="s"><SourceBadge source={current.source} />{current.artist}</span></span>
            <span className="dur">▮▮▮</span>
          </div>
        </>
      )}
      <div className="h-sm" style={{ padding: '12px 18px 2px' }}>Next up</div>
      <div className="q-list">
        {upNext.length === 0 && <div className="h-sm" style={{ padding: '0 0 8px' }}>Nothing queued.</div>}
        {upNext.map((t) => (
          <div className="q-item" key={t.id}>
            <span className="grip">⠿</span>
            <span className="th" />
            <span className="rc"><span className="t">{t.title}</span>
              <span className="s"><SourceBadge source={t.source} short />{t.artist}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Placeholder lyric lines (never copyrighted text). A real build would fetch
// time-synced lyrics from a licensed provider (e.g. Musixmatch) per track.
const PLACEHOLDER_LINES = [
  '♪ Instrumental intro ♪',
  'Synced lyrics appear here once a',
  'licensed lyrics provider is connected.',
  'Each line highlights in time with the beat —',
  'this is where the current line would glow.',
  'Tap a line to jump the track to it.',
  '♪ … ♪',
];

export function LyricsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { current } = usePlayer();
  return (
    <div className={`panel sheet${open ? ' open' : ''}`}>
      <div className="p-head"><button className="back" onClick={onClose}>⌄</button>
        <span className="ttl">Lyrics{current ? ` · ${current.title}` : ''}</span></div>
      <div className="lyr">
        {PLACEHOLDER_LINES.map((line, i) => (
          <p key={i} className={i === 3 ? 'now' : ''}>{line}</p>
        ))}
      </div>
    </div>
  );
}

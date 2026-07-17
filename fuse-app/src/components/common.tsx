import type { Track, SourceId } from '../integrations/types';
import { SOURCE_META } from '../integrations/types';
import { fmtTime } from '../player';

export function SourceBadge({ source, short }: { source: SourceId; short?: boolean }) {
  const m = SOURCE_META[source];
  const isAccentLike = source === 'spotify';
  return (
    <span className={`tag${isAccentLike ? '' : ' g'}`} style={{ color: m.color, background: `${m.color}22` }}>
      {short ? m.short : m.label}
    </span>
  );
}

export function TrackRow({ track, onPlay }: { track: Track; onPlay: (t: Track) => void }) {
  return (
    <button className="row" onClick={() => onPlay(track)}>
      <span className="th a" />
      <span className="rc">
        <span className="t">{track.title}</span>
        <span className="s"><SourceBadge source={track.source} />{track.artist}</span>
      </span>
      <span className="dur">{track.durationSec ? fmtTime(track.durationSec) : '▶'}</span>
    </button>
  );
}

import type { Track, SourceId } from '../integrations/types';
import { SOURCE_META } from '../integrations/types';
import { BrandLogo } from './logos';
import { fmtTime } from '../player';

export function SourceBadge({ source }: { source: SourceId }) {
  const m = SOURCE_META[source];
  return (
    <span className="src-chip">
      <BrandLogo source={source} size={13} />
      <span>{m.label.split(' ')[0]}</span>
    </span>
  );
}

export function TrackRow({ track, onPlay, active }: { track: Track; onPlay: (t: Track) => void; active?: boolean }) {
  return (
    <button className={`row${active ? ' active' : ''}`} onClick={() => onPlay(track)}>
      <span className="th art" />
      <span className="rc">
        <span className="t">{track.title}</span>
        <span className="s"><SourceBadge source={track.source} />{track.artist}</span>
      </span>
      {active ? <span className="eq-mini"><i /><i /><i /></span>
        : <span className="dur">{track.durationSec ? fmtTime(track.durationSec) : '▶'}</span>}
    </button>
  );
}

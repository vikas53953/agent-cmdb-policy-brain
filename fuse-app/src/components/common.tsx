import { useState } from 'react';
import type { Track, SourceId } from '../integrations/types';
import { SOURCE_META } from '../integrations/types';
import { BrandLogo } from './logos';
import { fmtTime } from '../player';

/** Cover art image that falls back to a gradient tile if the image can't load. */
export function Art({ src, className = '' }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={`art-ph ${className}`} />;
  return (
    <img className={`art-img ${className}`} src={src} alt="" loading="lazy"
      draggable={false} onError={() => setFailed(true)} />
  );
}

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
      <Art src={track.artUrl} className="th" />
      <span className="rc">
        <span className="t">{track.title}</span>
        <span className="s"><SourceBadge source={track.source} />{track.artist}</span>
      </span>
      {active ? <span className="eq-mini"><i /><i /><i /></span>
        : <span className="dur">{track.durationSec ? fmtTime(track.durationSec) : '▶'}</span>}
    </button>
  );
}

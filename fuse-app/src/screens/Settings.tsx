import { useState } from 'react';
import { ACCENTS, useAccent } from '../theme/accent';
import { SOURCE_META, type SourceId } from '../integrations/types';
import { BrandLogo } from '../components/logos';
import { youtubeAdapter } from '../integrations/youtube';
import { spotifyAdapter, beginSpotifyLogin } from '../integrations/spotify';

type Page = null | 'appearance' | 'quality' | 'source' | 'crossfade';

const QUALITY = ['Low', 'Normal', 'High', 'Very high'];
const SOURCE = ['Best available', 'Prefer Spotify', 'Prefer YouTube'];
const CROSSFADE = ['Off', '3s', '6s', '9s', '12s'];

function Picker({ title, options, value, onPick, onBack }: {
  title: string; options: string[]; value: string; onPick: (v: string) => void; onBack: () => void;
}) {
  return (
    <>
      <div className="sub-head"><button className="back" onClick={onBack}>‹</button><span className="sub-ttl">{title}</span></div>
      <div className="pick-list">
        {options.map((o) => (
          <button key={o} className="pick-row" onClick={() => { onPick(o); onBack(); }}>
            <span>{o}</span>{value === o && <span className="check">✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}

export function Settings({ onReplayOnboarding }: { onReplayOnboarding: () => void }) {
  const { accent, setAccent } = useAccent();
  const [page, setPage] = useState<Page>(null);
  const [quality, setQuality] = useState('Very high');
  const [source, setSource] = useState('Best available');
  const [crossfade, setCrossfade] = useState('6s');
  const sp = spotifyAdapter.isConnected();
  const yt = youtubeAdapter.isConnected();

  if (page === 'appearance') {
    return (
      <>
        <div className="sub-head"><button className="back" onClick={() => setPage(null)}>‹</button><span className="sub-ttl">Appearance</span></div>
        <div className="sec">Accent colour</div>
        <div className="h-sm">Fuse uses this one colour everywhere.</div>
        <div className="accent-grid">
          {ACCENTS.map((a) => (
            <button key={a.value} className={`accent-tile${accent === a.value ? ' on' : ''}`} onClick={() => setAccent(a.value)}>
              <span className="swatch" style={{ background: a.value }} />
              <span className="nm">{a.name}</span>
              {accent === a.value && <span className="tick">✓</span>}
            </button>
          ))}
        </div>
      </>
    );
  }
  if (page === 'quality') return <Picker title="Audio quality" options={QUALITY} value={quality} onPick={setQuality} onBack={() => setPage(null)} />;
  if (page === 'source') return <Picker title="Default source" options={SOURCE} value={source} onPick={setSource} onBack={() => setPage(null)} />;
  if (page === 'crossfade') return <Picker title="Crossfade" options={CROSSFADE} value={crossfade} onPick={setCrossfade} onBack={() => setPage(null)} />;

  return (
    <>
      <div className="prof">
        <div className="avatar" />
        <div style={{ fontSize: 19, fontWeight: 800 }}>Vikas</div>
        <div className="h-sm">{[yt && 'YouTube', sp && 'Spotify'].filter(Boolean).join(' · ') || 'Demo mode'}</div>
      </div>

      <div className="sec">Connected services</div>
      <div className="svc-grid">
        {(['spotify', 'youtube', 'soundcloud', 'apple'] as SourceId[]).map((s) => {
          const on = (s === 'spotify' && sp) || (s === 'youtube' && yt);
          return (
            <div className={`svc-card${on ? ' on' : ''}`} key={s}>
              <BrandLogo source={s} size={30} />
              <span className="svc-name">{SOURCE_META[s].label.split(' ')[0]}</span>
              <span className="svc-state">{on ? 'Connected' : 'Add'}</span>
            </div>
          );
        })}
      </div>
      {!sp && (
        <button className="btn-outline" onClick={() => beginSpotifyLogin().catch((e) => alert(e.message))}>
          <BrandLogo source="spotify" size={18} /> Connect Spotify
        </button>
      )}

      <div className="sec">Settings</div>
      <div className="set-group">
        <button className="set-row" onClick={() => setPage('appearance')}>
          <span className="set-l"><span className="dot" style={{ background: accent }} />Appearance</span>
          <span className="v">Accent ›</span>
        </button>
        <button className="set-row" onClick={() => setPage('quality')}><span className="set-l">Audio quality</span><span className="v">{quality} ›</span></button>
        <button className="set-row" onClick={() => setPage('source')}><span className="set-l">Default source</span><span className="v">{source} ›</span></button>
        <button className="set-row" onClick={() => setPage('crossfade')}><span className="set-l">Crossfade</span><span className="v">{crossfade} ›</span></button>
        <button className="set-row" onClick={onReplayOnboarding}><span className="set-l">Replay onboarding</span><span className="v">›</span></button>
      </div>
    </>
  );
}

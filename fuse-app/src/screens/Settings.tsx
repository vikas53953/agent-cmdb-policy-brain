import { ACCENTS, useAccent } from '../theme/accent';
import { SOURCE_META } from '../integrations/types';
import { youtubeAdapter } from '../integrations/youtube';
import { spotifyAdapter, beginSpotifyLogin } from '../integrations/spotify';

export function Settings({ onReplayOnboarding }: { onReplayOnboarding: () => void }) {
  const { accent, setAccent } = useAccent();
  const yt = youtubeAdapter.isConnected();
  const sp = spotifyAdapter.isConnected();

  return (
    <>
      <div className="prof">
        <div className="avatar" />
        <div style={{ fontSize: 18, fontWeight: 700 }}>Vikas</div>
        <div className="h-sm">{[yt && 'YouTube', sp && 'Spotify'].filter(Boolean).join(' · ') || 'Demo mode'}</div>
      </div>

      <div className="sec">Connected services</div>
      <div className="svc">
        {(['spotify', 'youtube', 'soundcloud', 'apple'] as const).map((s) => (
          <div key={s}><b style={{ background: SOURCE_META[s].color }} />{SOURCE_META[s].label.split(' ')[0]}</div>
        ))}
      </div>
      {!sp && (
        <button className="loadbtn" style={{ textAlign: 'left' }}
          onClick={() => beginSpotifyLogin().catch((e) => alert(e.message))}>
          + Connect Spotify (needs API keys)
        </button>
      )}

      <div className="sec">Appearance · Accent</div>
      <div className="h-sm">Pick the one colour Fuse uses everywhere.</div>
      <div className="accent-pick">
        {ACCENTS.map((a) => (
          <button key={a.value} className={`ac${accent === a.value ? ' on' : ''}`}
            style={{ background: a.value }} aria-label={a.name} onClick={() => setAccent(a.value)} />
        ))}
      </div>

      <div className="sec">Playback</div>
      <div className="set-row"><span>Audio quality</span><span className="v">Very high ›</span></div>
      <div className="divide" />
      <div className="set-row"><span>Default source</span><span className="v">Best available ›</span></div>
      <div className="divide" />
      <div className="set-row"><span>Crossfade</span><span className="v">6s ›</span></div>
      <div className="divide" />
      <div className="set-row" onClick={onReplayOnboarding}><span>Replay onboarding</span><span className="v">›</span></div>
    </>
  );
}

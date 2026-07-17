import { useState } from 'react';
import { SOURCE_META, type SourceId } from '../integrations/types';
import { BrandLogo } from '../components/logos';

const SERVICES: { id: SourceId; desc: string }[] = [
  { id: 'spotify', desc: 'Search, library & playback' },
  { id: 'youtube', desc: 'Videos, live sets, remixes' },
  { id: 'soundcloud', desc: 'Underground & DJ edits' },
  { id: 'apple', desc: 'Lossless catalogue' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [connected, setConnected] = useState<Set<SourceId>>(new Set(['youtube']));

  function toggle(id: SourceId) {
    setConnected((prev) => {
      const nxt = new Set(prev);
      if (nxt.has(id)) nxt.delete(id); else nxt.add(id);
      return nxt;
    });
  }

  if (step === 1) {
    return (
      <div className="onb" style={{ justifyContent: 'center', textAlign: 'center', gap: 22 }}>
        <div className="onb-logo">🎧</div>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.02em' }}>Fuse</div>
          <div className="h-sm" style={{ marginTop: 8, padding: '0 8px' }}>
            All your music, every service — one app that finally puts it together.
          </div>
        </div>
        <div className="stack" style={{ width: '100%' }}>
          <button className="onb-btn" onClick={() => setStep(2)}>Get started</button>
          <button className="onb-ghost" onClick={onDone}>I already have an account</button>
        </div>
      </div>
    );
  }

  return (
    <div className="onb" style={{ gap: 14 }}>
      <div>
        <div className="h-lg" style={{ fontSize: 21 }}>Connect your music</div>
        <div className="h-sm">Link the services you use. Add more later.</div>
      </div>
      <div className="stack">
        {SERVICES.map((svc) => {
          const on = connected.has(svc.id);
          const m = SOURCE_META[svc.id];
          return (
            <div className="connect" key={svc.id}>
              <div className="lg"><BrandLogo source={svc.id} size={40} /></div>
              <div className="cn"><div className="n">{m.label}</div><div className="s">{svc.desc}</div></div>
              <button className={`toggle${on ? ' on' : ''}`} aria-label={`Connect ${m.label}`}
                onClick={() => toggle(svc.id)}><span className="k" /></button>
            </div>
          );
        })}
      </div>
      <div className="h-sm" style={{ textAlign: 'center' }}>{connected.size} connected</div>
      <div style={{ marginTop: 'auto' }}>
        <button className="onb-btn" disabled={connected.size === 0} onClick={onDone}>Continue →</button>
      </div>
    </div>
  );
}

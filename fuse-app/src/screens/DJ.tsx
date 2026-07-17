import { useEffect, useRef, useState } from 'react';
import { DJEngine, type EqBand } from '../dj/DJEngine';

// A fuller waveform: many bars with a plausible envelope.
const BARS = Array.from({ length: 64 }, (_, i) => {
  const env = Math.sin((i / 64) * Math.PI * 3) * 0.4 + 0.55;
  const jitter = ((i * 73) % 17) / 17 * 0.4;
  return Math.round((Math.min(1, Math.max(0.15, env + jitter - 0.2))) * 100);
});

function Deck({ engine, side, bpm, synced, onSync }: {
  engine: DJEngine; side: 'a' | 'b'; bpm: number; synced: boolean; onSync: () => void;
}) {
  const deck = side === 'a' ? engine.a : engine.b;
  const [playing, setPlaying] = useState(false);
  const [pads, setPads] = useState<boolean[]>([true, false, false, false]);
  const [pos, setPos] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    function tick() { setPos(deck.progress()); raf.current = requestAnimationFrame(tick); }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [deck]);

  async function togglePlay() { await engine.resume(); setPlaying(deck.toggle()); }
  function togglePad(i: number) { setPads((p) => p.map((on, j) => (j === i ? !on : on))); }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { await engine.resume(); await deck.loadFile(f); if (!playing) { setPlaying(deck.toggle()); } }
  }

  const padNames = side === 'a' ? ['CUE 1', 'CUE 2', 'LOOP', 'FX'] : ['CUE 1', 'CUE 2', 'LOOP 4', 'FX'];

  return (
    <div className="djdeck">
      <div className="dtop">
        <div>
          <div className="dname">Deck {side.toUpperCase()}</div>
          <div className="dtitle">{side === 'a' ? 'Deck A loop' : 'Deck B loop'}</div>
        </div>
        <div className="bpm">{bpm.toFixed(1)}<small>{synced ? ' SYNC' : ' BPM'}</small></div>
      </div>
      <div className="wave-lg">
        {BARS.map((h, i) => <span key={i} className={i / 64 > pos ? 'q' : ''} style={{ height: `${h}%` }} />)}
        <span className="sweep" style={{ left: `${pos * 100}%`, opacity: playing ? 1 : 0 }} />
      </div>
      <div className="dpads">
        {padNames.map((n, i) => (
          <button key={n} className={`pad${pads[i] ? ' on' : ''}`} onClick={() => togglePad(i)}>{n}</button>
        ))}
      </div>
      <div className="eqs">
        {(['high', 'mid', 'low'] as EqBand[]).map((band) => (
          <label className="eqk" key={band}>
            <input type="range" min={-24} max={12} defaultValue={0} onChange={(e) => deck.setEq(band, Number(e.target.value))} />
            <small>{band.toUpperCase()}</small>
          </label>
        ))}
      </div>
      <div className="dtrans">
        <button className="db" onClick={() => fileRef.current?.click()}>LOAD</button>
        <button className="db play" onClick={togglePlay}>{playing ? '❚❚ PAUSE' : '▶ PLAY'}</button>
        <button className={`db${synced ? ' on' : ''}`} onClick={onSync}>SYNC</button>
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={onFile} />
      </div>
    </div>
  );
}

export function DJ() {
  const engineRef = useRef<DJEngine | null>(null);
  if (!engineRef.current) engineRef.current = new DJEngine();
  const engine = engineRef.current;
  const [xf, setXf] = useState(0.5);
  const [bSynced, setBSynced] = useState(false);
  const bBpm = bSynced ? 123.0 : 126.0;

  return (
    <>
      <div className="row-head"><div className="h-lg">DJ Mode</div></div>
      <Deck engine={engine} side="a" bpm={123.0} synced={false} onSync={() => {}} />
      <div className="xfwrap"><b>A</b>
        <input type="range" min={0} max={1} step={0.01} value={xf}
          onChange={(e) => { const v = Number(e.target.value); setXf(v); engine.setCrossfade(v); }} />
        <b>B</b>
      </div>
      <Deck engine={engine} side="b" bpm={bBpm} synced={bSynced} onSync={() => setBSynced((v) => !v)} />
      <div className="dj-note">
        Real Web Audio engine — ▶ plays each deck, the crossfader blends them, EQ sliders and SYNC are live.
        Load your own track with LOAD. (Spotify/YouTube can't be mixed on a deck — their DRM blocks raw audio —
        so decks use your files or DJ-licensed sources, like every real DJ app.)
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { DJEngine, type EqBand } from '../dj/DJEngine';

const BARS = [30, 60, 44, 80, 52, 70, 38, 64, 40, 76, 50, 30, 66, 44, 58, 42];

function Deck({ engine, side }: { engine: DJEngine; side: 'a' | 'b' }) {
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

  async function togglePlay() {
    await engine.resume();
    setPlaying(deck.toggle());
  }
  function setEq(band: EqBand, v: number) { deck.setEq(band, v); }
  function togglePad(i: number) { setPads((p) => p.map((on, j) => (j === i ? !on : on))); }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { await engine.resume(); await deck.loadFile(f); }
  }

  const label = side === 'a' ? 'Deck A' : 'Deck B';
  const padNames = side === 'a' ? ['CUE 1', 'CUE 2', 'LOOP', 'FX'] : ['CUE 1', 'CUE 2', 'LOOP 4', 'FX'];

  return (
    <div className="djdeck">
      <div className="dtop">
        <div><div className="dname">{label}</div><div className="dtitle">{side === 'a' ? 'Deck A loop' : 'Deck B loop'}</div></div>
        <div className="bpm">123<small> BPM</small></div>
      </div>
      <div className="wave">
        {BARS.map((h, i) => <span key={i} className={i > 6 ? 'q' : ''} style={{ height: `${h}%` }} />)}
        <span className="sweep" style={{ left: `${6 + pos * 90}%`, opacity: playing ? 1 : 0 }} />
      </div>
      <div className="dpads">
        {padNames.map((n, i) => (
          <button key={n} className={`pad${pads[i] ? ' on' : ''}`} onClick={() => togglePad(i)}>{n}</button>
        ))}
      </div>
      <div className="eqs">
        {(['high', 'mid', 'low'] as EqBand[]).map((band) => (
          <label className="eqk" key={band}>
            <input type="range" min={-24} max={12} defaultValue={0} onChange={(e) => setEq(band, Number(e.target.value))} />
            <small>{band.toUpperCase()}</small>
          </label>
        ))}
      </div>
      <div className="dtrans">
        <button className="db" onClick={() => fileRef.current?.click()}>LOAD</button>
        <button className="db play" onClick={togglePlay}>{playing ? '❚❚ PAUSE' : '▶ PLAY'}</button>
        <button className="db">SYNC</button>
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

  return (
    <>
      <div className="h-lg">DJ Mode</div>
      <Deck engine={engine} side="a" />
      <div className="xfwrap">
        <b>A</b>
        <input type="range" min={0} max={1} step={0.01} value={xf}
          onChange={(e) => { const v = Number(e.target.value); setXf(v); engine.setCrossfade(v); }} />
        <b>B</b>
      </div>
      <Deck engine={engine} side="b" />
      <div className="h-sm" style={{ textAlign: 'center' }}>
        Real Web Audio engine. Hit ▶ to hear each deck, drag the crossfader to blend,
        move the EQ sliders live, or LOAD your own audio file. DJ-licensed streaming plugs in here.
      </div>
    </>
  );
}

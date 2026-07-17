import { useEffect, useRef, useState } from 'react';
import { DJEngine, type EqBand } from '../dj/DJEngine';
import { TRACKS } from '../catalog';
import { createYouTubePlayer, type YouTubePlayer } from '../integrations/youtube';
import { Art } from '../components/common';
import type { Track } from '../integrations/types';

const BARS = Array.from({ length: 64 }, (_, i) => {
  const env = Math.sin((i / 64) * Math.PI * 3) * 0.4 + 0.55;
  const jitter = ((i * 73) % 17) / 17 * 0.4;
  return Math.round((Math.min(1, Math.max(0.15, env + jitter - 0.2))) * 100);
});

type DeckMode = 'loop' | 'file' | 'youtube';

function Deck({ engine, side, xfRef, registerYt }: {
  engine: DJEngine; side: 'a' | 'b';
  xfRef: React.MutableRefObject<number>;
  registerYt: (side: 'a' | 'b', p: YouTubePlayer) => void;
}) {
  const deck = side === 'a' ? engine.a : engine.b;
  const [mode, setMode] = useState<DeckMode>('loop');
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pads, setPads] = useState<boolean[]>([true, false, false, false]);
  const [pos, setPos] = useState(0);
  const [picker, setPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ytRef = useRef<YouTubePlayer | null>(null);
  const modeRef = useRef(mode); modeRef.current = mode;
  const raf = useRef(0);

  useEffect(() => {
    function tick() {
      if (modeRef.current === 'youtube' && ytRef.current) {
        const d = ytRef.current.getDuration();
        setPos(d ? ytRef.current.getCurrentTime() / d : 0);
      } else {
        setPos(deck.progress());
      }
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [deck]);

  async function ensureYt(): Promise<YouTubePlayer> {
    if (ytRef.current) return ytRef.current;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden';
    document.body.appendChild(host);
    const p = await createYouTubePlayer(host);
    ytRef.current = p;
    registerYt(side, p);
    // Apply the current crossfade position to the new player.
    const x = xfRef.current;
    const vol = side === 'a' ? Math.cos(x * Math.PI / 2) : Math.cos((1 - x) * Math.PI / 2);
    p.setVolume(Math.round(vol * 100));
    p.onStateChange((pl) => setPlaying(pl));
    return p;
  }

  async function loadYouTube(t: Track) {
    setPicker(false);
    if (deck.playing) deck.stop();       // silence the web-audio engine for this deck
    setTrack(t); setMode('youtube'); setPlaying(true);
    const p = await ensureYt();
    p.play(t.nativeId);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPicker(false);
    ytRef.current?.pause();
    await engine.resume();
    await deck.loadFile(f);
    setTrack(null); setMode('file');
    if (!deck.playing) deck.toggle();
    setPlaying(true);
  }

  async function togglePlay() {
    if (mode === 'youtube' && ytRef.current) {
      if (playing) ytRef.current.pause(); else ytRef.current.resume();
      setPlaying(!playing);
      return;
    }
    await engine.resume();
    setPlaying(deck.toggle());
  }

  function togglePad(i: number) { setPads((p) => p.map((on, j) => (j === i ? !on : on))); }

  const title = mode === 'youtube' && track ? track.title : mode === 'file' ? 'Your audio file' : 'Demo loop';
  const sub = mode === 'youtube' && track ? track.artist : mode === 'file' ? 'Full EQ + beat tools' : 'Load a track to mix';
  const padNames = side === 'a' ? ['CUE 1', 'CUE 2', 'LOOP', 'FX'] : ['CUE 1', 'CUE 2', 'LOOP 4', 'FX'];

  return (
    <div className="djdeck">
      <div className="dtop">
        <div className="dtitle-wrap">
          <div className="dname">Deck {side.toUpperCase()}</div>
          <div className="dtrack">
            {mode === 'youtube' && track?.artUrl && <Art src={track.artUrl} className="d-art" />}
            <div>
              <div className="dtitle">{title}</div>
              <div className="dsub">{sub}</div>
            </div>
          </div>
        </div>
        <div className="bpm">{mode === 'youtube' ? '—' : '123.0'}<small> BPM</small></div>
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
      <div className={`eqs${mode === 'youtube' ? ' dim' : ''}`}>
        {(['high', 'mid', 'low'] as EqBand[]).map((band) => (
          <label className="eqk" key={band}>
            <input type="range" min={-24} max={12} defaultValue={0} disabled={mode === 'youtube'}
              onChange={(e) => deck.setEq(band, Number(e.target.value))} />
            <small>{band.toUpperCase()}</small>
          </label>
        ))}
      </div>
      {mode === 'youtube' && <div className="eq-note">EQ &amp; beat tools need raw audio — load a file to unlock them.</div>}
      <div className="dtrans">
        <button className="db" onClick={() => setPicker((v) => !v)}>LOAD</button>
        <button className="db play" onClick={togglePlay}>{playing ? '❚❚ PAUSE' : '▶ PLAY'}</button>
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={onFile} />
      </div>

      {picker && (
        <div className="deck-picker">
          <div className="menu-title">Load onto Deck {side.toUpperCase()}</div>
          <div className="picker-list">
            {TRACKS.map((t) => (
              <button className="picker-row" key={t.id} onClick={() => loadYouTube(t)}>
                <Art src={t.artUrl} className="p-art" />
                <span className="p-meta"><b>{t.title}</b><i>{t.artist}</i></span>
                <span className="p-src">YouTube</span>
              </button>
            ))}
            <button className="picker-row file" onClick={() => fileRef.current?.click()}>
              <span className="p-file">⤒</span>
              <span className="p-meta"><b>Audio file from device…</b><i>Unlocks EQ, loops &amp; beat tools</i></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DJ() {
  const engineRef = useRef<DJEngine | null>(null);
  if (!engineRef.current) engineRef.current = new DJEngine();
  const engine = engineRef.current;
  const [xf, setXf] = useState(0.5);
  const xfRef = useRef(0.5);
  const ytPlayers = useRef<{ a?: YouTubePlayer; b?: YouTubePlayer }>({});

  function registerYt(side: 'a' | 'b', p: YouTubePlayer) { ytPlayers.current[side] = p; }

  function onCrossfade(v: number) {
    setXf(v); xfRef.current = v;
    engine.setCrossfade(v); // web-audio decks
    // YouTube decks: equal-power volume blend
    ytPlayers.current.a?.setVolume(Math.round(Math.cos(v * Math.PI / 2) * 100));
    ytPlayers.current.b?.setVolume(Math.round(Math.cos((1 - v) * Math.PI / 2) * 100));
  }

  return (
    <>
      <div className="row-head"><div className="h-lg">DJ Mode</div></div>
      <Deck engine={engine} side="a" xfRef={xfRef} registerYt={registerYt} />
      <div className="xfwrap"><b>A</b>
        <input type="range" min={0} max={1} step={0.01} value={xf}
          onChange={(e) => onCrossfade(Number(e.target.value))} />
        <b>B</b>
      </div>
      <Deck engine={engine} side="b" xfRef={xfRef} registerYt={registerYt} />
      <div className="dj-note">
        LOAD puts any track from your library on a deck — both decks play at once and the crossfader blends them.
        For full DJ control (EQ, loops, beatmatch) load an audio file: streaming DRM blocks raw-audio processing.
      </div>
    </>
  );
}

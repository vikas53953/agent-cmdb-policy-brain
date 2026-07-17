import { useState } from 'react';
import { demoSearch } from '../catalog';
import { youtubeAdapter } from '../integrations/youtube';
import { spotifyAdapter } from '../integrations/spotify';
import { usePlayer } from '../player';
import { TrackRow } from '../components/common';
import type { Track } from '../integrations/types';

export function Search() {
  const { play } = usePlayer();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>(demoSearch(''));
  const [loading, setLoading] = useState(false);

  async function run(query: string) {
    setQ(query);
    if (!query.trim()) { setResults(demoSearch('')); return; }
    setLoading(true);
    // Fan out to every connected source in parallel; fall back to the demo catalog.
    const live = await Promise.all(
      [youtubeAdapter, spotifyAdapter].map((a) => (a.isConnected() ? a.search(query).catch(() => []) : Promise.resolve([]))),
    );
    const merged = live.flat();
    setResults(merged.length ? merged : demoSearch(query));
    setLoading(false);
  }

  return (
    <>
      <div className="h-lg">Search</div>
      <div className="search-in">
        <span>⌕</span>
        <input value={q} placeholder="Songs, artists, anything…" onChange={(e) => run(e.target.value)} />
      </div>
      <div className="h-sm">{loading ? 'Searching every source…' : 'Same song, every source — pick your version'}</div>
      {results.map((t) => <TrackRow key={t.id} track={t} onPlay={(tt) => play(tt, results)} />)}
      {!results.length && !loading && <div className="h-sm">No matches. Try another search.</div>}
    </>
  );
}

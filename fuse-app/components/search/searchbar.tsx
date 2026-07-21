"use client";

// As-you-type search (U6, R1/R5, KTD-8) + search extras (Wave 1).
//
// Owns the query input, a DEBOUNCED fetch to /api/search, and the honest render of
// results. Debounce + in-flight cancellation are the client half of the quota
// defence: a burst of keystrokes collapses to ONE request (KTD-8), and a newer
// query aborts an older in-flight one so results never arrive out of order.
//
// Wave 1 adds two extras, both honest:
//   • RECENT SEARCHES — the last few queries this user ran, shown as tappable chips when
//     the box is empty, with a Clear control. Per-user (namespaced by userKey) and stored
//     in localStorage so they survive across sessions; a private/blocked store degrades to
//     none rather than breaking search.
//   • RESULT FILTERS — All / Songs / Videos chips, built on the audio-vs-video classifier
//     so the filter can never disagree with a row's own AUDIO/VIDEO label.

import { useEffect, useMemo, useRef, useState } from "react";
import type { TrackRef } from "@/lib/repos/track";
import type { SearchResponse } from "@/lib/search/orchestrate";
import { adapterRegistry } from "@/lib/player/adapters";
import { loadSearchQuery, saveSearchQuery } from "@/lib/session-state";
import { filterByKind, trackKind, type ResultFilter } from "@/lib/search/audio-kind";
import { normalizeSearchQuery, MAX_SEARCH_QUERY_LENGTH } from "@/lib/search/normalize-query";
import {
  browserStorage,
  loadRecentSearches,
  addRecentSearch,
  clearRecentSearches,
} from "@/lib/search/recent-searches";
import ResultRow from "@/components/search/result-row";

const DEBOUNCE_MS = 350;

type Status = "idle" | "loading" | "done" | "error";

// The settled outcome for one resolved query. `query` is the trimmed query this
// outcome belongs to, so the render can tell whether the current input is still
// waiting (loading) or already answered (done/error) — no status state is set
// synchronously in the effect (which React discourages).
type Outcome = { query: string; data: SearchResponse | null; error: boolean };
const EMPTY_OUTCOME: Outcome = { query: "", data: null, error: false };

const FILTERS: { id: ResultFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "videos", label: "Videos" },
];

export default function SearchBar({ userKey = "anon" }: { userKey?: string }) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(EMPTY_OUTCOME);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [recent, setRecent] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // The browser store for recent searches (null in SSR / private mode → no history).
  const store = useMemo(() => browserStorage(), []);

  // Restore the last query after a reload (FIX 2). Deliberately done in a mount effect, not
  // in the initial state: sessionStorage is browser-only, so seeding initial state from it
  // would make the client's first render disagree with the server's empty input (a hydration
  // mismatch). Reading it once post-hydration and setting state is the correct pattern here —
  // the one-shot setState is intended (it re-runs the normal debounced search below, which
  // the server cache serves, restoring the results view without a special path).
  useEffect(() => {
    const restored = loadSearchQuery();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-shot restore from browser storage on mount
    if (restored) setQuery(restored);
    // Load this user's recent searches once on mount (browser-only, post-hydration).
    setRecent(loadRecentSearches(store, userKey));
  }, [store, userKey]);

  // Persist the query on every change so the next reload can restore it (cleared when empty).
  useEffect(() => {
    saveSearchQuery(query);
  }, [query]);

  useEffect(() => {
    // Normalize through the SHARED cap (F2) before we ever build a request: trims,
    // collapses whitespace, and caps length so a 220-char paste can never reach a
    // real provider search. The server enforces the exact same cap independently —
    // this is the first, quieter line of defence.
    const normalized = normalizeSearchQuery(query);
    // A single debounced timer drives every state change; the effect body itself
    // never calls setState (only schedules + cleans up), so a keystroke burst
    // collapses to one request (KTD-8) without cascading renders.
    const handle = setTimeout(async () => {
      if (normalized === "") {
        abortRef.current?.abort();
        setOutcome(EMPTY_OUTCOME);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(normalized)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`search ${res.status}`);
        const json = (await res.json()) as SearchResponse;
        setOutcome({ query: normalized, data: json, error: false });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // superseded — ignore
        setOutcome({ query: normalized, data: null, error: true });
      }
    }, normalized === "" ? 0 : DEBOUNCE_MS);

    // Clearing the timer alone was not enough: a request already in flight would still
    // resolve and call setOutcome on an unmounted component. Aborting it too makes the
    // fetch reject with AbortError, which the catch above already treats as "superseded".
    return () => {
      clearTimeout(handle);
      abortRef.current?.abort();
    };
  }, [query]);

  // Record a query into recent searches — on the user's intent signals (Enter, or the box
  // losing focus), not on every keystroke, so the list stays a short set of real searches.
  function remember(q: string) {
    const normalized = normalizeSearchQuery(q);
    if (normalized === "") return;
    setRecent(addRecentSearch(store, userKey, normalized));
  }

  function runRecent(q: string) {
    setQuery(q);
    setRecent(addRecentSearch(store, userKey, q)); // bump it to the top
  }

  // Which sources have a live playback adapter right now. Read once per render; result
  // rows use it to stay honest about what can play.
  const registered = new Set(adapterRegistry.registeredSources());

  const trimmed = normalizeSearchQuery(query); // the capped, whitespace-collapsed query we actually search on
  const settled = outcome.query === trimmed; // is the shown outcome for the current input?
  const status: Status =
    trimmed === ""
      ? "idle"
      : !settled
        ? "loading"
        : outcome.error
          ? "error"
          : "done";
  const data = status === "done" ? outcome.data : null;
  const allResults = data?.results ?? [];
  const results = filterByKind(allResults, filter);
  const sources = data?.sources;
  // Honest "prefer audio" hint (P2): the setting promises official audio first, but many
  // searches (e.g. "Softly") simply have no official-audio upload to float. When the
  // preference is ON and this result set contains zero audio versions, say so plainly rather
  // than leaving the user to wonder why the toggle appeared to do nothing.
  const noAudioForPreference =
    status === "done" &&
    (data?.preferAudio ?? false) &&
    allResults.length > 0 &&
    !allResults.some((r) => trackKind(r) === "audio");
  // Source-level honesty lines: show a reason only when that source failed AND we
  // are not still loading (so a momentary "unavailable" doesn't flash mid-type).
  const sourceNotices =
    status === "done" && sources
      ? [
          !sources.youtube.available ? sources.youtube.reason : null,
          !sources.spotify.available ? sources.spotify.reason : null,
        ].filter((r): r is string => !!r)
      : [];

  return (
    <div className="search">
      <div className="searchbar">
        <input
          type="search"
          className="searchbar-input"
          data-testid="search-input"
          placeholder="Search songs, artists…"
          value={query}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => remember(query)}
          onKeyDown={(e) => {
            if (e.key === "Enter") remember(query);
          }}
          aria-label="Search for songs and artists"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {/* Recent searches — shown only when the box is empty and there is history. Tappable
          to re-run, with an honest Clear control (per-user). */}
      {status === "idle" && recent.length > 0 ? (
        <div className="recent" data-testid="recent-searches">
          <div className="recent-head">
            <span className="recent-title">Recent searches</span>
            <button
              type="button"
              className="recent-clear"
              data-testid="recent-clear"
              onClick={() => setRecent(clearRecentSearches(store, userKey))}
              aria-label="Clear recent searches"
            >
              Clear
            </button>
          </div>
          <div className="recent-chips">
            {recent.map((q) => (
              <button
                key={q}
                type="button"
                className="recent-chip"
                data-testid="recent-chip"
                onClick={() => runRecent(q)}
                aria-label={`Search again for ${q}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {status === "idle" && recent.length === 0 ? (
        <p className="search-hint">Type to find songs from YouTube and Spotify.</p>
      ) : null}

      {status === "loading" ? (
        <p className="search-hint" role="status">
          Searching…
        </p>
      ) : null}

      {status === "error" ? (
        <p className="search-notice" role="alert">
          Search hit a snag — check your connection and try again.
        </p>
      ) : null}

      {sourceNotices.map((notice) => (
        <p key={notice} className="search-notice">
          {notice}
        </p>
      ))}

      {/* Result filters — only shown once there are results to narrow. Built on the same
          audio/video classifier the rows label with, so All / Songs / Videos never lie. */}
      {status === "done" && allResults.length > 0 ? (
        <div className="sfilters" role="tablist" aria-label="Filter results" data-testid="result-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? "sfilter on" : "sfilter"}
              data-testid={`filter-${f.id}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {status === "done" && allResults.length === 0 && sourceNotices.length === 0 ? (
        <p className="search-hint">No songs found for “{data?.query}”.</p>
      ) : null}

      {status === "done" && allResults.length > 0 && results.length === 0 ? (
        <p className="search-hint" data-testid="filter-empty">
          {filter === "videos"
            ? "No videos in these results."
            : "No songs in these results."}
        </p>
      ) : null}

      {noAudioForPreference && results.length > 0 ? (
        <p className="search-hint" data-testid="no-audio-hint">
          No official audio for this search — showing videos.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="sresult-list" aria-label="Search results" data-testid="search-results">
          {results.map((result, i) => (
            <li key={`${result.source}:${result.nativeId}`}>
              <ResultRow
                result={result}
                rest={results.slice(i + 1) as TrackRef[]}
                hasAdapter={registered.has(result.source)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

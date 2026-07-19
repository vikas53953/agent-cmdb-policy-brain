"use client";

// As-you-type search (U6, R1/R5, KTD-8).
//
// Owns the query input, a DEBOUNCED fetch to /api/search, and the honest render of
// results. Debounce + in-flight cancellation are the client half of the quota
// defence: a burst of keystrokes collapses to ONE request (KTD-8), and a newer
// query aborts an older in-flight one so results never arrive out of order.
//
// Honesty (R17): each result decides its own play button state (see result-row).
// When a whole source is unavailable (not configured on the server, or a transient
// failure), its plain-English reason is shown once above the list — never a silent
// gap that looks like "no results".

import { useEffect, useRef, useState } from "react";
import type { TrackRef } from "@/lib/repos/track";
import type { SearchResponse } from "@/lib/search/orchestrate";
import { adapterRegistry } from "@/lib/player/adapters";
import { loadSearchQuery, saveSearchQuery } from "@/lib/session-state";
import ResultRow from "@/components/search/result-row";

const DEBOUNCE_MS = 350;

type Status = "idle" | "loading" | "done" | "error";

// The settled outcome for one resolved query. `query` is the trimmed query this
// outcome belongs to, so the render can tell whether the current input is still
// waiting (loading) or already answered (done/error) — no status state is set
// synchronously in the effect (which React discourages).
type Outcome = { query: string; data: SearchResponse | null; error: boolean };
const EMPTY_OUTCOME: Outcome = { query: "", data: null, error: false };

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(EMPTY_OUTCOME);
  const abortRef = useRef<AbortController | null>(null);

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
  }, []);

  // Persist the query on every change so the next reload can restore it (cleared when empty).
  useEffect(() => {
    saveSearchQuery(query);
  }, [query]);

  useEffect(() => {
    const trimmed = query.trim();
    // A single debounced timer drives every state change; the effect body itself
    // never calls setState (only schedules + cleans up), so a keystroke burst
    // collapses to one request (KTD-8) without cascading renders.
    const handle = setTimeout(async () => {
      if (trimmed === "") {
        abortRef.current?.abort();
        setOutcome(EMPTY_OUTCOME);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`search ${res.status}`);
        const json = (await res.json()) as SearchResponse;
        setOutcome({ query: trimmed, data: json, error: false });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // superseded — ignore
        setOutcome({ query: trimmed, data: null, error: true });
      }
    }, trimmed === "" ? 0 : DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query]);

  // Which sources have a live playback adapter right now (empty until U7/U15 land).
  // Read once per render; result rows use it to stay honest about what can play.
  const registered = new Set(adapterRegistry.registeredSources());

  const trimmed = query.trim();
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
  const results = data?.results ?? [];
  const sources = data?.sources;
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
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search for songs and artists"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {status === "idle" ? (
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

      {status === "done" && results.length === 0 && sourceNotices.length === 0 ? (
        <p className="search-hint">No songs found for “{data?.query}”.</p>
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

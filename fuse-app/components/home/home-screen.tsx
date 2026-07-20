// Home feed (U12, R10/R11, F4, KTD-4). The prototype's scrolling home: a blend-strip
// that states the app's identity, then horizontal carousels — recently played,
// trending, and "more like what you love". A server component: all the data is
// resolved on the server (page.tsx) and passed in; the interactive pieces (each Rail's
// scroll cue, each TrackCard's honest play button) are the only client boundaries.
//
// HONESTY (R17): an empty row is not rendered as a dead, contentless carousel — it is
// simply omitted, and the "more like what you love" subtitle states plainly whether it
// is generic ("popular picks to get you started") or personalised to the user.
//
// The same rule governs the trending row's own name (audit 8). A brand-new account is
// looking at a hand-picked starter list, not a measurement of what people are playing,
// so the row is headed "Starter picks" and only becomes "Trending" once real
// play-count data backs it. `trendingIsReal` carries that one fact up from the server;
// when it is missing we assume the honest, modest label rather than the flattering one.

import type { TrackRef } from "@/lib/repos/track";
import { trackKey, trendingRowLabel } from "@/lib/home/recommend";
import Rail from "@/components/home/rail";
import { occurrenceKeys } from "@/components/ui/list-keys";
import TrackCard from "@/components/home/track-card";

export type HomeData = {
  recentlyPlayed: TrackRef[];
  trending: TrackRef[];
  recommended: TrackRef[];
  // Whether "more like what you love" is tuned to real history yet (R11). Drives the
  // honest subtitle: generic for a new account, personalised once there is history.
  personalised: boolean;
  // Whether `trending` is real aggregate play-count data (true) or the hand-picked
  // starter seed (false/omitted). Drives the row's name. Optional, and absence means
  // "starter picks" — the row can only ever call itself Trending on a positive fact.
  trendingIsReal?: boolean;
};

function HomeRow({
  title,
  subtitle,
  tracks,
}: {
  title: string;
  subtitle?: string;
  tracks: TrackRef[];
}) {
  // An empty row is omitted rather than shown as a contentless carousel (R17).
  if (tracks.length === 0) return null;
  // Identity-based card keys — a rail can repeat a track (recently played especially), so
  // occurrenceKeys keeps them unique without baking the array position into the key.
  const cardKeys = occurrenceKeys(tracks.map(trackKey));
  return (
    <section className="home-row" aria-label={title}>
      <div className="home-row-head">
        <h2 className="home-row-title">{title}</h2>
        {subtitle ? <p className="home-row-sub">{subtitle}</p> : null}
      </div>
      <Rail>
        {tracks.map((track, i) => (
          <TrackCard key={cardKeys[i]} track={track} queue={tracks.slice(i + 1)} />
        ))}
      </Rail>
    </section>
  );
}

export default function HomeScreen({ data }: { data: HomeData }) {
  const trendingLabel = trendingRowLabel(data.trendingIsReal === true);
  const empty =
    data.recentlyPlayed.length === 0 &&
    data.trending.length === 0 &&
    data.recommended.length === 0;

  return (
    <div className="home">
      {/* The identity strip — auto-crossfade is real since U11, so this states a true
          capability, not a decorative claim (R17). */}
      <div className="blend-strip" role="note">
        <span className="blend-dot" aria-hidden="true" />
        <span className="blend-strip-text">
          Auto-crossfade on — songs melt into each other as you listen.
        </span>
      </div>

      <HomeRow title="Recently played" tracks={data.recentlyPlayed} />
      <HomeRow
        title={trendingLabel.title}
        subtitle={trendingLabel.subtitle}
        tracks={data.trending}
      />
      <HomeRow
        title="More like what you love"
        subtitle={
          data.personalised
            ? "Tuned to what you play and like"
            : "Popular picks to get you started"
        }
        tracks={data.recommended}
      />

      {empty ? (
        <p className="home-empty">
          Your home fills in as you listen — search a song and tap play to start.
        </p>
      ) : null}
    </div>
  );
}

// Streamed placeholder for every page inside the app shell (Home, Search, DJ, Library).
//
// THE BUG THIS KILLS: the group is `force-dynamic` and had NO loading boundary, so a
// tab tap blocked on the server with the OLD screen still on display and nothing moving
// — indistinguishable from a dead button. Next streams this the instant navigation
// starts, so the tap always produces visible feedback.
//
// One boundary at the group root rather than one per page: every current and future tab
// inherits it, so a new route can never ship without a loading state. It stays
// deliberately plain — an honest "loading" line, not fake shimmering rows pretending to
// be content that may not exist (R17).
export default function AppLoading() {
  return (
    <div className="screen">
      <p className="home-empty" role="status" aria-live="polite">
        Loading…
      </p>
    </div>
  );
}

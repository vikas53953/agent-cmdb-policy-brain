// Home (U4 shell state). The real learning home feed — carousels, trending, "more
// like what you love" — lands in U12. Until then Home renders the Fuse wordmark hero
// and an honest note about what is coming, inside the shared app shell (top bar,
// dock, tabs). No interactive controls here yet, so nothing is decorative (R17).
export default function HomePage() {
  return (
    <div className="stage">
      <h1 className="hero-wordmark">Fuse</h1>
      <p className="stage-body">
        Songs that melt into each other. Your home feed — what you love, what is trending,
        and blends made for you — arrives once the player and library are wired. Tap your
        avatar any time to see settings.
      </p>
    </div>
  );
}

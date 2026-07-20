"use client";

// Failure boundary for every page inside the app shell.
//
// THE BUG THIS KILLS: nothing under `app/` caught a thrown render, so any error outside
// the two loaders' own try/catch dropped the user on Next's raw error page — stack
// frames, no Fuse chrome, no way back. This catches the whole group, so the class of
// "unhandled throw on any tab" is covered once rather than route by route.
//
// It says plainly that this is a fault on our side, and offers a real retry: `reset()`
// re-renders the segment, so a transient database blip recovers in place without a full
// page reload. Never renders the error's message — an internal string is not something
// to put in front of a listener, and it can carry detail we don't want on screen.

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="screen">
      <div className="np-stall" role="alert">
        <span>Something went wrong on our side. Your music, likes and playlists are safe.</span>
        <button type="button" className="np-stall-skip" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}

// U1 placeholder home. This is intentionally free of interactive controls: per
// the honesty rule (R17), nothing renders as a clickable feature until the unit
// that makes it work has landed. The real home feed, tabs, and mini-player
// arrive in U4+. This page only confirms the scaffold boots and looks like Fuse.
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontSize: "clamp(2.5rem, 12vw, 5rem)",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          margin: 0,
          backgroundImage: "var(--fuse)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        Fuse
      </h1>
      <p style={{ color: "var(--txt-mid)", maxWidth: "30rem", margin: 0, lineHeight: 1.5 }}>
        Songs that melt into each other. The app is being rebuilt in stages —
        this is the foundation. Nothing plays yet.
      </p>
      <p style={{ color: "var(--txt-lo)", fontSize: "0.8rem", margin: 0 }}>
        Scaffold ready · sign-in, playback, lyrics, and the DJ console arrive next.
      </p>
    </main>
  );
}

// --- Security headers (KTD-9) --------------------------------------------------
//
// DELIBERATE DEVIATION FROM SUBTRACKR. SubTrackr's posture is deny-all: its CSP
// blocks every cross-origin frame, script, and connection. Fuse cannot copy that
// verbatim — doing so would black-hole every music player. Fuse plays YouTube
// through an <iframe> embed, loads YouTube thumbnails from `i.ytimg.com`, and
// (from U15) runs the Spotify Web Playback SDK script and talks to Spotify's API.
//
// So the CSP below is a CONSCIOUS, MINIMAL relaxation of deny-all — it widens
// exactly the hosts the three music sources require and nothing more. Every added
// host is justified inline. This is the single owner-visible place where Fuse's
// browser posture differs from the proven SubTrackr baseline.
//
// The builder is a pure function so it can be unit-tested (see
// security-headers.test.ts) and reused by next.config.ts. No env vars are read
// here; the policy is identical whether or not any API keys are provisioned, so
// a keyless local/CI build gets the same honest headers as production.

// YouTube: the IFrame Player embed (KTD-7 — the video must be VISIBLE, never
// hidden) plus its thumbnail CDN.
const YT_FRAME = "https://www.youtube.com https://www.youtube-nocookie.com";
const YT_IMG = "https://i.ytimg.com https://*.ytimg.com";
// The IFrame Player API loader (https://www.youtube.com/iframe_api) and the widget
// script it injects from s.ytimg.com. Required by the U7 YouTube adapter to drive
// play/pause/seek/rate on the visible embed. Without these the player cannot load.
const YT_SCRIPT = "https://www.youtube.com https://s.ytimg.com";

// Spotify: the Web Playback SDK script host, the cover-art CDN, and the API/
// streaming endpoints the SDK connects to. Wired for real in U15; declared here
// so the header contract is stable from the scaffold on.
const SP_SCRIPT = "https://sdk.scdn.co";
const SP_IMG = "https://i.scdn.co https://*.scdn.co";
const SP_CONNECT = "https://api.spotify.com https://*.spotify.com wss://*.spotify.com";

// Google avatars (Auth.js sign-in, from U2).
const GOOGLE_IMG = "https://lh3.googleusercontent.com https://*.googleusercontent.com";

/**
 * Build the Content-Security-Policy header value.
 *
 * @param isDev - when true, allow 'unsafe-eval' for React Fast Refresh (dev only).
 */
export function buildCsp(isDev: boolean): string {
  return [
    // Same-origin unless a directive below widens it.
    `default-src 'self'`,
    // Scripts: self + inline (Next injects inline bootstrap) + the YouTube IFrame
    // Player API + the Spotify SDK. 'unsafe-eval' is dev-only (React refresh).
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${YT_SCRIPT} ${SP_SCRIPT}`,
    // Styles: self + inline (Tailwind-injected + React style attrs).
    `style-src 'self' 'unsafe-inline'`,
    // Images: self + data/blob + YouTube thumbs + Spotify covers + Google avatars.
    `img-src 'self' data: blob: ${YT_IMG} ${SP_IMG} ${GOOGLE_IMG}`,
    `font-src 'self'`,
    // XHR/fetch/WebSocket: same-origin + Spotify API/streaming.
    `connect-src 'self' ${SP_CONNECT}`,
    // Frames embedded BY us: the YouTube player iframe.
    `frame-src ${YT_FRAME}`,
    // Media: local user files play as blob/object URLs (R14 — never uploaded).
    `media-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // Sign-in is a same-origin form POST that 302-redirects to an external identity
    // endpoint. Chrome enforces form-action against the REDIRECT TARGET, so 'self'
    // alone silently blocks the whole submission. Allow exactly the identity hosts we
    // hand users off to via form POST: Google (Auth.js sign-in) and Spotify (the PKCE
    // connect flow, its class-mate). Nothing wider — no general external POSTs.
    `form-action 'self' https://accounts.google.com https://accounts.spotify.com`,
    // Nobody may frame Fuse itself.
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

/**
 * Full response-header set applied to every route by next.config.ts.
 */
export function securityHeaders(isDev: boolean): { key: string; value: string }[] {
  return [
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Fuse needs no camera/mic/geolocation. Autoplay is same-origin only.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    { key: "Content-Security-Policy", value: buildCsp(isDev) },
  ];
}

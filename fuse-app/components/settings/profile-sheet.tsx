"use client";

// Profile sheet (U4 scaffold, extended in U9). Slides up from the avatar and holds
// all of the app's settings groups (R16): Account, Playback, Sources, Lyrics, About.
// There is deliberately NO audio-quality control (dropped from v1 per R16).
//
// HONESTY (R17): a control renders LIVE only when it does something real. Today that
// is Sign out (real server action) and Lyrics on/off (U9 — persists to the user's
// settings and shows/hides the Now Playing lyrics panel). Controls not yet wired
// (crossfade → U11, Spotify connect → U15) render DISABLED with a plain-English
// reason and a "soon" tag, read from PENDING_CONTROLS so the honesty list has one
// source of truth; when its owning unit wires a control it drops out of that list.

import { useEffect, useRef, useState } from "react";
import { PENDING_CONTROLS } from "@/lib/ui/shell";
import {
  signOutAction,
  setLyricsEnabledAction,
  setCrossfadeSecAction,
  disconnectSpotifyAction,
} from "@/lib/actions";
import { CROSSFADE_MIN_SEC, CROSSFADE_MAX_SEC } from "@/lib/repos/settings";
import DiagnosticsPanel from "@/components/settings/diagnostics-panel";
import type { ShellUser } from "@/components/ui/app-chrome";

type Props = {
  open: boolean;
  onClose: () => void;
  user: ShellUser | null;
  // The current Lyrics on/off value and a setter, owned by the shell so this toggle
  // and the Now Playing panel stay in sync (U9, R16).
  lyricsEnabled: boolean;
  onLyricsChange: (enabled: boolean) => void;
  // The current crossfade length (seconds) and a setter, owned by the shell so the
  // slider, the live blend engine, and the persisted value stay in sync (U11, R3/R16).
  crossfadeSec: number;
  onCrossfadeChange: (seconds: number) => void;
};

function initialOf(user: ShellUser | null): string {
  const source = user?.name || user?.email || "";
  return source.trim().charAt(0).toUpperCase() || "?";
}

function pendingFor(group: "Playback" | "Sources" | "Lyrics") {
  return PENDING_CONTROLS.filter((c) => c.group === group);
}

function PendingRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="setting-row disabled" aria-disabled="true">
      <div className="setting-main">
        <div className="setting-label">{label}</div>
        <div className="setting-reason">{reason}</div>
      </div>
      <span className="soon-tag">Soon</span>
    </div>
  );
}

// Whether the PKCE connect flow is configured on THIS deployment. The public client id
// and base URL are NEXT_PUBLIC_ (inlined at build), so this is safe to read client-side.
// With either unset there is nothing to connect to, and the row renders disabled with
// an honest reason (R17) — never an enabled button that would dead-end.
const SPOTIFY_CONNECT_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID && process.env.NEXT_PUBLIC_BASE_URL,
);
const SP_UNCONFIGURED_REASON = "Spotify sign-in isn't set up on this server yet";

// Read the non-secret `sp_connected` marker cookie (a bare "1"). Never reads a token.
function readSpotifyConnected(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .map((c) => c.trim())
    .some((c) => c === "sp_connected=1");
}

// Sources → Spotify (U15, R16/R17). Three honest states:
//   • not configured → disabled, plain reason (above).
//   • configured, not connected → a real Connect link that starts the PKCE flow.
//   • connected → Connected badge + a real Disconnect control.
// Reads the NON-secret `sp_connected` marker cookie on mount (starts false so server
// and first client render agree — no hydration mismatch).
function SpotifyRow() {
  const [connected, setConnected] = useState(false);
  const [working, setWorking] = useState(false);

  // Read the non-secret `sp_connected` marker cookie after mount. Deferred to a
  // microtask (not a synchronous effect setState) so server and first client render
  // agree on `false` — no hydration mismatch — then the real value settles in.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setConnected(readSpotifyConnected());
    });
    return () => {
      active = false;
    };
  }, []);

  if (!SPOTIFY_CONNECT_CONFIGURED) {
    return <PendingRow label="Spotify" reason={SP_UNCONFIGURED_REASON} />;
  }

  async function disconnect() {
    if (working) return;
    setWorking(true);
    try {
      await disconnectSpotifyAction();
      setConnected(false);
    } finally {
      setWorking(false);
    }
  }

  if (connected) {
    return (
      <div className="setting-row">
        <div className="setting-main">
          <div className="setting-label">Spotify</div>
          <div className="setting-reason">
            Connected — Spotify songs play as their YouTube version
          </div>
        </div>
        <div className="setting-actions">
          <span className="connected-tag">Connected</span>
          <button
            type="button"
            className="connect-btn"
            onClick={disconnect}
            disabled={working}
            aria-label="Disconnect Spotify"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setting-row">
      <div className="setting-main">
        <div className="setting-label">Spotify</div>
        <div className="setting-reason">Link your account to search with your Spotify</div>
      </div>
      {/* A real navigation to the PKCE start route — does something the moment it is
          tapped (redirects to Spotify's sign-in), so it is never a decorative button. */}
      <a className="connect-btn" href="/api/spotify/connect" aria-label="Connect Spotify">
        Connect
      </a>
    </div>
  );
}

export default function ProfileSheet({
  open,
  onClose,
  user,
  lyricsEnabled,
  onLyricsChange,
  crossfadeSec,
  onCrossfadeChange,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // While a persist is in flight the toggle is disabled so a rapid double-tap can't
  // race two writes. Optimistic: the UI flips immediately; if the server write fails
  // we revert so the control never lies about what was saved.
  const [saving, setSaving] = useState(false);

  async function toggleLyrics() {
    if (saving) return;
    const next = !lyricsEnabled;
    setSaving(true);
    onLyricsChange(next); // optimistic — the panel shows/hides instantly
    try {
      await setLyricsEnabledAction(next);
    } catch {
      onLyricsChange(!next); // revert on failure — honest state
    } finally {
      setSaving(false);
    }
  }

  // Dragging the slider updates the live blend length instantly (real, audible effect
  // on the very next transition — R17); the value is persisted only on release so a
  // drag does not spam the server. The server clamps to 3..15s and returns the stored
  // value, which we reconcile back into shell state.
  function slideCrossfade(seconds: number) {
    onCrossfadeChange(seconds);
  }

  function commitCrossfade() {
    void setCrossfadeSecAction(crossfadeSec)
      .then((stored) => {
        if (stored !== crossfadeSec) onCrossfadeChange(stored);
      })
      .catch(() => {
        // Persist failed: keep the live value; the next sign-in reload reconciles from
        // the stored setting. Never claim a save that did not happen.
      });
  }

  // Close on Escape; move focus into the sheet when it opens (accessibility).
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={open ? "sheet-overlay open" : "sheet-overlay"}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={open ? "sheet open" : "sheet"}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        aria-hidden={!open}
        data-testid="profile-sheet"
      >
        <div className="sheet-handle" aria-hidden="true" />

        <div className="sheet-head">
          <div className="avatar" aria-hidden="true">
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Google avatar; next/image remote config is out of U4 scope
              <img src={user.image} alt="" referrerPolicy="no-referrer" />
            ) : (
              initialOf(user)
            )}
          </div>
          <div className="sheet-id">
            <div className="sheet-name">{user?.name ?? "Signed in"}</div>
            {user?.email ? <div className="sheet-email">{user.email}</div> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close settings"
            style={{ marginLeft: "auto" }}
          >
            ✕
          </button>
        </div>

        {/* Account — the one live group. Sign out is a real server action. */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Account</h3>
          <form action={signOutAction}>
            <button type="submit" className="signout-btn">
              Sign out
            </button>
          </form>
        </section>

        {/* Playback — crossfade length. A REAL control (U11): the slider sets how long
            one song melts into the next, takes effect on the very next transition, and
            persists across reloads. */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Playback</h3>
          <div className="setting-row setting-row-stack">
            <div className="setting-main">
              <div className="setting-label">Crossfade length</div>
              <div className="setting-reason">
                Songs melt into each other over{" "}
                <strong>{crossfadeSec}s</strong>
              </div>
            </div>
            <input
              type="range"
              className="cf-range"
              data-testid="crossfade-range"
              min={CROSSFADE_MIN_SEC}
              max={CROSSFADE_MAX_SEC}
              step={1}
              value={crossfadeSec}
              onChange={(e) => slideCrossfade(Number(e.target.value))}
              onPointerUp={commitCrossfade}
              onKeyUp={commitCrossfade}
              onBlur={commitCrossfade}
              aria-label="Crossfade length in seconds"
              aria-valuetext={`${crossfadeSec} seconds`}
            />
          </div>
          {pendingFor("Playback").map((c) => (
            <PendingRow key={c.id} label={c.label} reason={c.reason} />
          ))}
        </section>

        {/* Sources — the three music sources. YouTube is always on (built in);
            Spotify connect is a real control from U15 (SpotifyRow). */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Sources</h3>
          <div className="setting-row">
            <div className="setting-main">
              <div className="setting-label">YouTube</div>
              <div className="setting-reason">Always on — no sign-in needed</div>
            </div>
            <span className="badge yt">On</span>
          </div>
          <SpotifyRow />
          {pendingFor("Sources").map((c) => (
            <PendingRow key={c.id} label={c.label} reason={c.reason} />
          ))}
        </section>

        {/* Lyrics — on/off. A REAL control (U9): it persists and shows/hides the
            Now Playing lyrics panel. */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Lyrics</h3>
          <div className="setting-row">
            <div className="setting-main">
              <div className="setting-label">Show lyrics</div>
              <div className="setting-reason">
                {lyricsEnabled
                  ? "Scrolling lyrics show on Now Playing"
                  : "Lyrics are hidden on Now Playing"}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={lyricsEnabled}
              aria-label="Show lyrics"
              data-testid="lyrics-toggle"
              className={lyricsEnabled ? "switch on" : "switch"}
              onClick={toggleLyrics}
              disabled={saving}
            >
              <span className="switch-knob" aria-hidden="true" />
            </button>
          </div>
        </section>

        {/* About — informational, plus the activity log (R18). */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">About</h3>
          <p className="about-line">
            Fuse blends your music — songs melt into each other across YouTube, Spotify,
            and your own files. It is being built in stages; every button you see does
            something real, and anything not ready yet says so plainly.
          </p>
          {/* The app records its own playback events and errors so problems can be
              diagnosed from evidence (R18). This is where you can read that log; it
              never shows any secret, only what happened. */}
          <DiagnosticsPanel />
        </section>
      </aside>
    </>
  );
}

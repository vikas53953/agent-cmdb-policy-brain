# Fuse — QA findings, preview deploy (2026-07-21)

Source: independent QA pass by a second Claude session against preview
`fuse-qs92hy21m`. Vikas relayed the report and authorised an autonomous
overnight fix + merge to production.

Verdict from that pass: **87% functional. Zero blockers. No mock data, no dead
links, no no-op buttons found.** Everything below is polish/reliability.

---

## P0 — Reliability

### F-1. Recurring playback stalls
The app's own activity log records `Playback stalled – retrying` roughly every
2 minutes during normal playback.

- **Why this is P0:** this is the same symptom class as the original master
  defect (the reason the playback core was rebuilt). The recovery ladder firing
  constantly means something upstream is wrong, even if the user never hears a
  gap.
- **Repro:** play music a few minutes → Settings → "Show activity log".
- **Rule:** root-cause it. Do not silence the log line.

## P1 — Interaction correctness

### F-2. Buttons require two clicks (CLASS bug, not per-button)
Same broken pattern on unrelated controls:
- Library → Playlists → **Create**: first click does nothing.
- Library → Playlists → **trash/delete**: first click does nothing.
- Mini-player **play** after a skip: sometimes needs a second click.

Treat as ONE shared cause (state/event-handler), not three patches.

### F-3. Playlist delete has no confirmation
Trash icon permanently deletes with no dialog, no undo, no toast. Compounds
with F-2 — the required double-click makes accidental deletion easy.

### F-4. Next track does not reliably auto-resume
After skip/crossfade the new track loads paused despite auto-crossfade being on.

## P2 — Polish

- **F-5.** Stale-content flash on route change (Home/Search/Library/DJ).
- **F-6.** DJ console loses all state on navigate-away (loaded track, EQ,
  crossfader position, curve).
- **F-7.** DJ CUE 1–4 look clickable with no track loaded. Need disabled
  affordance.
- **F-8.** Playlist rename: pressing Enter leaves the field looking editable.

## Untested gaps (carry forward)

- **Mobile viewport** — QA's resize tool never changed the viewport, so phone
  layout is unverified. This is Vikas's primary device.
- **Lock-screen media controls** — planned, no result reported.
- **Softly search ranking** — Vikas's specific case, unverified by QA.
- **"Is the blend felt"** (his #8) — taste judgement, only he can call it.

---

## Confirmed working (do not regress)

Live YouTube-backed search with honest "no official audio" messaging · play /
pause / seek / next · queue reorder + delete · play-next / add-to-queue · liked
songs and playlists persisting across hard reload · Songs/Videos filter
splitting correctly by real audio-vs-video classification (Vikas's #9) ·
time-synced scrolling lyrics · "fusing in Xs" countdown ticking against a wall
clock · DJ dual decks + crossfader + curves · DJ capability honesty (greys out
what YouTube genuinely can't do) · injection payloads rendered as inert text.

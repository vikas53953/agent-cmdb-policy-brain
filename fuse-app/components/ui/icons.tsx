// Inline SVG icon set for the app shell (U4). Inline (not an icon font / external
// sprite) keeps the CSP tight — no network fetch, font-src stays 'self'. Each icon
// inherits `currentColor` so the tab-active gradient and disabled states drive it
// from CSS. Icons are decorative here; the interactive element carries the label.

type IconProps = { size?: number; className?: string };

function svg(path: React.ReactNode, size: number, className?: string) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}

export function HomeIcon({ size = 22, className }: IconProps) {
  return svg(
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </>,
    size,
    className,
  );
}

export function SearchIcon({ size = 22, className }: IconProps) {
  return svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>,
    size,
    className,
  );
}

export function DjIcon({ size = 22, className }: IconProps) {
  return svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.4" />
    </>,
    size,
    className,
  );
}

export function LibraryIcon({ size = 22, className }: IconProps) {
  return svg(
    <>
      <path d="M6 4v16" />
      <path d="M11 4v16" />
      <path d="m16 5 4 15" />
    </>,
    size,
    className,
  );
}

export function PlayIcon({ size = 20, className }: IconProps) {
  return svg(<path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none" />, size, className);
}

export function PauseIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <rect x="6.5" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14.1" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>,
    size,
    className,
  );
}

export function NextIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M6 5.5v13l9-6.5-9-6.5Z" fill="currentColor" stroke="none" />
      <path d="M18 5v14" />
    </>,
    size,
    className,
  );
}

export function PrevIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M18 5.5v13l-9-6.5 9-6.5Z" fill="currentColor" stroke="none" />
      <path d="M6 5v14" />
    </>,
    size,
    className,
  );
}

export function ShuffleIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M4 7h4l8 10h4" />
      <path d="M16.5 4 20 7l-3.5 3" />
      <path d="M4 17h4l2-2.6" />
      <path d="M14 9.2 16 7h4" />
      <path d="M16.5 14 20 17l-3.5 3" />
    </>,
    size,
    className,
  );
}

export function RepeatIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M17 3l3 3-3 3" />
      <path d="M20 6H9a4 4 0 0 0-4 4v1" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M4 18h11a4 4 0 0 0 4-4v-1" />
    </>,
    size,
    className,
  );
}

export function ChevronDownIcon({ size = 22, className }: IconProps) {
  return svg(<path d="m6 9 6 6 6-6" />, size, className);
}

// Chevron-right — the "more content to the right" scroll cue on Home carousels
// (U12, R10). The button it sits inside actually scrolls the rail, so it is a real
// control, not decoration (R17).
export function ChevronRightIcon({ size = 22, className }: IconProps) {
  return svg(<path d="m9 6 6 6-6 6" />, size, className);
}

export function MusicIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>,
    size,
    className,
  );
}

// Heart — the like control (U10, R8). `filled` renders the liked (solid) state so
// the same icon carries both states from one prop, driven by CSS colour.
export function HeartIcon({ size = 20, className, filled = false }: IconProps & { filled?: boolean }) {
  return svg(
    <path
      d="M12 20.5 4.5 13a4.5 4.5 0 0 1 6.4-6.3l1.1 1.1 1.1-1.1A4.5 4.5 0 0 1 19.5 13Z"
      fill={filled ? "currentColor" : "none"}
    />,
    size,
    className,
  );
}

export function PlusIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
    size,
    className,
  );
}

export function TrashIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6 7v13.5h12V7" />
      <path d="M10 11v6M14 11v6" />
    </>,
    size,
    className,
  );
}

export function PencilIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.5Z" />
      <path d="M14 6.5 17.5 10" />
    </>,
    size,
    className,
  );
}

export function ArrowUpIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </>,
    size,
    className,
  );
}

export function ArrowDownIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </>,
    size,
    className,
  );
}

// Queue — the up-next list (Wave 1). A stack of lines with a play cue, opening the queue
// screen. The button it sits in actually opens that screen, so it is a real control (R17).
export function QueueIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M4 6h11" />
      <path d="M4 12h11" />
      <path d="M4 18h7" />
      <path d="M16 14v6l4-3-4-3Z" fill="currentColor" stroke="none" />
    </>,
    size,
    className,
  );
}

// More — a compact overflow trigger (three dots) for a row's Play-next / Add-to-queue menu.
export function MoreIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </>,
    size,
    className,
  );
}

// Clock — the sleep timer control + its armed countdown chip (Wave 1).
export function ClockIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
    size,
    className,
  );
}

// Chevron-left — the "scroll back left" cue on Home carousels (owner fix 7), mirroring
// ChevronRightIcon. The button it sits in actually scrolls the rail, so it is a real
// control, not decoration (R17).
export function ChevronLeftIcon({ size = 22, className }: IconProps) {
  return svg(<path d="m15 6-6 6 6 6" />, size, className);
}

// Volume — the mini-player + Now Playing volume control (owner fix 3). `level` (0..1) drives
// how many sound waves show; a muted control renders VolumeMuteIcon instead.
export function VolumeIcon({ size = 20, className, level = 1 }: IconProps & { level?: number }) {
  return svg(
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
      {level > 0.05 ? <path d="M16 9a3.5 3.5 0 0 1 0 6" /> : null}
      {level > 0.55 ? <path d="M18.5 6.5a7 7 0 0 1 0 11" /> : null}
    </>,
    size,
    className,
  );
}

export function VolumeMuteIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </>,
    size,
    className,
  );
}

// Full screen — the standard "enter full screen" control for a video track (owner fix 4).
export function FullscreenIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </>,
    size,
    className,
  );
}

// Bigger / smaller player — the plain "larger player" inline layout toggle (owner fix 4),
// replacing the confusing "theater" wording. Two arrows pushing apart = enlarge.
export function ExpandIcon({ size = 20, className }: IconProps) {
  return svg(
    <>
      <path d="M9 4H4v5" />
      <path d="M15 20h5v-5" />
      <path d="M4 4l6 6" />
      <path d="M20 20l-6-6" />
    </>,
    size,
    className,
  );
}

const ICONS = {
  home: HomeIcon,
  search: SearchIcon,
  dj: DjIcon,
  library: LibraryIcon,
} as const;

export function TabIcon({ icon, className }: { icon: keyof typeof ICONS; className?: string }) {
  const Cmp = ICONS[icon];
  return <Cmp className={className} />;
}

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

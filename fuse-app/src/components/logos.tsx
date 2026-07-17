// Simple recognizable brand marks as inline SVG (no external assets).
import type { SourceId } from '../integrations/types';

export function BrandLogo({ source, size = 22 }: { source: SourceId; size?: number }) {
  const s = { width: size, height: size, display: 'block' } as const;
  switch (source) {
    case 'spotify':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-label="Spotify">
          <circle cx="12" cy="12" r="12" fill="#1ed760" />
          <path fill="#000" d="M17.9 10.9C14.7 9 9.3 8.8 6.3 9.8a.9.9 0 1 1-.5-1.7c3.5-1.1 9.4-.9 13.1 1.3a.9.9 0 0 1-.9 1.5zm-.1 2.9c-.3.4-.8.6-1.2.3-2.7-1.6-6.7-2.1-9.9-1.2a.75.75 0 1 1-.4-1.4c3.6-1.1 8.1-.5 11.2 1.4.4.2.5.7.3 1.1zm-1.3 2.8c-.2.3-.6.5-.9.3-2.3-1.4-5.3-1.7-8.7-.9a.65.65 0 1 1-.3-1.2c3.8-.9 7.1-.5 9.7 1 .3.2.4.6.2.9z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-label="YouTube">
          <rect x="1" y="5" width="22" height="14" rx="4" fill="#ff0000" />
          <path fill="#fff" d="M10 8.5l6 3.5-6 3.5z" />
        </svg>
      );
    case 'soundcloud':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-label="SoundCloud">
          <circle cx="12" cy="12" r="12" fill="#ff5500" />
          <g fill="#fff">
            <rect x="5" y="11" width="1.4" height="6" rx=".7" />
            <rect x="7.6" y="9.5" width="1.4" height="7.5" rx=".7" />
            <rect x="10.2" y="8.5" width="1.4" height="8.5" rx=".7" />
            <path d="M13 8c2.8 0 5 1.9 5 4.5S15.8 17 13 17h-.2V8z" />
          </g>
        </svg>
      );
    case 'apple':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-label="Apple Music">
          <rect x="1" y="1" width="22" height="22" rx="6" fill="#fa233b" />
          <path fill="#fff" d="M16 6.2l-6.4 1.4v6.7a2.3 2.3 0 1 0 1.3 2V9.4l3.8-.8v3.9a2.3 2.3 0 1 0 1.3 2V6.2z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" style={s} aria-label="Local">
          <rect x="1" y="1" width="22" height="22" rx="6" fill="#7a7a84" />
          <path fill="#fff" d="M9 7h2v7.1a2.4 2.4 0 1 1-1.3-2.1V7z" />
        </svg>
      );
  }
}

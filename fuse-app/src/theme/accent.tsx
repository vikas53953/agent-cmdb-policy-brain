import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface AccentOption { name: string; value: string; }

export const ACCENTS: AccentOption[] = [
  { name: 'Cobalt', value: '#2f6bff' },
  { name: 'Emerald', value: '#12b981' },
  { name: 'Coral', value: '#ff5a4d' },
  { name: 'Violet', value: '#7a5cff' },
  { name: 'Ink', value: '#16161a' },
];

const KEY = 'fuse.accent';

interface AccentCtx { accent: string; setAccent: (v: string) => void; }
const Ctx = createContext<AccentCtx>({ accent: ACCENTS[0].value, setAccent: () => {} });

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccent] = useState<string>(() => localStorage.getItem(KEY) ?? ACCENTS[0].value);

  useEffect(() => {
    localStorage.setItem(KEY, accent);
    const root = document.documentElement;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 12%, var(--card))`);
  }, [accent]);

  const value = useMemo(() => ({ accent, setAccent }), [accent]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAccent = () => useContext(Ctx);

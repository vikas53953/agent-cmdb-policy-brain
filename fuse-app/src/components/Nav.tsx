export type TabId = 'home' | 'search' | 'library' | 'dj' | 'you';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'search', label: 'Search', icon: '⌕' },
  { id: 'library', label: 'Library', icon: '≡' },
  { id: 'dj', label: 'DJ', icon: '◎' },
  { id: 'you', label: 'You', icon: '☺' },
];

export function Nav({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <button key={t.id} className={`nv${tab === t.id ? ' on' : ''}`} onClick={() => onChange(t.id)}>
          <span className="i">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

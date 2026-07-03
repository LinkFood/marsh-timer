import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Sun, CalendarDays, Scale } from 'lucide-react';

/**
 * AppHeader — the one shared header + mobile bottom tab bar.
 *
 * Desktop (md+): brand left, three text links right (TODAY · ARCHIVE · COURT).
 * Mobile (<md): brand-only header + fixed bottom tab bar (56px + safe-area inset).
 *
 * Pages must add `pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0` to their
 * scrollable content so the tab bar never covers it.
 *
 * Optional children render on the right side of the header (UserMenu, etc.).
 */

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TABS = [
  { label: 'TODAY', icon: Sun, to: () => '/', isActive: (p: string) => p === '/', anchor: 'top' },
  { label: 'ARCHIVE', icon: CalendarDays, to: () => `/date/${todayDateStr()}`, isActive: (p: string) => p.startsWith('/date'), anchor: 'archive' },
  { label: 'COURT', icon: Scale, to: () => '/court', isActive: (p: string) => p.startsWith('/court'), anchor: 'court' },
];

/** On the one-page landing, desktop header links scroll to sections instead of navigating. */
function scrollToAnchor(anchor: string) {
  if (anchor === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
  else document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function AppHeader({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <>
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 h-12 border-b border-white/[0.06]">
        <Link to="/" className="flex items-baseline gap-3 hover:opacity-80 transition-opacity min-w-0">
          <span className="font-display text-sm font-bold text-white tracking-wider whitespace-nowrap">DUCK COUNTDOWN</span>
          <span className="text-[9px] font-mono text-cyan-400/60 tracking-widest hidden sm:inline whitespace-nowrap">
            ENVIRONMENTAL INTELLIGENCE
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <nav className="hidden md:flex items-center">
            {TABS.map((tab, i) => {
              const active = tab.isActive(pathname);
              const linkClass = `text-[10px] font-mono tracking-widest transition-colors ${
                active ? 'text-cyan-400' : 'text-white/40 hover:text-white/70'
              }`;
              return (
                <span key={tab.label} className="flex items-center">
                  {i > 0 && <span className="text-white/15 text-[10px] px-2 select-none">·</span>}
                  {pathname === '/' ? (
                    <button onClick={() => scrollToAnchor(tab.anchor)} className={linkClass}>
                      {tab.label}
                    </button>
                  ) : (
                    <Link to={tab.to()} className={linkClass}>
                      {tab.label}
                    </Link>
                  )}
                </span>
              );
            })}
          </nav>
          {children}
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-gray-950/95 backdrop-blur border-t border-white/[0.08]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex h-14">
          {TABS.map(tab => {
            const active = tab.isActive(pathname);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.label}
                to={tab.to()}
                className="flex-1 flex flex-col items-center justify-center gap-0.5"
              >
                <Icon size={18} className={active ? 'text-cyan-400' : 'text-white/40'} />
                <span className={`text-[9px] font-mono tracking-widest ${active ? 'text-cyan-400' : 'text-white/40'}`}>
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

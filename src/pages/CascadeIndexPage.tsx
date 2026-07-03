import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import UserMenu from '@/components/UserMenu';

/**
 * /cascade — "Strangest Days" index.
 *
 * The genre's home: replayed days when several environmental layers moved
 * together. Each card is a verified retrodiction with receipts — the archive
 * replays, it never predicts.
 */

const CASCADES: { to: string; kicker: string; title: string; line: string }[] = [
  {
    to: '/cascade/july-2026-heat',
    kicker: 'July 2026 · East Coast',
    title: 'The heat wave the layers saw coming',
    line: 'The thermometer stayed normal until 4 days out. The drought, the ocean, and the birds moved 1–3 weeks early.',
  },
  {
    to: '/cascade/sept-2020-whiplash',
    kicker: 'September 2020 · Front Range and the Plains',
    title: 'The weekend the weather snapped',
    line: '108°F on Sunday, snow by Tuesday — and on Wednesday, nine states sat off their baselines at once.',
  },
];

export default function CascadeIndexPage() {
  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col">
      <AppHeader>
        <UserMenu />
      </AppHeader>

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-16 space-y-8">
          <header className="space-y-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-cyan-400/70">Strangest days</p>
            <h1 className="font-display text-3xl sm:text-4xl text-white/95 leading-tight">
              Days the layers moved together
            </h1>
            <p className="font-body text-base text-white/60 leading-relaxed">
              Replays from the archive — days when several environmental layers broke normal at once,
              told past-tense with every reading on the table. The archive replays. It never predicts.
            </p>
          </header>

          <section className="space-y-3">
            {CASCADES.map(c => (
              <Link
                key={c.to}
                to={c.to}
                className="group block rounded-lg border border-white/[0.08] bg-gray-900/50 hover:border-cyan-400/30 transition-colors p-4"
              >
                <p className="text-[10px] font-mono uppercase tracking-widest text-white/35">{c.kicker}</p>
                <p className="font-display text-lg text-white/90 leading-snug mt-1.5">{c.title}</p>
                <p className="font-body text-sm text-white/50 leading-relaxed mt-1.5">{c.line}</p>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-400/70 group-hover:text-cyan-400 transition-colors mt-2.5">
                  Replay it <ArrowRight size={11} />
                </span>
              </Link>
            ))}
          </section>
        </div>
      </main>

      <div className="grain-overlay" />
    </div>
  );
}

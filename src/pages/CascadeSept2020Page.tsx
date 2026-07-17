import { Link } from 'react-router-dom';
import { ArrowRight, Scale } from 'lucide-react';
import { InnerHeader, InnerFooter } from '@/components/InnerNav';
import CascadeRibbon from '@/components/CascadeRibbon';
import CiteBlock, { retrievedToday } from '@/components/CiteBlock';
import { TILE_GRID, CELL, PITCH, VIEW_W, VIEW_H } from '@/components/EventMap';
import { getStateName } from '@/hooks/useYourGround';
import { SEPT2020_DATASET, STATES_AFFECTED, DOMAIN_LABEL } from '@/data/cascade_sept2020';

/**
 * /cascade/sept-2020-whiplash — "Strangest Days" #2.
 *
 * A verified replay of Labor Day weekend 2020: Colorado's hottest station
 * read 108°F on Sunday; by Tuesday it was snowing, and on Wednesday nine
 * states were ≥2σ from their place-and-season baselines at once. Everything
 * past-tense — the archive replays 8 days, it never predicts.
 */

const AFFECTED = new Map(STATES_AFFECTED.map(s => [s.abbr, s]));

/** Static tile-grid inset: the nine states lit by domain count. */
function StrangeStatesMap() {
  return (
    <div>
      <svg viewBox={`-0.5 -0.5 ${VIEW_W + 1} ${VIEW_H + 1}`} className="w-full h-auto" role="group" aria-label="US tile map: nine states at 2 sigma or more on September 9, 2020">
        {Object.entries(TILE_GRID).map(([abbr, [col, row]]) => {
          const x = col * PITCH;
          const y = row * PITCH;
          const hit = AFFECTED.get(abbr);
          // 3 domains = hot red, 2 = amber, 1 = slate-blue
          const color = hit
            ? hit.domains.length >= 3 ? '#f87171' : hit.domains.length === 2 ? '#fbbf24' : '#94a3b8'
            : null;
          const title = hit
            ? `${getStateName(abbr)} — ≥2σ: ${hit.domains.map(d => DOMAIN_LABEL[d]).join(', ')}`
            : getStateName(abbr);
          return (
            <g key={abbr} aria-label={title}>
              <title>{title}</title>
              <rect x={x} y={y} width={CELL} height={CELL} rx={1.8} fill="rgb(31 41 55)" />
              {color && (
                <rect x={x} y={y} width={CELL} height={CELL} rx={1.8} fill={color} opacity={0.25} stroke={color} strokeWidth={0.6} strokeOpacity={0.9} />
              )}
              <text
                x={x + CELL / 2}
                y={y + CELL / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="3.7"
                fontFamily="ui-monospace, monospace"
                fill={color ? '#f3f4f6' : '#6b7280'}
                opacity={color ? 0.95 : 0.55}
              >
                {abbr}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2.5 flex flex-wrap justify-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-white/45">
          <span className="w-1.5 h-1.5 rounded-full inline-block bg-red-400" /> 3 domains ≥2σ
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-white/45">
          <span className="w-1.5 h-1.5 rounded-full inline-block bg-amber-400" /> 2 domains
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-white/45">
          <span className="w-1.5 h-1.5 rounded-full inline-block bg-slate-400" /> temperature only
        </span>
      </div>
    </div>
  );
}

const STEPS: { n: string; color: string; title: string; body: string; to: string; linkLabel: string }[] = [
  {
    n: '01',
    color: 'text-red-400',
    title: 'The hottest Labor Day weekend on the books',
    body: 'Saturday September 5, the hottest station in Colorado read 105°F. Sunday, 108°F — the statewide average high hit 88°F, +2.4σ for the place and season. Labor Day itself held 106°F while the ground stayed bone-dry: zero statewide precipitation for four straight days.',
    to: '/date/2020-09-06?state=CO',
    linkLabel: 'Open September 6 in Colorado',
  },
  {
    n: '02',
    color: 'text-red-400',
    title: 'Then the floor gave out',
    body: 'Tuesday September 8, the statewide average high fell 20°F in a single day — a day-over-day swing of −6.3σ. Wednesday it fell another 20°F, to 43°F. Overnight lows ran −3.4σ to −4.0σ. Three days after the hottest reading of the weekend, one station bottomed out at 5°F.',
    to: '/date/2020-09-08?state=CO',
    linkLabel: 'Open September 8 in Colorado',
  },
  {
    n: '03',
    color: 'text-blue-300',
    title: 'Snow, 48 hours after 108°F',
    body: 'The same front carried +3σ precipitation, and it fell as snow: half an inch statewide-average Tuesday, 2.3 inches Wednesday. September snow in Colorado is so rare the archive can’t even compute a z-score for it — the baseline has nothing to compare against. The inches stand as raw receipts.',
    to: '/date/2020-09-09?state=CO',
    linkLabel: 'Open September 9 in Colorado',
  },
  {
    n: '04',
    color: 'text-amber-400',
    title: 'Nine states off the charts at once',
    body: 'Wednesday September 9 wasn’t a Colorado story — it was a map story. Nine states sat ≥2σ from their place-and-season baselines simultaneously; seven of them in two or more independent domains. Kansas, Nebraska, and New Mexico ran temperature, precipitation, and snow anomalies all at once. In the panel’s 20-year record, it stands as one of the two widest strange-weather days.',
    to: '/date/2020-09-09?state=NM',
    linkLabel: 'Open September 9 in New Mexico',
  },
];

export default function CascadeSept2020Page() {
  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col">
      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-16 space-y-10">
          <InnerHeader
            title="THE MUSEUM · STRANGEST DAYS"
            subtitle="a verified replay — every point a real reading"
          />

          {/* Title */}
          <header className="space-y-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-cyan-400/70">Strangest days · September 2020</p>
            <h1 className="font-display text-3xl sm:text-4xl text-white/95 leading-tight">
              The weekend the weather snapped
            </h1>
            <p className="font-body text-base text-white/60 leading-relaxed">
              Labor Day weekend, 2020. Colorado's hottest station read 105°F on Saturday and 108°F on Sunday.
              By Tuesday it was snowing. This is the archive replaying 8 days — every point below is a real
              reading, none interpolated. And the archive shows it wasn't just Colorado: on Wednesday
              September 9, nine states were off their place-and-season baselines at the same time.
            </p>
          </header>

          {/* The ribbon — Colorado's cliff */}
          <section className="border border-white/[0.07] rounded-xl bg-gray-900/40 p-3 sm:p-4">
            <CascadeRibbon dataset={SEPT2020_DATASET} />
          </section>

          {/* The breadth — nine states at once */}
          <section className="space-y-4">
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40">It wasn't just Colorado</h2>
            <p className="font-body text-sm text-white/55 leading-relaxed">
              September 9, 2020: nine states ≥2σ from baseline at once. All nine broke on temperature;
              seven broke in two or more independent weather domains.
            </p>
            <div className="border border-white/[0.07] rounded-xl bg-gray-900/40 p-3 sm:p-4">
              <StrangeStatesMap />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATES_AFFECTED.map(s => (
                <Link
                  key={s.abbr}
                  to={`/date/2020-09-09?state=${s.abbr}`}
                  className="px-2 py-1 rounded border border-white/[0.08] bg-white/[0.03] hover:border-cyan-400/30 transition-colors text-[10px] font-mono text-white/55 hover:text-white/80"
                >
                  {s.abbr} · {s.domains.map(d => DOMAIN_LABEL[d]).join(' + ')}
                </Link>
              ))}
            </div>
          </section>

          {/* Walkthrough */}
          <section className="space-y-6">
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40">How it unfolded</h2>
            {STEPS.map(step => (
              <div key={step.n} className="flex gap-4">
                <span className={`font-mono text-sm font-bold ${step.color} shrink-0 w-6 pt-0.5`}>{step.n}</span>
                <div className="min-w-0 space-y-2">
                  <h3 className="font-display text-lg text-white/90 leading-snug">{step.title}</h3>
                  <p className="font-body text-sm text-white/55 leading-relaxed">{step.body}</p>
                  <Link
                    to={step.to}
                    className="inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-400/70 hover:text-cyan-400 transition-colors"
                  >
                    {step.linkLabel} <ArrowRight size={11} />
                  </Link>
                </div>
              </div>
            ))}
          </section>

          {/* Cite this cascade */}
          <CiteBlock
            label="Cite this cascade"
            citation={`Duck Countdown Environmental Archive, "The weekend the weather snapped" — Strangest Days, September 2020. 7.6M+ records across 25+ domains, 1950–present. duckcountdown.com/cascade/sept-2020-whiplash. Retrieved ${retrievedToday()}.`}
          />

          {/* Closing — sibling cascade + the court */}
          <section className="border-t border-white/[0.06] pt-6 space-y-3">
            <Link
              to="/cascade/july-2026-heat"
              className="group flex items-center gap-3 rounded-lg border border-white/[0.08] bg-gray-900/50 hover:border-violet-400/30 transition-colors p-4"
            >
              <span className="font-mono text-xs text-violet-300/70 shrink-0">↝</span>
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm text-white/75 leading-snug">
                  Another day the layers moved together — the July 2026 heat wave the birds saw coming.
                </p>
                <p className="text-[10px] font-mono text-white/35 mt-0.5">The Cascade · July 2026</p>
              </div>
              <ArrowRight size={15} className="text-violet-300/50 group-hover:text-violet-300 transition-colors shrink-0" />
            </Link>
            <Link
              to="/court"
              className="group flex items-center gap-3 rounded-lg border border-white/[0.08] bg-gray-900/50 hover:border-cyan-400/30 transition-colors p-4"
            >
              <Scale size={18} className="text-cyan-400/70 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm text-white/75 leading-snug">
                  Patterns like this stand trial as registered claims — watch the record.
                </p>
                <p className="text-[10px] font-mono text-white/35 mt-0.5">
                  Filed before the outcome · graded against matched controls
                </p>
              </div>
              <ArrowRight size={15} className="text-cyan-400/50 group-hover:text-cyan-400 transition-colors shrink-0" />
            </Link>
          </section>
          <InnerFooter current="cascade" />

        </div>
      </main>

      <div className="grain-overlay" />
    </div>
  );
}

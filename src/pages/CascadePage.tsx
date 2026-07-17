import { Link } from 'react-router-dom';
import { ArrowRight, Scale } from 'lucide-react';
import { InnerHeader, InnerFooter } from '@/components/InnerNav';
import CascadeRibbon from '@/components/CascadeRibbon';
import CiteBlock, { retrievedToday } from '@/components/CiteBlock';

/**
 * /cascade/july-2026-heat — "The Cascade".
 *
 * The proof-shot. A verified retrodiction of the July 2026 East Coast heat
 * wave: the thermometer was silent while the ground, the ocean, and the birds
 * moved 1–2 weeks early. Everything past-tense — the archive replays 25 days,
 * it never "predicts".
 */

const STEPS: { n: string; color: string; title: string; body: string; to: string; linkLabel: string }[] = [
  {
    n: '01',
    color: 'text-amber-400',
    title: 'The ground had already given up',
    body: 'Weeks out, six of eight states were intensifying. Delaware’s severe-drought area hit 100% by June 9; North Carolina was already at D4. The runway was bone-dry — the same fingerprint that preceded both prior events.',
    to: '/date/2026-06-09?state=DE',
    linkLabel: 'Open June 9 in Delaware',
  },
  {
    n: '02',
    color: 'text-teal-400',
    title: 'The coastal ocean ran a fever',
    body: 'Through the third week of June the buoys off the mid-Atlantic climbed past +3σ — New Jersey peaked at +4.1σ, Delaware +3.4σ. Warm water banked the heat offshore roughly two weeks before land felt it.',
    to: '/date/2026-06-18?state=DE',
    linkLabel: 'Open June 18 in Delaware',
  },
  {
    n: '03',
    color: 'text-violet-400',
    title: 'Then the birds went silent',
    body: 'On June 21 — eleven days before the peak — radar and acoustic counts in Maryland and Delaware fell 86% overnight. By June 28 the skies read 100% absent. The biological layer emptied out ahead of the heat.',
    to: '/date/2026-06-21?state=MD',
    linkLabel: 'Open June 21 in Maryland',
  },
  {
    n: '04',
    color: 'text-red-400',
    title: 'The heat arrived last',
    body: 'Maryland highs stayed normal until roughly four days out, then went vertical: 100°F on July 1, 103°F on July 2 (z +3.8), 106°F on July 3. The thermometer was the final layer to speak, not the first.',
    to: '/date/2026-07-02?state=MD',
    linkLabel: 'Open July 2 in Maryland',
  },
];

export default function CascadePage() {
  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col">
      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-16 space-y-10">
          <InnerHeader
            title="THE MUSEUM · STRANGEST DAYS"
            subtitle="a verified replay — every line a real reading"
          />

          {/* Title */}
          <header className="space-y-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-cyan-400/70">The Cascade · July 2026</p>
            <h1 className="font-display text-3xl sm:text-4xl text-white/95 leading-tight">
              The heat wave the layers saw coming
            </h1>
            <p className="font-body text-base text-white/60 leading-relaxed">
              The thermometer was silent. The ground, the ocean, and the birds were not. This is the archive
              replaying 25 days — every line below is a real reading, not a forecast. The heat arrived on
              July 2. Three coupled layers had already broken normal, one of them eleven days earlier.
            </p>
          </header>

          {/* The ribbon */}
          <section className="border border-white/[0.07] rounded-xl bg-gray-900/40 p-3 sm:p-4">
            <CascadeRibbon />
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
            citation={`Duck Countdown Environmental Archive, "The heat wave the layers saw coming" — The Cascade, July 2026. 7.6M+ records across 25+ domains, 1950–present. duckcountdown.com/cascade/july-2026-heat. Retrieved ${retrievedToday()}.`}
          />

          {/* Closing — to the court */}
          <section className="border-t border-white/[0.06] pt-6">
            <Link
              to="/court"
              className="group flex items-center gap-3 rounded-lg border border-white/[0.08] bg-gray-900/50 hover:border-cyan-400/30 transition-colors p-4"
            >
              <Scale size={18} className="text-cyan-400/70 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm text-white/75 leading-snug">
                  The pattern is now a registered claim — watch it stand trial.
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

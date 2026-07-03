import { useEffect } from 'react';
import { Scale, Gavel, Flame, CheckCircle2, XCircle, FlaskConical, Landmark } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import UserMenu from '@/components/UserMenu';
import Denominator from '@/components/Denominator';
import CountdownClock from '@/components/salvage/CountdownClock';
import { useClaims, useClaimFires, type Claim, type ClaimFire } from '@/hooks/useClaims';

/**
 * /court — the docket. Every claim registered before the outcome, graded
 * against matched control windows, published win or lose.
 */

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3600000) return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

const STATUS_CHIP: Record<string, string> = {
  active: 'bg-cyan-400/10 text-cyan-400 border-cyan-400/20',
  on_trial: 'bg-cyan-400/10 text-cyan-400 border-cyan-400/20',
  confirmed: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  proven: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  failed: 'bg-red-400/10 text-red-400 border-red-400/20',
  rejected: 'bg-red-400/10 text-red-400 border-red-400/20',
  retired: 'bg-white/[0.04] text-white/40 border-white/10',
};

function SectionHeader({ icon: Icon, title, count }: { icon: typeof Scale; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} className="text-cyan-400/70" />
      <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/50">{title}</h2>
      {count != null && <span className="text-[10px] font-mono text-white/25">{count}</span>}
    </div>
  );
}

function ClaimCard({ claim }: { claim: Claim }) {
  const name = claim.name || (claim.claim_name as string) || 'Unnamed claim';
  const hypothesis = claim.hypothesis || (claim.claim_text as string) || '';
  const notes = typeof claim.notes === 'string' ? claim.notes : '';
  const isBenchmark = /benchmark/i.test(notes);
  const status = (claim.status || 'active').toLowerCase();

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-display text-sm text-white/90 leading-snug">{name}</h3>
        <span className={`shrink-0 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_CHIP[status] || STATUS_CHIP.active}`}>
          {status.replace(/_/g, ' ')}
        </span>
      </div>

      {hypothesis && (
        <p className="text-xs font-body text-white/60 leading-relaxed mb-2">{hypothesis}</p>
      )}

      {isBenchmark && (
        <div className="flex items-start gap-1.5 mb-2">
          <span className="shrink-0 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20 mt-px">
            Benchmark
          </span>
          <span className="text-[10px] font-body text-white/35 leading-snug">
            known physics — if the court can't confirm this, the court is broken
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-gray-800/60 text-[9px] font-mono text-white/30">
        {claim.source && <span className="truncate">source: {String(claim.source)}</span>}
        {claim.registered_at && (
          <span className="ml-auto shrink-0">registered {timeAgo(claim.registered_at)}</span>
        )}
      </div>
    </div>
  );
}

function LiveFireRow({ fire }: { fire: ClaimFire }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-800/50 last:border-b-0">
      <Flame size={12} className="text-amber-400 shrink-0" />
      <span className="text-xs font-mono text-white/80 w-8 shrink-0">{fire.state_abbr || '—'}</span>
      <span className="text-[10px] font-mono text-white/35 flex-1 min-w-0 truncate">
        fired {timeAgo(fire.fired_at)}
      </span>
      {fire.window_end ? (
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-mono text-white/30">window closes</span>
          <CountdownClock deadline={fire.window_end} />
        </span>
      ) : (
        <span className="text-[9px] font-mono text-white/25 shrink-0">no window</span>
      )}
    </div>
  );
}

function VerdictRow({ fire }: { fire: ClaimFire }) {
  const hit = fire.hit === true;
  const liftText = fire.lift != null ? Number(fire.lift).toFixed(2) : '—';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 border-b border-gray-800/50 last:border-b-0">
      {hit ? (
        <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
      ) : (
        <XCircle size={12} className="text-red-400 shrink-0" />
      )}
      <span className={`text-[10px] font-mono font-bold uppercase tracking-wider w-8 shrink-0 ${hit ? 'text-emerald-400' : 'text-red-400'}`}>
        {hit ? 'HIT' : 'MISS'}
      </span>
      <span className="text-xs font-mono text-white/80 w-8 shrink-0">{fire.state_abbr || '—'}</span>
      <span className="text-[10px]">
        <Denominator n={fire.control_n} k={fire.control_hits} label="controls" />
        <span className="font-mono tabular-nums text-white/50"> · lift {liftText}</span>
      </span>
      <span className="text-[9px] font-mono text-white/25 ml-auto shrink-0">{timeAgo(fire.fired_at)}</span>
    </div>
  );
}

function OpeningStatements() {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 text-center">
      <Gavel size={20} className="text-cyan-400/50 mx-auto mb-3" />
      <p className="text-sm font-body text-white/60 leading-relaxed max-w-md mx-auto mb-2">
        This is the docket. Claims are registered here before their outcomes exist,
        each fires against real conditions, and every window is graded against
        matched controls when it closes.
      </p>
      <p className="text-xs font-body text-white/35">
        The first claims are being registered. Verdicts land as their windows close.
      </p>
    </div>
  );
}

function TheRecord() {
  return (
    <section>
      <SectionHeader icon={Landmark} title="The Record" />
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-5 space-y-4">
        <h3 className="font-display text-base text-white/90">The convergence index, 2026 — a postmortem</h3>

        <div className="space-y-3 text-xs font-body text-white/60 leading-relaxed">
          <p>
            We built a convergence index — a single score summing activity across 11
            environmental domains for every state, every day. It looked alive. It fired
            alerts. So we put it on trial, five independent ways.
          </p>
          <p>
            Matched-control regrading of 4,874 alerts: zero lift — bird spikes hit 8.2%
            on alert days vs 8.0% on random days. Score-quantile analysis: the apparent
            2–3x lift dissolved into seasonality and geography — the index "predicted"
            earthquakes at 4.1x, which is impossible. An anomaly reformulation, rebuilt
            artifact-free: still flat. And a systematic search of 2,304 candidate formulas
            with train/test discipline: 479 training winners, 0 novel survivors. The search
            did rediscover textbook meteorology along the way — proof the method finds real
            signal when signal exists.
          </p>
          <p>
            The index was a seasonal calendar wearing a costume. We killed it. This court
            exists so that nothing like it ever ships here again.
          </p>
          <p className="text-white/70 border-l-2 border-cyan-400/40 pl-3">
            What IS proven: drought, ocean, and bird-silence signals led the July 2026 heat
            wave by 7–11 days while the thermometers were still silent. That retrodiction is
            registered as claims above — on trial now, graded the same way everything else is.
          </p>
        </div>
      </div>
    </section>
  );
}

export default function CourtPage() {
  const { claims, status: claimsStatus } = useClaims();
  const { fires, status: firesStatus } = useClaimFires();

  useEffect(() => {
    document.title = 'The Court — Duck Countdown';
    return () => { document.title = 'Duck Countdown | Environmental Intelligence Platform'; };
  }, []);

  const docketOpen = claimsStatus === 'ready' && claims.length > 0;
  const liveFires = firesStatus === 'ready' ? fires.filter(f => f.evaluated === false) : [];
  const verdicts = firesStatus === 'ready' ? fires.filter(f => f.evaluated === true) : [];
  const loading = claimsStatus === 'loading';

  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col">
      <AppHeader>
        <UserMenu />
      </AppHeader>

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-8 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-8">
          {/* Masthead */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Scale size={18} className="text-cyan-400/70" />
              <h1 className="font-display text-xl sm:text-2xl text-white/90">The Court</h1>
            </div>
            <p className="text-sm font-body text-white/50 leading-relaxed">
              Every claim this system makes is registered before the outcome, graded against
              matched control windows, and published — hits, misses, and base rates.
              No receipts, no claim.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-xs font-mono text-white/30 tracking-widest uppercase animate-pulse">
                Opening the docket...
              </span>
            </div>
          ) : !docketOpen ? (
            <section>
              <SectionHeader icon={Gavel} title="Opening Statements" />
              <OpeningStatements />
            </section>
          ) : (
            <>
              {/* Active claims */}
              <section>
                <SectionHeader icon={FlaskConical} title="Active Claims" count={claims.length} />
                <div className="space-y-3">
                  {claims.map(claim => (
                    <ClaimCard key={claim.id} claim={claim} />
                  ))}
                </div>
              </section>

              {/* Live fires */}
              <section>
                <SectionHeader icon={Flame} title="Live Fires" count={liveFires.length} />
                <div className="bg-gray-900 rounded-lg border border-gray-800">
                  {liveFires.length === 0 ? (
                    <p className="text-[11px] font-body text-white/30 text-center py-6">
                      No claims firing right now. The court waits for conditions.
                    </p>
                  ) : (
                    liveFires.map(fire => <LiveFireRow key={fire.id} fire={fire} />)
                  )}
                </div>
              </section>

              {/* Verdict feed */}
              <section>
                <SectionHeader icon={Gavel} title="Verdict Feed" count={verdicts.length} />
                <div className="bg-gray-900 rounded-lg border border-gray-800">
                  {verdicts.length === 0 ? (
                    <p className="text-[11px] font-body text-white/30 text-center py-6">
                      No verdicts yet. The first windows are still open.
                    </p>
                  ) : (
                    verdicts.map(fire => <VerdictRow key={fire.id} fire={fire} />)
                  )}
                </div>
              </section>
            </>
          )}

          <TheRecord />
        </div>
      </main>
    </div>
  );
}

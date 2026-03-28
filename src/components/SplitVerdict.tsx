import { useMemo } from 'react';
import type { StateArc } from '@/hooks/useStateArcs';

interface Props {
  arc: StateArc;
}

const SIGNAL_LABELS: Record<string, string> = {
  'nws-alert': 'NWS Alert',
  'weather-event': 'Weather Event',
  'storm-event': 'Storm Event',
  'migration-spike': 'Migration Spike',
  'migration-spike-extreme': 'Extreme Spike',
  'migration-spike-significant': 'Sig. Spike',
  'anomaly-alert': 'Anomaly',
};

export default function SplitVerdict({ arc }: Props) {
  const claim = arc.recognition_claim as { claim?: string; expected_signals?: string[]; pattern_type?: string } | null;
  const expectedSignals = claim?.expected_signals || [];
  const foundSignals = arc.outcome_signals || [];
  const totalExpected = Math.max(expectedSignals.length, 1);
  const foundCount = foundSignals.length;
  const confirmPct = Math.min(100, (foundCount / totalExpected) * 100);

  const timeRemaining = useMemo(() => {
    if (!arc.outcome_deadline) return null;
    const deadline = new Date(arc.outcome_deadline).getTime();
    const now = Date.now();
    const remaining = deadline - now;
    if (remaining <= 0) return { label: 'EXPIRED', pct: 0, urgent: true };
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const hrs = hours % 24;
    const total = new Date(arc.outcome_deadline).getTime() - new Date(arc.act_started_at).getTime();
    const elapsed = now - new Date(arc.act_started_at).getTime();
    const pct = Math.max(0, Math.min(100, (1 - elapsed / total) * 100));
    return {
      label: days > 0 ? `${days}d ${hrs}h` : `${hrs}h`,
      pct,
      urgent: hours < 24,
    };
  }, [arc.outcome_deadline, arc.act_started_at]);

  return (
    <div>
      <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-2">Outcome Verdict</div>

      {/* Claim */}
      {claim?.claim && (
        <div className="text-[10px] font-mono text-white/40 mb-2 italic">
          "{claim.claim}"
        </div>
      )}

      {/* Split bars */}
      <div className="flex gap-2 mb-2">
        {/* Confirm side */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-mono text-emerald-400/60 uppercase tracking-widest">Confirmed</span>
            <span className="text-[10px] font-mono text-emerald-400/80 font-bold">{foundCount}/{totalExpected}</span>
          </div>
          <div className="h-3 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full transition-all duration-1000"
              style={{ width: `${confirmPct}%`, opacity: 0.7 }}
            />
          </div>
        </div>

        {/* Time side */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-mono text-amber-400/60 uppercase tracking-widest">Time Left</span>
            <span className={`text-[10px] font-mono font-bold ${timeRemaining?.urgent ? 'text-red-400/80' : 'text-amber-400/80'}`}>
              {timeRemaining?.label || '—'}
            </span>
          </div>
          <div className="h-3 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${timeRemaining?.urgent ? 'bg-red-400' : 'bg-amber-400'}`}
              style={{ width: `${timeRemaining?.pct || 0}%`, opacity: 0.7 }}
            />
          </div>
        </div>
      </div>

      {/* Expected signals checklist */}
      <div className="space-y-0.5">
        {expectedSignals.map((sig, i) => {
          const found = foundSignals.some((f: any) => {
            const source = f.source?.toLowerCase() || '';
            const signal = f.signal?.toLowerCase() || '';
            const matchType = f.match_type?.toLowerCase() || '';
            return source.includes(sig) || signal.includes(sig.replace('-', '_')) || matchType.includes('confirm');
          });
          return (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full flex items-center justify-center text-[7px] ${
                found ? 'bg-emerald-400/20 text-emerald-400' : 'bg-white/[0.04] text-white/20'
              }`}>
                {found ? '✓' : '·'}
              </div>
              <span className={`text-[9px] font-mono ${found ? 'text-emerald-400/60' : 'text-white/25'}`}>
                {SIGNAL_LABELS[sig] || sig}
              </span>
            </div>
          );
        })}
      </div>

      {/* Found signal details */}
      {foundSignals.length > 0 && (
        <div className="mt-2 space-y-1">
          {(foundSignals as any[]).map((sig, i) => (
            <div key={i} className="text-[9px] font-mono text-emerald-400/40 bg-emerald-400/[0.04] rounded px-1.5 py-0.5">
              {sig.signal?.slice(0, 60) || sig.source}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

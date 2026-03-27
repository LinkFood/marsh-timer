import { Target, Clock } from 'lucide-react';
import CountdownClock from './CountdownClock';

interface ArcClaimCardProps {
  claim: Record<string, unknown>;
  deadline?: string | null;
}

export default function ArcClaimCard({ claim, deadline }: ArcClaimCardProps) {
  const claimText = (claim.claim_text as string) || (claim.text as string) || '';
  const expectedSignals = Array.isArray(claim.expected_signals) ? (claim.expected_signals as string[]) : [];
  const patternType = (claim.pattern_type as string) || '';

  if (!claimText && expectedSignals.length === 0 && !patternType) {
    return (
      <div className="bg-gray-950/50 rounded-lg p-4 border border-orange-400/20">
        <div className="flex items-center gap-2">
          <Target size={12} className="text-orange-400/40" />
          <span className="text-xs font-mono text-white/20">No claim recorded</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-950/50 rounded-lg p-4 border border-orange-400/20">
      <div className="flex items-center gap-2 mb-3">
        <Target size={12} className="text-orange-400" />
        <h4 className="text-[10px] font-mono uppercase tracking-widest text-orange-400">Recognition Claim</h4>
      </div>

      {claimText && (
        <p className="text-xs font-mono text-white/70 leading-relaxed mb-3">
          <span className="text-orange-400/80">The brain claims:</span> {claimText}
        </p>
      )}

      {expectedSignals.length > 0 && (
        <div className="mb-3">
          <span className="text-[9px] font-mono text-white/40 uppercase">Expected signals</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {expectedSignals.map((sig, i) => (
              <span key={i} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-orange-400/10 text-orange-400/80">
                {sig}
              </span>
            ))}
          </div>
        </div>
      )}

      {patternType && (
        <div className="mb-3">
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-400 uppercase">
            {patternType}
          </span>
        </div>
      )}

      {deadline && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-800/50">
          <Clock size={10} className="text-white/30" />
          <span className="text-[9px] font-mono text-white/40">Deadline:</span>
          <CountdownClock deadline={deadline} />
        </div>
      )}
    </div>
  );
}

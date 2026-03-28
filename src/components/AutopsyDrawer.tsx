import type { StateArc } from '@/hooks/useStateArcs';

const GRADE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  confirmed: { label: 'CONFIRMED', color: '#22c55e', icon: '✓' },
  partially_confirmed: { label: 'PARTIAL', color: '#f59e0b', icon: '◐' },
  missed: { label: 'MISSED', color: '#ef4444', icon: '✗' },
  false_alarm: { label: 'FALSE ALARM', color: '#ef4444', icon: '✗' },
};

interface Props {
  arc: StateArc;
}

export default function AutopsyDrawer({ arc }: Props) {
  const grade = arc.grade || '';
  const config = GRADE_CONFIG[grade] || GRADE_CONFIG.missed;
  const claim = arc.recognition_claim as { claim?: string; expected_signals?: string[]; pattern_type?: string } | null;
  const expectedSignals = claim?.expected_signals || [];
  const foundSignals = (arc.outcome_signals || []) as Array<{ signal?: string; source?: string; match_type?: string }>;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">Grade</span>
        <div className="flex items-center gap-1.5">
          <span className="text-sm" style={{ color: config.color }}>{config.icon}</span>
          <span className="text-[10px] font-mono font-bold" style={{ color: config.color }}>
            {config.label}
          </span>
        </div>
      </div>

      {/* Two-column expected vs actual */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        {/* Expected */}
        <div>
          <div className="text-[8px] font-mono text-white/20 uppercase tracking-widest mb-1">Expected</div>
          <div className="space-y-0.5">
            {expectedSignals.length > 0 ? expectedSignals.map((sig, i) => (
              <div key={i} className="text-[9px] font-mono text-white/30 bg-white/[0.03] rounded px-1.5 py-0.5">
                {sig}
              </div>
            )) : (
              <div className="text-[9px] font-mono text-white/15 italic">No signals specified</div>
            )}
          </div>
        </div>

        {/* Actual */}
        <div>
          <div className="text-[8px] font-mono text-white/20 uppercase tracking-widest mb-1">Actual</div>
          <div className="space-y-0.5">
            {foundSignals.length > 0 ? foundSignals.map((sig, i) => (
              <div key={i} className="text-[9px] font-mono text-emerald-400/40 bg-emerald-400/[0.04] rounded px-1.5 py-0.5">
                {sig.signal?.slice(0, 40) || sig.source || 'Signal'}
              </div>
            )) : (
              <div className="text-[9px] font-mono text-red-400/30 italic">No signals found</div>
            )}
          </div>
        </div>
      </div>

      {/* Grade reasoning from Opus */}
      {arc.grade_reasoning && (
        <div>
          <div className="text-[8px] font-mono text-white/20 uppercase tracking-widest mb-1">Post-Mortem</div>
          <p className="text-[10px] font-mono text-white/40 leading-relaxed line-clamp-5">
            {arc.grade_reasoning}
          </p>
        </div>
      )}
    </div>
  );
}

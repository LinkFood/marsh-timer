import { AlertTriangle, Clock, MapPin, Shield, ShieldCheck, ShieldX, ShieldQuestion } from 'lucide-react';
import { useDisasterWatch } from '@/hooks/useDisasterWatch';
import type { PanelComponentProps } from './PanelTypes';

const TYPE_STYLES: Record<string, { border: string; badge: string; label: string }> = {
  cold_outbreak: { border: 'border-blue-500', badge: 'bg-blue-500/20 text-blue-400', label: 'COLD OUTBREAK' },
  hurricane_season: { border: 'border-orange-500', badge: 'bg-orange-500/20 text-orange-400', label: 'HURRICANE' },
  major_flooding: { border: 'border-cyan-500', badge: 'bg-cyan-500/20 text-cyan-400', label: 'FLOODING' },
  severe_drought: { border: 'border-amber-500', badge: 'bg-amber-500/20 text-amber-400', label: 'DROUGHT' },
};

const DEFAULT_STYLE = { border: 'border-red-500', badge: 'bg-red-500/20 text-red-400', label: 'WATCH' };

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function OutcomeBadge({ grade }: { grade?: string }) {
  if (!grade) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[8px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/30">
        <ShieldQuestion size={8} /> PENDING
      </span>
    );
  }
  if (grade === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[8px] font-mono px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
        <ShieldCheck size={8} /> CONFIRMED
      </span>
    );
  }
  if (grade === 'missed' || grade === 'false_alarm') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[8px] font-mono px-1 py-0.5 rounded bg-red-500/20 text-red-400">
        <ShieldX size={8} /> {grade === 'missed' ? 'MISSED' : 'FALSE ALARM'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[8px] font-mono px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
      <Shield size={8} /> {grade.toUpperCase()}
    </span>
  );
}

export default function DisasterWatchPanel({}: PanelComponentProps) {
  const { watches, loading } = useDisasterWatch();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading disaster watch...
      </div>
    );
  }

  if (watches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/40 text-xs text-center px-4 gap-2">
        <AlertTriangle size={20} className="text-white/20" />
        <p>No active climate warnings.</p>
        <p className="text-[10px] text-white/25">The system monitors AO, NAO, PDO, ENSO, and PNA indices for pre-disaster signatures.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-1 p-2">
          {watches.map((w) => {
            const style = TYPE_STYLES[w.metadata.disaster_type || ''] || DEFAULT_STYLE;
            const confidence = w.metadata.confidence ?? 0;

            return (
              <div
                key={w.id}
                className={`px-2 py-1.5 rounded bg-white/[0.02] hover:bg-white/[0.06] transition-colors border-l-2 ${style.border}`}
              >
                {/* Header: type badge + confidence + time */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${style.badge}`}>
                    {style.label}
                  </span>
                  {w.state_abbr && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-white/50">
                      <MapPin size={8} className="text-white/30" /> {w.state_abbr}
                    </span>
                  )}
                  <OutcomeBadge grade={w.outcome_grade} />
                  <span className="text-[9px] font-mono text-white/20 ml-auto whitespace-nowrap">
                    {timeAgo(w.created_at)}
                  </span>
                </div>

                {/* Title */}
                <p className="text-[11px] text-white/80 mt-1 leading-tight">{w.title}</p>

                {/* Confidence bar */}
                {confidence > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${confidence >= 70 ? 'bg-red-500' : confidence >= 40 ? 'bg-amber-500' : 'bg-white/20'}`}
                        style={{ width: `${Math.min(confidence, 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-white/40">{confidence}%</span>
                  </div>
                )}

                {/* Conditions met */}
                {w.metadata.conditions_met && w.metadata.conditions_met.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {w.metadata.conditions_met.map((c, i) => (
                      <span key={i} className="text-[9px] font-mono text-white/35 leading-tight">
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                {/* Historical precedents */}
                {w.metadata.historical_precedents && w.metadata.historical_precedents.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {w.metadata.historical_precedents.map((p, i) => (
                      <span key={i} className="text-[8px] font-mono text-cyan-400/50 bg-cyan-400/[0.06] px-1 py-0.5 rounded">
                        {p}
                      </span>
                    ))}
                  </div>
                )}

                {/* Lead time */}
                {w.metadata.lead_time && (
                  <div className="flex items-center gap-0.5 mt-1">
                    <Clock size={8} className="text-white/25" />
                    <span className="text-[9px] font-mono text-white/30">Window: {w.metadata.lead_time}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { useConvergenceAlerts } from '@/hooks/useConvergenceAlerts';
import { useMapAction } from '@/contexts/MapActionContext';
import { useDeck } from '@/contexts/DeckContext';
import type { PanelComponentProps } from './PanelTypes';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ConvergenceAlertsPanel({}: PanelComponentProps) {
  const { alerts, loading } = useConvergenceAlerts();
  const { flyTo } = useMapAction();
  const { setSelectedState } = useDeck();

  function handleClick(abbr: string) {
    flyTo(abbr);
    setSelectedState(abbr);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading alerts...
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No alerts today
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto h-full p-2">
      {alerts.map((a, i) => {
        const isSurge = a.alert_type === 'surge' || a.score > a.previous_score;
        return (
          <button
            key={`${a.state_abbr}-${i}`}
            onClick={() => handleClick(a.state_abbr)}
            className={`flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] transition-colors text-left w-full border-l-2 ${isSurge ? 'border-emerald-400' : 'border-red-400'}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`text-sm font-mono font-bold ${isSurge ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isSurge ? '\u25B2' : '\u25BC'}
                </span>
                <span className="text-xs font-mono text-white/90 font-medium">{a.state_abbr}</span>
                <span className="text-[10px] text-white/40 font-mono">
                  {a.previous_score} → {a.score}
                </span>
                <span className={`text-[10px] font-mono px-1 rounded ${isSurge ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>
                  {isSurge ? '+' : ''}{a.score - a.previous_score}
                </span>
              </div>
              <p className="text-[10px] text-white/40 mt-0.5 truncate">{a.reasoning}</p>
            </div>
            <span className="text-[9px] font-mono text-white/20 whitespace-nowrap mt-0.5">
              {timeAgo(a.created_at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

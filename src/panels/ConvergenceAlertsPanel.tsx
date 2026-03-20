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
        const isSurge = a.alert_type === 'surge' || a.score_after > a.score_before;
        return (
          <button
            key={`${a.state_abbr}-${i}`}
            onClick={() => handleClick(a.state_abbr)}
            className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] transition-colors text-left w-full"
          >
            <span className={`text-xs mt-0.5 ${isSurge ? 'text-green-400' : 'text-red-400'}`}>
              {isSurge ? '\u25B2' : '\u25BC'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-white/90">{a.state_abbr}</span>
                <span className="text-[10px] text-white/40 font-mono">
                  {a.score_before} → {a.score_after}
                </span>
              </div>
              <p className="text-[10px] text-white/50 truncate">{a.message}</p>
            </div>
            <span className="text-[10px] text-white/30 whitespace-nowrap mt-0.5">
              {timeAgo(a.created_at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

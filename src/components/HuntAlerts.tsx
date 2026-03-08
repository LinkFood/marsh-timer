import { AlertTriangle } from "lucide-react";
import type { HuntAlert } from "../hooks/useHuntAlerts";

interface HuntAlertsProps {
  alerts: HuntAlert[];
  stateAbbr?: string | null;
  onSelectState?: (abbr: string) => void;
}

function severityClasses(severity: "high" | "medium") {
  return severity === "high"
    ? { text: "text-red-400", border: "border-red-400/20", bg: "bg-red-400/10", badge: "bg-red-400/20 text-red-400" }
    : { text: "text-amber-400", border: "border-amber-400/20", bg: "bg-amber-400/10", badge: "bg-amber-400/20 text-amber-400" };
}

function NationalAlerts({
  alerts,
  onSelectState,
}: {
  alerts: HuntAlert[];
  onSelectState?: (abbr: string) => void;
}) {
  if (alerts.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-body text-white/40 uppercase tracking-wider mb-1.5">Notable Hunting Weather</p>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1">
        {alerts.map((alert) => {
          const c = severityClasses(alert.severity);
          return (
            <button
              key={alert.stateAbbr}
              onClick={() => onSelectState?.(alert.stateAbbr)}
              className={`flex-shrink-0 max-w-[200px] w-[200px] rounded-lg border ${c.border} bg-white/5 p-2.5 text-left transition-colors hover:bg-white/[0.08] active:bg-white/[0.1]`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-body font-semibold text-xs text-white/90 truncate">
                  {alert.stateName}
                </span>
                <span
                  className={`flex-shrink-0 ml-1.5 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-body font-semibold ${c.badge}`}
                >
                  {alert.severity}
                </span>
              </div>
              <p className="text-[10px] font-body text-white/50 truncate mb-1">
                {alert.forecastSummary}
              </p>
              {alert.patterns.length > 0 && (
                <div className="flex items-center gap-1">
                  <AlertTriangle className={`w-2.5 h-2.5 flex-shrink-0 ${c.text}`} />
                  <p className={`text-[10px] font-body truncate ${c.text}`}>
                    {alert.patterns[0]}
                  </p>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StateAlertBanner({ alert }: { alert: HuntAlert }) {
  const c = severityClasses(alert.severity);
  const cond = alert.conditions;

  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${c.text}`} />
        <span className={`text-xs font-body font-semibold uppercase tracking-wider ${c.text}`}>
          {alert.severity === "high" ? "High Alert" : "Advisory"}
        </span>
      </div>

      <p className="text-xs font-body text-white/80 mb-2">{alert.forecastSummary}</p>

      {alert.patterns.length > 0 && (
        <ul className="space-y-1 mb-2">
          {alert.patterns.map((pattern, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="text-white/30 text-xs leading-4">-</span>
              <span className="text-xs font-body text-white/60">{pattern}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-body text-white/40">
        {cond.tempDropF > 0 && (
          <span>Temp drop: <span className="text-white/60">{cond.tempDropF}F</span></span>
        )}
        <span>Wind: <span className="text-white/60">{cond.windSpeedMph}mph</span></span>
        <span>Pressure: <span className="text-white/60">{cond.pressureChangeMb}mb swing</span></span>
        {cond.precipMm > 0 && (
          <span>Precip: <span className="text-white/60">{cond.precipMm}mm</span></span>
        )}
      </div>
    </div>
  );
}

export default function HuntAlerts({ alerts, stateAbbr, onSelectState }: HuntAlertsProps) {
  if (alerts.length === 0) return null;

  if (stateAbbr) {
    const match = alerts.find((a) => a.stateAbbr === stateAbbr);
    if (!match) return null;
    return <StateAlertBanner alert={match} />;
  }

  return <NationalAlerts alerts={alerts} onSelectState={onSelectState} />;
}

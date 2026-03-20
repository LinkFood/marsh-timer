import { useState, useMemo } from 'react';
import { AlertTriangle, Thermometer, Wind, Gauge, Droplets } from 'lucide-react';
import { useHuntAlerts } from '@/hooks/useHuntAlerts';
import { useMapAction } from '@/contexts/MapActionContext';
import PanelTabs from '@/components/PanelTabs';
import type { PanelComponentProps } from './PanelTypes';

const SEVERITY_COLORS: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-orange-500/20 text-orange-400',
};

export default function HuntAlertsPanel({}: PanelComponentProps) {
  const { alerts, loading } = useHuntAlerts();
  const { flyTo } = useMapAction();
  const [activeTab, setActiveTab] = useState('all');

  const highAlerts = useMemo(() => alerts.filter(a => a.severity === 'high'), [alerts]);
  const mediumAlerts = useMemo(() => alerts.filter(a => a.severity !== 'high'), [alerts]);
  const filtered = activeTab === 'high' ? highAlerts : activeTab === 'medium' ? mediumAlerts : alerts;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading hunt alerts...
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No active hunt alerts
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PanelTabs
        tabs={[
          { id: 'all', label: 'ALL', count: alerts.length },
          { id: 'high', label: 'HIGH', count: highAlerts.length },
          { id: 'medium', label: 'MEDIUM', count: mediumAlerts.length },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-0.5 p-2">
          {filtered.map((alert, i) => {
            const sevClass = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.medium;
            return (
              <button
                key={i}
                onClick={() => flyTo(alert.stateAbbr)}
                className={`flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] transition-colors text-left w-full border-l-2 ${alert.severity === 'high' ? 'border-red-400' : 'border-orange-400'}`}
              >
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-white/90">{alert.stateAbbr}</span>
                    <span className="text-[10px] font-mono text-white/50">{alert.stateName}</span>
                    <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${sevClass}`}>
                      {alert.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/50 mt-0.5">{alert.forecastSummary}</p>
                  {/* Conditions */}
                  <div className="flex gap-2 mt-1">
                    {alert.conditions.tempDropF > 0 && (
                      <div className="flex items-center gap-0.5">
                        <Thermometer size={8} className="text-orange-400/60" />
                        <span className="text-[8px] font-mono text-orange-400/60">-{alert.conditions.tempDropF}F</span>
                      </div>
                    )}
                    {alert.conditions.windSpeedMph > 0 && (
                      <div className="flex items-center gap-0.5">
                        <Wind size={8} className="text-cyan-400/60" />
                        <span className="text-[8px] font-mono text-cyan-400/60">{alert.conditions.windSpeedMph}mph</span>
                      </div>
                    )}
                    {alert.conditions.pressureChangeMb !== 0 && (
                      <div className="flex items-center gap-0.5">
                        <Gauge size={8} className="text-purple-400/60" />
                        <span className="text-[8px] font-mono text-purple-400/60">{alert.conditions.pressureChangeMb}mb</span>
                      </div>
                    )}
                    {alert.conditions.precipMm > 0 && (
                      <div className="flex items-center gap-0.5">
                        <Droplets size={8} className="text-blue-400/60" />
                        <span className="text-[8px] font-mono text-blue-400/60">{alert.conditions.precipMm}mm</span>
                      </div>
                    )}
                  </div>
                  {/* Patterns */}
                  {alert.patterns.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {alert.patterns.slice(0, 2).map((p, j) => (
                        <span key={j} className="text-[8px] font-mono text-cyan-400/50 bg-cyan-400/[0.06] px-1 py-0.5 rounded">
                          {p.length > 50 ? p.slice(0, 50) + '...' : p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

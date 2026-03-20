import { useMemo } from 'react';
import { AlertTriangle, ShieldAlert, CloudRain, Info } from 'lucide-react';
import { useNWSAlerts } from '@/hooks/useNWSAlerts';
import type { PanelComponentProps } from './PanelTypes';

const SEVERITY_CONFIG: Record<string, { color: string; icon: typeof AlertTriangle }> = {
  Extreme: { color: 'bg-red-500/20 text-red-400', icon: ShieldAlert },
  Severe: { color: 'bg-orange-500/20 text-orange-400', icon: AlertTriangle },
  Moderate: { color: 'bg-yellow-500/20 text-yellow-400', icon: CloudRain },
  Minor: { color: 'bg-blue-500/20 text-blue-400', icon: Info },
};

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function NWSAlertsPanel({}: PanelComponentProps) {
  const { alertsGeoJSON } = useNWSAlerts();

  const alerts = useMemo(() => {
    if (!alertsGeoJSON?.features) return [];
    return alertsGeoJSON.features.map(f => ({
      event: f.properties?.event as string,
      severity: f.properties?.severity as string,
      headline: f.properties?.headline as string,
      onset: f.properties?.onset as string,
      expires: f.properties?.expires as string,
    }));
  }, [alertsGeoJSON]);

  if (!alertsGeoJSON) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading NWS alerts...
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No active NWS alerts
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto h-full p-2">
      {alerts.map((alert, i) => {
        const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.Minor;
        const Icon = config.icon;
        return (
          <div
            key={i}
            className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] transition-colors"
          >
            <Icon size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-white/90">{alert.event}</span>
                <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${config.color}`}>
                  {alert.severity}
                </span>
              </div>
              <p className="text-[10px] text-white/40 mt-0.5 truncate">{alert.headline}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[9px] font-mono text-white/20">
                  {formatTime(alert.onset)} - {formatTime(alert.expires)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

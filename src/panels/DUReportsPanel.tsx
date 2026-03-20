import { useMemo } from 'react';
import { useDUMapReports } from '@/hooks/useDUMapReports';
import { useMapAction } from '@/contexts/MapActionContext';
import { MapPin } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function activityColor(level: string): string {
  const lower = level.toLowerCase();
  if (lower.includes('peak') || lower.includes('high')) return 'text-red-400 bg-red-400/10';
  if (lower.includes('increasing')) return 'text-orange-400 bg-orange-400/10';
  if (lower.includes('moderate')) return 'text-yellow-400 bg-yellow-400/10';
  if (lower.includes('low') || lower.includes('starting')) return 'text-blue-400 bg-blue-400/10';
  if (lower.includes('declining') || lower.includes('ended')) return 'text-white/40 bg-white/[0.04]';
  return 'text-white/50 bg-white/[0.04]';
}

export default function DUReportsPanel({}: PanelComponentProps) {
  const { geojson, loading } = useDUMapReports();
  const { flyToCoords } = useMapAction();

  const reports = useMemo(() => {
    if (!geojson?.features) return [];
    return geojson.features.slice(0, 25).map(f => ({
      ...f.properties,
      lng: (f.geometry as any)?.coordinates?.[0],
      lat: (f.geometry as any)?.coordinates?.[1],
    }));
  }, [geojson]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading DU reports...
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No recent DU migration reports
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-2.5 py-1.5 border-b border-white/[0.06] text-[10px] font-mono text-white/30">
        {reports.length} reports
      </div>
      <div className="flex-1 overflow-y-auto">
        {reports.map((r, i) => {
          const location = [r?.location_name, r?.state_abbr].filter(Boolean).join(', ');
          const activity = r?.activity_level || '';
          return (
            <button
              key={i}
              onClick={() => r?.lng && r?.lat && flyToCoords(r.lng, r.lat, 8)}
              className="flex items-start gap-2 px-2.5 py-1.5 w-full text-left hover:bg-white/[0.03] transition-colors border-b border-white/[0.03]"
            >
              <MapPin size={10} className="text-cyan-400/60 mt-1 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-white/70">{location || 'Unknown'}</span>
                  <span className="text-[9px] font-mono text-white/20">{formatDate(r?.submit_date || '')}</span>
                </div>
                {activity && (
                  <span className={`text-[9px] font-mono px-1 py-0.5 rounded mt-0.5 inline-block ${activityColor(activity)}`}>
                    {activity}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

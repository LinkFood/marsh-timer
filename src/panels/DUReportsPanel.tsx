import { useDUMapReports } from '@/hooks/useDUMapReports';
import { ExternalLink } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function DUReportsPanel({}: PanelComponentProps) {
  const { geojson, loading } = useDUMapReports();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading DU reports...
      </div>
    );
  }

  const reports = geojson.features;

  if (reports.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No recent DU reports
      </div>
    );
  }

  // Show up to 20 most recent
  const displayed = reports.slice(0, 20);

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto h-full p-2">
      {displayed.map((f, i) => {
        const p = f.properties;
        if (!p) return null;
        const location = [p.location_name, p.state_abbr].filter(Boolean).join(', ');
        return (
          <div
            key={i}
            className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-white/90 truncate">
                  {p.classification || 'Report'}
                </span>
                <span className="text-[10px] text-white/30">
                  {formatDate(p.submit_date)}
                </span>
              </div>
              {location && (
                <p className="text-[10px] text-white/40 truncate">{location}</p>
              )}
              {p.activity_level && (
                <span className="text-[10px] text-cyan-400/70">{p.activity_level}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

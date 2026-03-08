import { Trash2 } from 'lucide-react';
import type { HuntLog } from '@/hooks/useHuntLogs';

interface HuntLogListProps {
  logs: HuntLog[];
  loading?: boolean;
  onDelete: (id: string) => void;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}/${y.slice(2)}`;
}

function speciesLabel(species: string): string {
  return species.charAt(0).toUpperCase() + species.slice(1);
}

function weatherSummary(weather: Record<string, unknown> | undefined): string | null {
  if (!weather) return null;
  const parts: string[] = [];
  if (weather.temp_high != null && weather.temp_low != null) {
    parts.push(`${weather.temp_high}/${weather.temp_low}F`);
  }
  if (weather.wind_max != null) {
    const dir = weather.wind_dir ? `${weather.wind_dir} ` : '';
    parts.push(`${dir}${weather.wind_max}mph`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function moonSummary(solunar: Record<string, unknown> | undefined): string | null {
  if (!solunar?.moon_phase) return null;
  const phase = String(solunar.moon_phase);
  const illum = solunar.illumination != null ? ` ${solunar.illumination}%` : '';
  return `${phase}${illum}`;
}

export default function HuntLogList({ logs, loading, onDelete }: HuntLogListProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-white/[0.04] animate-pulse" />
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-[11px] text-white/30 font-body leading-snug py-4 text-center">
        No hunts logged yet. Log your first hunt above.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-white/40 font-body font-semibold mb-2">
        Recent Hunts
      </div>
      {logs.map(log => {
        const weather = weatherSummary(log.weather);
        const moon = moonSummary(log.solunar);
        const truncNotes = log.notes && log.notes.length > 100
          ? log.notes.slice(0, 100) + '...'
          : log.notes;

        return (
          <div
            key={log.id}
            className="glass-panel rounded-lg px-3 py-2 border border-white/[0.06] group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs font-body">
                  <span className="text-white/90 font-semibold">
                    {formatDate(log.date)}
                  </span>
                  <span className="text-white/50">{log.state_abbr}</span>
                  <span className="text-white/50">{speciesLabel(log.species)}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-lg font-semibold text-cyan-400 font-body leading-none">
                    {log.harvest_count}
                  </span>
                  {weather && (
                    <span className="text-[10px] text-white/30 font-body">{weather}</span>
                  )}
                  {moon && (
                    <span className="text-[10px] text-white/30 font-body">{moon}</span>
                  )}
                </div>
                {truncNotes && (
                  <p className="text-[10px] text-white/40 font-body mt-1 leading-snug">
                    {truncNotes}
                  </p>
                )}
              </div>
              <button
                onClick={() => onDelete(log.id)}
                className="shrink-0 p-1 rounded text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                title="Delete log"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

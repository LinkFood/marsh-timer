import { Calendar } from 'lucide-react';

interface SeasonCardProps {
  data: Record<string, unknown>;
}

export default function SeasonCard({ data }: SeasonCardProps) {
  const state = data.state as string | undefined;
  const species = data.species as string | undefined;
  const seasonType = data.season_type as string | undefined;
  const status = data.status as string | undefined;
  const dates = data.dates as Array<{ open: string; close: string }> | undefined;
  const harvestLimit = data.bag_limit as number | undefined;
  const zone = data.zone as string | undefined;

  const statusColors: Record<string, string> = {
    open: 'text-green-400 bg-green-950/30 border-green-500/20',
    soon: 'text-yellow-400 bg-yellow-950/30 border-yellow-500/20',
    upcoming: 'text-blue-400 bg-blue-950/30 border-blue-500/20',
    closed: 'text-red-400 bg-red-950/30 border-red-500/20',
  };

  const colorClass = statusColors[status || 'closed'] || statusColors.closed;

  return (
    <div className={`rounded-lg border p-2.5 ${colorClass}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Calendar size={12} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {species} {seasonType} — {state}
        </span>
      </div>
      {zone && zone !== 'Statewide' && (
        <p className="text-[10px] text-muted-foreground mb-1">{zone}</p>
      )}
      {status && (
        <span className="inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-black/20">
          {status}
        </span>
      )}
      {dates && dates.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {dates.map((d, i) => (
            <p key={i} className="text-[10px]">
              {new Date(d.open + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} —{' '}
              {new Date(d.close + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          ))}
        </div>
      )}
      {harvestLimit !== undefined && harvestLimit > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1">Limit: {harvestLimit}</p>
      )}
    </div>
  );
}

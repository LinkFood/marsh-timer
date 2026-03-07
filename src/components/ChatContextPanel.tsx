import type { HuntContext } from '@/hooks/useHuntContext';
import SeasonCard from './cards/SeasonCard';

interface ChatContextPanelProps {
  context: HuntContext;
}

export default function ChatContextPanel({ context }: ChatContextPanelProps) {
  if (!context.stateAbbr || context.seasons.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 font-body text-xs p-4">
        <p className="text-center">Select a state on the map to see season details and context here.</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2 overflow-y-auto scrollbar-hide h-full">
      <h3 className="text-[10px] font-body font-semibold text-white/40 uppercase tracking-wider">
        {context.stateAbbr} — {context.species} Seasons
      </h3>
      {context.seasons.map((s, i) => (
        <SeasonCard
          key={i}
          data={{
            species: context.species,
            state: context.stateAbbr,
            season_type: s.seasonType,
            zone: s.zone,
            status: s.status,
            dates: s.dates,
          }}
        />
      ))}
    </div>
  );
}

import ResultCard from './ResultCard';
import FusionCard from './FusionCard';
import type { BrainResult } from './ResultCard';

interface ResultsViewProps {
  primary: BrainResult[];
  fusion: BrainResult[];
  stats: {
    totalMatched: number;
    domainsRepresented: string[];
    statesRepresented: string[];
  };
  loading: boolean;
  onStateClick?: (abbr: string) => void;
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      <div className="md:col-span-3 flex flex-col gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 animate-pulse">
            <div className="flex items-center gap-1.5 mb-2">
              <div className="h-4 w-20 bg-white/[0.06] rounded" />
              <div className="h-4 w-8 bg-white/[0.06] rounded" />
              <div className="h-4 w-16 bg-white/[0.06] rounded ml-auto" />
            </div>
            <div className="h-3 w-full bg-white/[0.04] rounded mb-1" />
            <div className="h-3 w-3/4 bg-white/[0.04] rounded" />
          </div>
        ))}
      </div>
      <div className="md:col-span-2 flex flex-col gap-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="border border-purple-400/10 bg-purple-400/[0.02] rounded-lg p-3 animate-pulse">
            <div className="h-4 w-24 bg-purple-400/[0.06] rounded mb-2" />
            <div className="h-3 w-full bg-white/[0.04] rounded mb-1" />
            <div className="h-3 w-2/3 bg-white/[0.04] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResultsView({ primary, fusion, stats, loading, onStateClick }: ResultsViewProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-4 w-48 bg-white/[0.04] rounded animate-pulse" />
        <LoadingSkeleton />
      </div>
    );
  }

  if (primary.length === 0 && fusion.length === 0) {
    return null;
  }

  // On mobile, interleave fusion cards between primary results
  // Insert a fusion card after every 3rd primary result
  const fusionChunkSize = Math.max(1, Math.ceil(fusion.length / Math.ceil(primary.length / 3)));

  return (
    <div className="flex flex-col gap-3">
      {/* Summary line */}
      <p className="text-[11px] font-mono text-white/40">
        {stats.totalMatched} match{stats.totalMatched !== 1 ? 'es' : ''} across{' '}
        {stats.domainsRepresented.length} domain{stats.domainsRepresented.length !== 1 ? 's' : ''} in{' '}
        {stats.statesRepresented.length} state{stats.statesRepresented.length !== 1 ? 's' : ''}
      </p>

      {/* Desktop: 2-column grid */}
      <div className="hidden md:grid grid-cols-5 gap-4">
        {/* Primary results - left 60% */}
        <div className="col-span-3 flex flex-col gap-3">
          {primary.map((result, i) => (
            <ResultCard key={i} result={result} onStateClick={onStateClick} />
          ))}
        </div>

        {/* Fusion sidebar - right 40% */}
        {fusion.length > 0 && (
          <div className="col-span-2 flex flex-col gap-3">
            {buildFusionCards(fusion).map((card, i) => (
              <FusionCard
                key={i}
                results={card.results}
                sourceDate={card.sourceDate}
                sourceState={card.sourceState}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mobile: single column with fusion interleaved */}
      <div className="flex flex-col gap-3 md:hidden">
        {primary.map((result, i) => {
          const elements = [
            <ResultCard key={`r-${i}`} result={result} onStateClick={onStateClick} />,
          ];

          // Insert a fusion card after every 3rd result
          if ((i + 1) % 3 === 0) {
            const fusionIndex = Math.floor(i / 3);
            const cards = buildFusionCards(fusion);
            if (fusionIndex < cards.length) {
              const card = cards[fusionIndex];
              elements.push(
                <FusionCard
                  key={`f-${fusionIndex}`}
                  results={card.results}
                  sourceDate={card.sourceDate}
                  sourceState={card.sourceState}
                />
              );
            }
          }

          return elements;
        })}
      </div>
    </div>
  );
}

/** Group fusion results into cards by state + date proximity */
function buildFusionCards(fusion: BrainResult[]): { results: BrainResult[]; sourceDate: string; sourceState: string }[] {
  if (fusion.length === 0) return [];

  const groups: Record<string, BrainResult[]> = {};
  for (const r of fusion) {
    const key = `${r.state_abbr || 'US'}_${r.effective_date || 'recent'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  return Object.entries(groups).map(([key, results]) => {
    const [state, date] = key.split('_');
    return {
      results,
      sourceState: state,
      sourceDate: date,
    };
  });
}

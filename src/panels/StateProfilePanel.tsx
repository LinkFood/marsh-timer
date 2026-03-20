import { useDeck } from '@/contexts/DeckContext';
import { useConvergenceScores } from '@/hooks/useConvergenceScores';
import { useConvergenceAlerts } from '@/hooks/useConvergenceAlerts';
import StateProfile from '@/components/StateProfile';
import type { PanelComponentProps } from './PanelTypes';

export default function StateProfilePanel({}: PanelComponentProps) {
  const { species, selectedState, setSelectedState } = useDeck();
  const { scores } = useConvergenceScores();
  const { alerts } = useConvergenceAlerts();

  if (!selectedState) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Select a state to view profile
      </div>
    );
  }

  // Find convergence score for selected state (scores is a Map)
  const convergenceScore = scores.get(selectedState) ?? null;

  const formattedScore = convergenceScore ? {
    score: convergenceScore.score ?? 0,
    weather_component: convergenceScore.weather_component ?? 0,
    solunar_component: convergenceScore.solunar_component ?? 0,
    migration_component: convergenceScore.migration_component ?? 0,
    pattern_component: convergenceScore.pattern_component ?? 0,
    national_rank: convergenceScore.national_rank ?? 0,
    reasoning: convergenceScore.reasoning ?? '',
    birdcast_component: convergenceScore.birdcast_component ?? 0,
    water_component: convergenceScore.water_component ?? 0,
    photoperiod_component: convergenceScore.photoperiod_component ?? 0,
    tide_component: convergenceScore.tide_component ?? 0,
  } : null;

  const convergenceAlerts = Array.isArray(alerts) ? alerts.map((a: any) => ({
    state_abbr: a.state_abbr ?? '',
    alert_type: a.alert_type ?? '',
    reasoning: a.reasoning ?? '',
    previous_score: a.previous_score ?? 0,
    score: a.score ?? 0,
    created_at: a.created_at ?? '',
  })) : [];

  return (
    <div className="h-full overflow-y-auto">
      <StateProfile
        stateAbbr={selectedState}
        species={species}
        convergenceScore={formattedScore}
        convergenceAlerts={convergenceAlerts}
        onBack={() => setSelectedState(null)}
        isMobile={false}
      />
    </div>
  );
}

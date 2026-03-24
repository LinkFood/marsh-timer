import { useState, useEffect } from 'react';
import { useDeck } from '@/contexts/DeckContext';
import { useConvergenceScores } from '@/hooks/useConvergenceScores';
import { useConvergenceAlerts } from '@/hooks/useConvergenceAlerts';
import StateProfile from '@/components/StateProfile';
import type { PanelComponentProps } from './PanelTypes';

export default function StateProfilePanel({}: PanelComponentProps) {
  const { species, selectedState, setSelectedState } = useDeck();
  const { scores } = useConvergenceScores();
  const { alerts } = useConvergenceAlerts();
  const [disasterWatches, setDisasterWatches] = useState<any[]>([]);

  useEffect(() => {
    if (!selectedState) { setDisasterWatches([]); return; }
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL) return;

    fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,title,content,metadata,created_at&content_type=eq.disaster-watch&state_abbr=eq.${selectedState}&order=created_at.desc&limit=5`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY },
    })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setDisasterWatches(data); })
      .catch(() => setDisasterWatches([]));
  }, [selectedState]);

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
        disasterWatches={disasterWatches}
        onBack={() => setSelectedState(null)}
        isMobile={false}
      />
    </div>
  );
}

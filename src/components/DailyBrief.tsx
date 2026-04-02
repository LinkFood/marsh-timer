import { useMemo } from 'react';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';
import { useTrackRecord } from '@/hooks/useTrackRecord';

interface DailyBriefProps {
  scores: Map<string, ConvergenceScore>;
  arcs: StateArc[];
}

type BriefCycle = 'MORNING WATCH' | 'MIDDAY UPDATE' | 'EVENING REVIEW';

function getCycle(): { cycle: BriefCycle; hour: number } {
  const hour = new Date().getHours();
  if (hour < 12) return { cycle: 'MORNING WATCH', hour };
  if (hour < 18) return { cycle: 'MIDDAY UPDATE', hour };
  return { cycle: 'EVENING REVIEW', hour };
}

export default function DailyBrief({ scores, arcs }: DailyBriefProps) {
  const { recentGrades, loading: gradesLoading } = useTrackRecord();
  const { cycle } = getCycle();

  const brief = useMemo(() => {
    if (scores.size === 0) return null;

    const sentences: string[] = [];

    // Count arcs by phase
    let recognitions = 0, outcomes = 0, grades = 0;
    for (const arc of arcs) {
      if (arc.current_act === 'recognition') recognitions++;
      if (arc.current_act === 'outcome') outcomes++;
      if (arc.current_act === 'grade') grades++;
    }

    // Top states
    const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const elevated = sorted.filter(s => s.score >= 50);

    // Regime
    const regime = arcs.length >= 20 ? 'SURGE' : arcs.length >= 5 ? 'ACTIVE' : 'QUIET';

    // Grades today
    const todayStr = new Date().toISOString().split('T')[0];
    const todayGrades = !gradesLoading
      ? recentGrades.filter(g => g.graded_at?.startsWith(todayStr))
      : [];
    const confirmedToday = todayGrades.filter(g => g.outcome_grade === 'confirmed').length;

    // Nearest deadline
    const now = Date.now();
    let nearestArc: StateArc | null = null;
    let nearestDays = Infinity;
    for (const arc of arcs) {
      if (arc.outcome_deadline && arc.current_act === 'outcome') {
        const diff = Math.ceil((new Date(arc.outcome_deadline).getTime() - now) / 86400000);
        if (diff >= 0 && diff < nearestDays) { nearestDays = diff; nearestArc = arc; }
      }
    }

    // Build cycle-specific brief
    if (cycle === 'MORNING WATCH') {
      // Morning: what's the state of play, what to watch today
      sentences.push(`${regime}: ${elevated.length} states elevated, ${arcs.length} arcs active.`);
      if (top) {
        const rising = sorted.slice(1, 4).filter(s => s.score >= 45);
        sentences.push(`${top.state_abbr} leads at ${Math.round(top.score)}${rising.length > 0 ? `, ${rising.map(s => s.state_abbr).join(' and ')} rising` : ''}.`);
      }
      if (nearestArc && nearestDays <= 3) {
        const label = nearestDays === 0 ? 'today' : nearestDays === 1 ? 'tomorrow' : `in ${nearestDays}d`;
        sentences.push(`Watch: ${nearestArc.state_abbr} grades ${label}.`);
      } else if (recognitions > 0) {
        sentences.push(`${recognitions} new recognition${recognitions > 1 ? 's' : ''} — brain is watching.`);
      }
    } else if (cycle === 'MIDDAY UPDATE') {
      // Midday: what developed, any new recognitions or grades
      if (todayGrades.length > 0) {
        sentences.push(`Brain graded ${todayGrades.length} arc${todayGrades.length > 1 ? 's' : ''} today — ${confirmedToday === todayGrades.length ? 'all confirmed' : `${confirmedToday} confirmed`}.`);
      }
      sentences.push(`${recognitions} recognition${recognitions !== 1 ? 's' : ''}, ${outcomes} outcome${outcomes !== 1 ? 's' : ''} active.`);
      if (top) {
        sentences.push(`${top.state_abbr} at ${Math.round(top.score)} — ${elevated.length} states above 50.`);
      }
    } else {
      // Evening: wrap-up, what confirmed, overnight outlook
      if (todayGrades.length > 0) {
        sentences.push(`Today: ${todayGrades.length} graded, ${confirmedToday} confirmed. Track record holds at 100%.`);
      } else {
        sentences.push(`No new grades today. ${arcs.length} arcs still running.`);
      }
      if (elevated.length > 0) {
        sentences.push(`${elevated.length} states elevated overnight. Top: ${sorted.slice(0, 3).map(s => `${s.state_abbr} ${Math.round(s.score)}`).join(', ')}.`);
      }
      if (nearestArc && nearestDays <= 2) {
        sentences.push(`${nearestArc.state_abbr} outcome deadline ${nearestDays === 0 ? 'tonight' : 'tomorrow'}.`);
      }
    }

    return sentences.slice(0, 3).join(' ');
  }, [scores, arcs, recentGrades, gradesLoading, cycle]);

  if (!brief) return null;

  const cycleColor = cycle === 'MORNING WATCH' ? '#f59e0b' : cycle === 'MIDDAY UPDATE' ? '#22c55e' : '#6366f1';

  return (
    <div className="shrink-0 px-3 py-2 border-b border-white/[0.06]">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: cycleColor }} />
        <span className="text-[7px] font-mono uppercase tracking-[0.15em]" style={{ color: cycleColor }}>
          {cycle}
        </span>
      </div>
      <p className="font-mono text-[9px] text-white/35 leading-relaxed">{brief}</p>
    </div>
  );
}

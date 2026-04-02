import { useMemo } from 'react';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';
import { useTrackRecord } from '@/hooks/useTrackRecord';

interface DailyBriefProps {
  scores: Map<string, ConvergenceScore>;
  arcs: StateArc[];
}

export default function DailyBrief({ scores, arcs }: DailyBriefProps) {
  const { recentGrades, loading: gradesLoading } = useTrackRecord();

  const brief = useMemo(() => {
    if (scores.size === 0) return null;

    const sentences: string[] = [];

    // 1. Count arcs by phase
    const phaseCounts: Record<string, number> = {};
    for (const arc of arcs) {
      phaseCounts[arc.current_act] = (phaseCounts[arc.current_act] || 0) + 1;
    }

    const recognitions = phaseCounts['recognition'] || 0;
    const outcomes = phaseCounts['outcome'] || 0;
    const grades = phaseCounts['grade'] || 0;
    const buildups = phaseCounts['buildup'] || 0;
    const totalActive = arcs.length;

    // 2. Get top state
    const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const rising = sorted.slice(1, 4).filter(s => s.score >= 40);

    // 3. Build regime phrase based on arc counts
    if (totalActive > 0) {
      const parts: string[] = [];
      if (recognitions > 0) parts.push(`${recognitions} recognition${recognitions > 1 ? 's' : ''}`);
      if (outcomes > 0) parts.push(`${outcomes} outcome${outcomes > 1 ? 's' : ''}`);
      if (grades > 0) parts.push(`${grades} grade${grades > 1 ? 's' : ''}`);
      if (buildups > 0) parts.push(`${buildups} buildup${buildups > 1 ? 's' : ''}`);

      let regime = totalActive >= 10 ? 'SURGE' : totalActive >= 4 ? 'ACTIVE' : 'QUIET';
      sentences.push(`${regime}: ${totalActive} arcs open (${parts.join(', ')}).`);
    }

    // 4. Top state + risers
    if (top) {
      let topLine = `${top.state_abbr} leads at ${Math.round(top.score)}`;
      if (rising.length > 0) {
        topLine += `, ${rising.map(s => s.state_abbr).join(' and ')} rising`;
      }
      topLine += '.';
      sentences.push(topLine);
    }

    // 5. Recent grades (graded today)
    if (!gradesLoading && recentGrades.length > 0) {
      const todayStr = new Date().toISOString().split('T')[0];
      const todayGrades = recentGrades.filter(g => g.graded_at && g.graded_at.startsWith(todayStr));
      if (todayGrades.length > 0) {
        const confirmed = todayGrades.filter(g => g.outcome_grade === 'confirmed').length;
        const partial = todayGrades.filter(g => g.outcome_grade === 'partially_confirmed').length;
        let gradeLine = `Brain graded ${todayGrades.length} today`;
        if (confirmed > 0 && confirmed === todayGrades.length) {
          gradeLine += ' -- all confirmed.';
        } else if (confirmed > 0) {
          gradeLine += ` -- ${confirmed} confirmed${partial > 0 ? `, ${partial} partial` : ''}.`;
        } else {
          gradeLine += '.';
        }
        sentences.push(gradeLine);
      }
    }

    // 6. Nearest outcome deadline
    const now = new Date();
    let nearestArc: StateArc | null = null;
    let nearestDays = Infinity;
    for (const arc of arcs) {
      if (arc.outcome_deadline) {
        const deadline = new Date(arc.outcome_deadline);
        const diffMs = deadline.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays < nearestDays) {
          nearestDays = diffDays;
          nearestArc = arc;
        }
      }
    }
    if (nearestArc && nearestDays <= 7) {
      const label = nearestDays === 0 ? 'today' : nearestDays === 1 ? 'tomorrow' : `in ${nearestDays}d`;
      sentences.push(`Watching ${nearestArc.state_abbr} deadline ${label}.`);
    }

    // Trim to 3 sentences max
    return sentences.slice(0, 3).join(' ');
  }, [scores, arcs, recentGrades, gradesLoading]);

  if (!brief) return null;

  return (
    <div className="shrink-0 px-3 py-2 border-b border-white/[0.06]">
      <div className="flex items-start gap-2">
        <span className="mt-[3px] shrink-0 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        <p className="font-mono text-[9px] text-white/35 leading-relaxed">{brief}</p>
      </div>
    </div>
  );
}

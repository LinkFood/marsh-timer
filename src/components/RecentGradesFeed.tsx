import { useTrackRecord } from '@/hooks/useTrackRecord';

const GRADE_ICONS: Record<string, { symbol: string; color: string }> = {
  confirmed: { symbol: '\u2713', color: '#22c55e' },
  partially_confirmed: { symbol: '~', color: '#f59e0b' },
  missed: { symbol: '\u2717', color: '#ef4444' },
  false_alarm: { symbol: '\u2717', color: '#ef4444' },
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function RecentGradesFeed() {
  const { recentGrades, loading } = useTrackRecord();

  if (loading || recentGrades.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
      <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Recent Grades</div>
      <div className="space-y-0.5">
        {recentGrades.slice(0, 6).map((g, i) => {
          const icon = GRADE_ICONS[g.outcome_grade] || GRADE_ICONS.missed;
          return (
            <div key={`${g.state_abbr}-${g.graded_at}-${i}`} className="flex items-center gap-1.5 text-[9px] font-mono">
              <span className="w-3 text-center shrink-0" style={{ color: icon.color }}>{icon.symbol}</span>
              <span className="text-white/50 w-5 shrink-0">{g.state_abbr}</span>
              <span className="text-white/20 truncate flex-1 min-w-0">{g.alert_source}</span>
              <span className="text-white/15 shrink-0">{timeAgo(g.graded_at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const GRADE_CONFIG: Record<string, { label: string; color: string }> = {
  confirmed: { label: 'CONFIRMED', color: '#22c55e' },
  partially_confirmed: { label: 'PARTIAL', color: '#f59e0b' },
  missed: { label: 'MISSED', color: '#ef4444' },
  false_alarm: { label: 'FALSE ALARM', color: '#ef4444' },
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

interface PostMortemArc {
  state_abbr: string;
  grade: string;
  grade_reasoning: string;
  precedent_accuracy: number | null;
  updated_at: string;
}

export default function LatestPostMortem() {
  const [latest, setLatest] = useState<PostMortemArc | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !SUPABASE_URL || !SUPABASE_KEY) return;
    fetchedRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_state_arcs?grade_reasoning=neq.null&select=state_abbr,grade,grade_reasoning,precedent_accuracy,updated_at&order=updated_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
    )
      .then(r => r.json())
      .then((data: PostMortemArc[]) => {
        if (Array.isArray(data) && data.length > 0) setLatest(data[0]);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));

    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  if (!latest) return null;

  const gradeConfig = GRADE_CONFIG[latest.grade] || GRADE_CONFIG.missed;
  const reasoningFull = latest.grade_reasoning
    .replace(/^#.*$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\|/g, ' ')
    .replace(/---/g, '')
    .trim();
  const reasoning = expanded ? reasoningFull : reasoningFull.slice(0, 250);

  return (
    <div
      className="shrink-0 border-t border-white/[0.06] px-3 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors"
      onClick={() => setExpanded(e => !e)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
    >
      <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Latest Post-Mortem</div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono font-bold text-white/70">{latest.state_abbr}</span>
          <span
            className="text-[7px] font-mono uppercase tracking-wider px-1 py-px rounded"
            style={{ color: gradeConfig.color, backgroundColor: `${gradeConfig.color}15` }}
          >
            {gradeConfig.label}
          </span>
        </div>
        <span className="text-[8px] font-mono text-white/15">{timeAgo(latest.updated_at)}</span>
      </div>
      <p className={`text-[9px] font-mono text-white/25 leading-relaxed italic${expanded ? '' : ' line-clamp-3'}`}>
        {reasoning}
      </p>
      {latest.precedent_accuracy != null && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[8px] font-mono text-white/15">Historical accuracy:</span>
          <span
            className="text-[8px] font-mono"
            style={{ color: latest.precedent_accuracy >= 60 ? '#22c55e' : '#f59e0b' }}
          >
            {Math.round(latest.precedent_accuracy)}%
          </span>
        </div>
      )}
      <div className="text-[8px] font-mono text-white/20 text-center mt-1.5 select-none">
        {expanded ? 'show less \u25B4' : 'show more \u25BE'}
      </div>
    </div>
  );
}

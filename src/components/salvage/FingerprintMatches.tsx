import { useState, useEffect } from 'react';
import { Fingerprint } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface FingerprintEntry {
  title: string;
  content: string;
  state_abbr: string;
  metadata: Record<string, unknown>;
  effective_date: string | null;
  created_at: string;
}

const GRADE_BORDER: Record<string, string> = {
  confirmed: 'border-l-emerald-400',
  partially_confirmed: 'border-l-amber-400',
  missed: 'border-l-red-400',
  false_alarm: 'border-l-gray-500',
};

const GRADE_BADGE: Record<string, string> = {
  confirmed: 'bg-emerald-400/20 text-emerald-400',
  partially_confirmed: 'bg-amber-400/20 text-amber-400',
  missed: 'bg-red-400/20 text-red-400',
  false_alarm: 'bg-gray-500/20 text-gray-400',
};

interface FingerprintMatchesProps {
  stateAbbr: string;
}

export default function FingerprintMatches({ stateAbbr }: FingerprintMatchesProps) {
  const [entries, setEntries] = useState<FingerprintEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchFingerprints() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.arc-fingerprint&order=created_at.desc&limit=5&select=title,content,state_abbr,metadata,effective_date,created_at`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setEntries(data);
        }
      } catch {
        // abort or network — silent
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchFingerprints();
    return () => controller.abort();
  }, [stateAbbr]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-16 bg-white/[0.03] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <Fingerprint size={20} className="text-white/15" />
        <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">
          No historical arcs completed yet
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const grade = (entry.metadata?.grade as string) || '';
        const patternType = (entry.metadata?.pattern_type as string) || '';
        const borderClass = GRADE_BORDER[grade] || 'border-l-white/10';
        const badgeClass = GRADE_BADGE[grade] || 'bg-white/10 text-white/40';

        return (
          <div
            key={`${entry.created_at}-${i}`}
            className={`bg-gray-900/60 border border-gray-800 border-l-4 ${borderClass} rounded-lg p-3`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono text-white/70 truncate flex-1">
                {entry.title}
              </span>
              {entry.state_abbr && (
                <span className="text-[8px] font-mono bg-cyan-400/15 text-cyan-400 px-1.5 py-0.5 rounded shrink-0">
                  {entry.state_abbr}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mb-1.5">
              {grade && (
                <span className={`text-[7px] font-mono uppercase px-1.5 py-0.5 rounded ${badgeClass}`}>
                  {grade.replace('_', ' ')}
                </span>
              )}
              {patternType && (
                <span className="text-[7px] font-mono uppercase px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-400">
                  {patternType}
                </span>
              )}
            </div>
            <p className="text-[9px] font-mono text-white/40 line-clamp-2">
              {entry.content?.slice(0, 100)}{entry.content?.length > 100 ? '...' : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
}

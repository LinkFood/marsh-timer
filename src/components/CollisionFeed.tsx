import { useState, useEffect, useRef } from 'react';
import { useBrainJournal, type JournalEntry } from '@/hooks/useBrainJournal';
import { useCollisionFeed, type CollisionFilter } from '@/hooks/useCollisionFeed';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import CollisionCard from '@/components/CollisionCard';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const FILTERS: { key: CollisionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'connections', label: 'Connections' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'grades', label: 'Grades' },
];

// Fetch correlation + anomaly discoveries directly (they get buried by signal_weight sort in useBrainJournal)
function useDiscoveries() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !SUPABASE_URL || !SUPABASE_KEY) return;
    fetchedRef.current = true;

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const types = '"correlation-discovery","anomaly-alert","arc-grade-reasoning","arc-fingerprint"';

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=in.(${types})&created_at=gte.${cutoff}&order=created_at.desc&limit=50&select=id,title,content,content_type,state_abbr,metadata,effective_date,signal_weight,created_at`,
      { headers: { apikey: SUPABASE_KEY } }
    )
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setEntries(data); })
      .catch(() => {});

    const interval = setInterval(() => {
      fetch(
        `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=in.(${types})&created_at=gte.${cutoff}&order=created_at.desc&limit=50&select=id,title,content,content_type,state_abbr,metadata,effective_date,signal_weight,created_at`,
        { headers: { apikey: SUPABASE_KEY } }
      )
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setEntries(data); })
        .catch(() => {});
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  return entries;
}

interface Props {
  convergenceAlerts: ConvergenceAlert[];
  stateFilter?: string | null;
}

export default function CollisionFeed({ convergenceAlerts, stateFilter = null }: Props) {
  const [activeFilter, setActiveFilter] = useState<CollisionFilter>('all');
  const { entries: journalEntries, loading: journalLoading } = useBrainJournal(null, 'brain', 100);
  const discoveryEntries = useDiscoveries();

  // Merge journal + discoveries, dedup by id
  const mergedEntries = (() => {
    const seen = new Set<string>();
    const all: JournalEntry[] = [];
    for (const e of [...discoveryEntries, ...journalEntries]) {
      if (!seen.has(e.id)) { seen.add(e.id); all.push(e); }
    }
    return all;
  })();

  const { entries, filterEntries } = useCollisionFeed(mergedEntries, convergenceAlerts, stateFilter);

  const filtered = filterEntries(activeFilter);
  const displayed = filtered.slice(0, 50);

  return (
    <div className="h-full flex flex-col bg-[#0a0f1a]">
      {/* Filter tabs */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 py-1 border-b border-white/[0.04]">
        {FILTERS.map(f => {
          const count = filterEntries(f.key).length;
          const isActive = f.key === activeFilter;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`px-1.5 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider transition-colors ${
                isActive
                  ? 'bg-white/[0.08] text-white/60'
                  : 'text-white/20 hover:text-white/35'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span className="ml-1 text-white/15">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Summary line */}
      {!stateFilter && displayed.length > 0 && (
        <div className="shrink-0 px-2 py-0.5 border-b border-white/[0.04] text-[8px] font-mono text-white/15">
          {(() => {
            const risks = filterEntries('connections').filter(e => e.type === 'compound-risk').length;
            const links = filterEntries('connections').filter(e => e.type === 'correlation').length;
            const anomalies = filterEntries('alerts').filter(e => e.type === 'anomaly').length;
            const parts: string[] = [];
            if (risks) parts.push(`${risks} risk alerts`);
            if (links) parts.push(`${links} cross-domain links`);
            if (anomalies) parts.push(`${anomalies} anomalies`);
            return parts.join(' · ') || 'Brain activity';
          })()}
        </div>
      )}

      {/* Feed entries */}
      <div className="flex-1 overflow-y-auto">
        {journalLoading && displayed.length === 0 ? (
          <div className="p-3 space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-6 bg-white/[0.02] rounded animate-pulse" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="p-3 flex items-center justify-center h-full">
            <span className="text-[10px] font-mono text-white/15">
              {stateFilter ? `No collisions for ${stateFilter}` : 'Brain is quiet — waiting for data'}
            </span>
          </div>
        ) : (
          displayed.map(entry => (
            <CollisionCard key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}

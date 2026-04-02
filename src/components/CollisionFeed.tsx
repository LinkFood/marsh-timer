import { useState, useEffect, useRef } from 'react';
import { useBrainJournal, type JournalEntry } from '@/hooks/useBrainJournal';
import { useCollisionFeed, type CollisionFilter } from '@/hooks/useCollisionFeed';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import CollisionCard from '@/components/CollisionCard';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const FILTERS: { key: CollisionFilter; label: string; tooltip: string }[] = [
  { key: 'all', label: 'All', tooltip: 'Everything the brain detected' },
  { key: 'connections', label: 'Connections', tooltip: 'Cross-domain pattern correlations' },
  { key: 'alerts', label: 'Alerts', tooltip: 'Anomalies and score spikes' },
  { key: 'grades', label: 'Grades', tooltip: 'Prediction results and post-mortems' },
];

// Fetch discoveries + environmental data directly (they get buried by signal_weight sort in useBrainJournal)
// Split into two parallel fetches: intelligence types (small volume, fast) and environmental types (per-type to avoid IN timeout)
const DISCOVERY_TYPES = '"correlation-discovery","anomaly-alert","arc-grade-reasoning","arc-fingerprint"';
const ENV_TYPES = ['soil-conditions', 'river-discharge', 'air-quality', 'ocean-buoy', 'space-weather', 'pollen-data', 'wildfire-perimeter'];
const SELECT = 'id,title,content,content_type,state_abbr,metadata,effective_date,signal_weight,created_at';

function useDiscoveries() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !SUPABASE_URL || !SUPABASE_KEY) return;
    fetchedRef.current = true;

    const headers = { apikey: SUPABASE_KEY };
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    async function fetchAll() {
      const discoveryUrl = `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=in.(${DISCOVERY_TYPES})&created_at=gte.${cutoff}&order=created_at.desc&limit=50&select=${SELECT}`;
      const envUrls = ENV_TYPES.map(t =>
        `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.${t}&created_at=gte.${cutoff}&order=created_at.desc&limit=5&select=${SELECT}`
      );

      const results = await Promise.allSettled([
        fetch(discoveryUrl, { headers }).then(r => r.json()),
        ...envUrls.map(url => fetch(url, { headers }).then(r => r.json())),
      ]);

      const all: JournalEntry[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          all.push(...r.value);
        }
      }
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setEntries(all);
    }

    fetchAll();
    const interval = setInterval(fetchAll, 60_000);
    return () => clearInterval(interval);
  }, []);

  return entries;
}

interface Props {
  convergenceAlerts: ConvergenceAlert[];
  stateFilter?: string | null;
  onSelectState?: (abbr: string) => void;
}

export default function CollisionFeed({ convergenceAlerts, stateFilter = null, onSelectState }: Props) {
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
              title={f.tooltip}
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
            const all = filterEntries('all');
            const risks = all.filter(e => e.type === 'compound-risk').length;
            const grades = all.filter(e => e.type === 'grade-reasoning' || e.type === 'arc-fingerprint').length;
            const links = all.filter(e => e.type === 'correlation').length;
            const anomalies = all.filter(e => e.type === 'anomaly').length;
            const statesActive = new Set(all.filter(e => e.stateAbbr).map(e => e.stateAbbr)).size;
            const parts: string[] = [];
            if (risks) parts.push(`${risks} risk alerts`);
            if (grades) parts.push(`${grades} grades`);
            if (anomalies) parts.push(`${anomalies} anomalies`);
            if (statesActive) parts.push(`${statesActive} states active`);
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
          <div className="p-3 flex flex-col items-center justify-center h-full gap-1">
            <span className="text-[10px] font-mono text-white/15">
              {stateFilter ? `No collisions for ${stateFilter} yet` : 'Brain is quiet — waiting for data'}
            </span>
            {stateFilter && (
              <span className="text-[8px] font-mono text-white/10">
                Check national feed for cross-domain discoveries
              </span>
            )}
          </div>
        ) : (
          displayed.map(entry => (
            <CollisionCard key={entry.id} entry={entry} onSelectState={onSelectState} />
          ))
        )}
      </div>
    </div>
  );
}

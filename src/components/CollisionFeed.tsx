import { useState } from 'react';
import { useBrainJournal } from '@/hooks/useBrainJournal';
import { useCollisionFeed, type CollisionFilter } from '@/hooks/useCollisionFeed';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import CollisionCard from '@/components/CollisionCard';

const FILTERS: { key: CollisionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'connections', label: 'Connections' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'grades', label: 'Grades' },
];

interface Props {
  convergenceAlerts: ConvergenceAlert[];
  stateFilter?: string | null;
}

export default function CollisionFeed({ convergenceAlerts, stateFilter = null }: Props) {
  const [activeFilter, setActiveFilter] = useState<CollisionFilter>('all');
  const { entries: journalEntries, loading: journalLoading } = useBrainJournal(null, 'brain', 80);
  const { entries, filterEntries } = useCollisionFeed(journalEntries, convergenceAlerts, stateFilter);

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

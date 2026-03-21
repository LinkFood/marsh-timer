import { useMemo, useState } from 'react';
import { Activity, CloudLightning, AlertTriangle, TrendingUp, Radio } from 'lucide-react';
import { useSignalFeed, type SignalItem } from '@/hooks/useSignalFeed';
import { useMapAction } from '@/contexts/MapActionContext';
import PanelTabs from '@/components/PanelTabs';
import type { PanelComponentProps } from './PanelTypes';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return '<1m';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

const TYPE_CONFIG: Record<string, { icon: typeof Activity; color: string; bg: string }> = {
  convergence: { icon: TrendingUp, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  weather: { icon: CloudLightning, color: 'text-amber-400', bg: 'bg-amber-400/10' },
  nws: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-400/10' },
  migration: { icon: Radio, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  brain: { icon: Activity, color: 'text-purple-400', bg: 'bg-purple-400/10' },
};

const SEVERITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-white/30',
};

export default function WhatsHappeningPanel({ isFullscreen }: PanelComponentProps) {
  const { items, loading } = useSignalFeed();
  const { flyTo } = useMapAction();
  const [activeTab, setActiveTab] = useState('all');

  const filtered = useMemo(() => {
    if (activeTab === 'all') return items;
    return items.filter(i => i.type === activeTab);
  }, [items, activeTab]);

  const tabCounts = useMemo(() => ({
    all: items.length,
    convergence: items.filter(i => i.type === 'convergence').length,
    weather: items.filter(i => i.type === 'weather').length,
    nws: items.filter(i => i.type === 'nws').length,
  }), [items]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/20 text-[10px]">
        Loading signals...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PanelTabs
        tabs={[
          { id: 'all', label: 'ALL', count: tabCounts.all },
          { id: 'convergence', label: 'CONVERGENCE', count: tabCounts.convergence },
          { id: 'weather', label: 'WEATHER', count: tabCounts.weather },
          { id: 'nws', label: 'NWS', count: tabCounts.nws },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-full text-white/30 text-[10px]">
            No signals in the last 24 hours
          </div>
        )}
        {filtered.map(item => {
          const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.brain;
          const Icon = cfg.icon;
          return (
            <button
              key={item.id}
              onClick={() => item.stateAbbr && flyTo(item.stateAbbr)}
              className="w-full text-left px-2.5 py-2 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[item.severity]}`} />
                <Icon size={10} className={cfg.color} />
                <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
                  {item.type.toUpperCase()}
                </span>
                {item.stateAbbr && (
                  <span className="text-[9px] font-mono text-white/40">{item.stateAbbr}</span>
                )}
                <span className="text-[9px] font-mono text-white/20 ml-auto">{timeAgo(item.timestamp)}</span>
              </div>
              <p className="text-[10px] text-white/60 leading-relaxed line-clamp-2">
                {item.title}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { Map, BarChart3, Clock, Filter, Brain, type LucideIcon } from 'lucide-react';

type CanvasId = 'map' | 'data' | 'history' | 'screener';

interface CanvasTabsProps {
  active: CanvasId;
  onChange: (id: CanvasId) => void;
  isMobile: boolean;
  showBrain?: boolean;
  onToggleBrain?: () => void;
}

const TABS: { id: CanvasId; label: string; icon: LucideIcon }[] = [
  { id: 'map', label: 'Map', icon: Map },
  { id: 'data', label: 'Data', icon: BarChart3 },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'screener', label: 'Screener', icon: Filter },
];

function CanvasTabs({ active, onChange, isMobile, showBrain, onToggleBrain }: CanvasTabsProps) {
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 h-11 z-30 glass-panel border-t border-white/[0.06] flex items-center">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 ${
                isActive ? 'text-cyan-400' : 'text-white/40 hover:text-white/60'
              } transition-colors`}
            >
              <Icon size={16} />
              <span className="text-[9px] font-body uppercase tracking-wider">{tab.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => onToggleBrain?.()}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 ${
            showBrain ? 'text-cyan-400' : 'text-white/40 hover:text-white/60'
          } transition-colors`}
        >
          <Brain size={16} />
          <span className="text-[9px] font-body uppercase tracking-wider">Brain</span>
        </button>
      </div>
    );
  }

  return (
    <div className="h-9 glass-panel border-b border-white/[0.06] flex items-center pl-[336px] pr-4 gap-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-3 py-1.5 text-[11px] font-body uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
              isActive
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Icon size={14} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export type { CanvasId };
export default CanvasTabs;

import { Target, Compass, Cloud, BarChart3, MessageSquare, Layers, Plus } from 'lucide-react';
import { useDeck, type CategoryFilter } from '@/contexts/DeckContext';
import { useIsMobile } from '@/hooks/useIsMobile';

const CATEGORIES: { id: CategoryFilter; label: string; icon: typeof Target }[] = [
  { id: 'all', label: 'All', icon: Target },
  { id: 'intelligence', label: 'Intel', icon: Target },
  { id: 'migration', label: 'Migration', icon: Compass },
  { id: 'weather', label: 'Weather', icon: Cloud },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

export default function BottomBar() {
  const { toggleChat, toggleLayerPicker, panelAddOpen, togglePanelAdd, activeCategory, setActiveCategory } = useDeck();
  const isMobile = useIsMobile();

  return (
    <div className="shrink-0 h-10 glass-panel border-t border-white/[0.06] flex items-center px-2 gap-1 relative">
      {/* Category filters */}
      <div className="flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-none">
        {CATEGORIES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveCategory(id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-body whitespace-nowrap transition-colors ${
              activeCategory === id
                ? 'text-cyan-400 bg-cyan-400/10'
                : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
            }`}
          >
            <Icon className="w-3 h-3" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Add panel */}
        <button
          onClick={togglePanelAdd}
          className="flex items-center justify-center w-7 h-7 rounded text-white/40 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
          title="Add panel"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Chat toggle (mobile) */}
        {isMobile && (
          <button
            onClick={toggleChat}
            className="flex items-center justify-center w-7 h-7 rounded text-white/40 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
            title="Chat"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Layers toggle (mobile) */}
        {isMobile && (
          <button
            onClick={toggleLayerPicker}
            className="flex items-center justify-center w-7 h-7 rounded text-white/40 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
            title="Layers"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

    </div>
  );
}

import { useMemo, Suspense } from 'react';
import { useDeckLayout } from '@/hooks/useDeckLayout';
import { useDeck } from '@/contexts/DeckContext';
import PanelWrapper from '@/panels/PanelWrapper';
import { PANEL_MAP } from '@/panels/PanelRegistry';

export default function PanelDock() {
  const { panels, removePanel } = useDeckLayout();
  const { activeCategory } = useDeck();

  // Filter panels by active category
  const visiblePanels = useMemo(() => {
    if (activeCategory === 'all') return panels;
    return panels.filter(p => {
      const def = PANEL_MAP.get(p.panelId);
      return def?.category === activeCategory;
    });
  }, [panels, activeCategory]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10 p-2">
      <div className="grid grid-cols-12 gap-2 auto-rows-[80px]">
        {visiblePanels.map((p) => {
          const def = PANEL_MAP.get(p.panelId);
          if (!def) return null;
          const Component = def.component;
          const colSpan = Math.min(p.w || 4, 12);
          const rowSpan = p.h || 4;
          return (
            <div
              key={p.instanceId}
              className="min-h-0"
              style={{
                gridColumn: `span ${colSpan}`,
                gridRow: `span ${rowSpan}`,
              }}
            >
              <PanelWrapper
                panelId={p.panelId}
                instanceId={p.instanceId}
                label={def.label}
                onClose={() => removePanel(p.instanceId)}
              >
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full text-[10px] text-white/20 font-body">
                      Loading...
                    </div>
                  }
                >
                  <Component />
                </Suspense>
              </PanelWrapper>
            </div>
          );
        })}
      </div>
    </div>
  );
}

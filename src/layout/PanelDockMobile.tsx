import { Suspense, useMemo } from 'react';
import { useDeckLayout } from '@/hooks/useDeckLayout';
import { useDeck } from '@/contexts/DeckContext';
import PanelWrapper from '@/panels/PanelWrapper';
import { PANEL_MAP } from '@/panels/PanelRegistry';

export default function PanelDockMobile() {
  const { panels, removePanel } = useDeckLayout();
  const { activeCategory } = useDeck();

  const visiblePanels = useMemo(() => {
    if (activeCategory === 'all') return panels;
    return panels.filter(p => {
      const def = PANEL_MAP.get(p.panelId);
      return def?.category === activeCategory;
    });
  }, [panels, activeCategory]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden px-2 py-2 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
      {visiblePanels.map((p) => {
        const def = PANEL_MAP.get(p.panelId);
        if (!def) return null;
        const Component = def.component;
        return (
          <div key={p.instanceId}>
            <PanelWrapper
              panelId={p.panelId}
              instanceId={p.instanceId}
              label={def.label}
              onClose={() => removePanel(p.instanceId)}
            >
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-20 text-[10px] text-white/20 font-body">
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
  );
}

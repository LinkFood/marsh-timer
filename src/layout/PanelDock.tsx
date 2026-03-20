import { useMemo, Suspense, useRef, useState, useCallback, useEffect } from 'react';
import { GridLayout } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { useDeckLayout } from '@/hooks/useDeckLayout';
import { useDeck } from '@/contexts/DeckContext';
import PanelWrapper from '@/panels/PanelWrapper';
import { PANEL_MAP } from '@/panels/PanelRegistry';

export default function PanelDock() {
  const { panels, removePanel, updateLayout } = useDeckLayout();
  const { activeCategory } = useDeck();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth);
    return () => observer.disconnect();
  }, []);

  // Filter panels by active category
  const visiblePanels = useMemo(() => {
    if (activeCategory === 'all') return panels;
    return panels.filter(p => {
      const def = PANEL_MAP.get(p.panelId);
      return def?.category === activeCategory;
    });
  }, [panels, activeCategory]);

  const layout: Layout[] = useMemo(
    () =>
      visiblePanels.map((p) => {
        const def = PANEL_MAP.get(p.panelId);
        return {
          i: p.instanceId,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          minW: def?.minW ?? 2,
          minH: def?.minH ?? 2,
        };
      }),
    [visiblePanels],
  );

  const onLayoutChange = useCallback((newLayout: Layout[]) => {
    updateLayout(
      newLayout.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
    );
  }, [updateLayout]);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10">
      {width > 0 && (
        <GridLayout
          layout={layout}
          cols={12}
          rowHeight={80}
          width={width}
          draggableHandle=".panel-drag-handle"
          onLayoutChange={onLayoutChange}
          compactType="vertical"
          margin={[8, 8]}
          containerPadding={[8, 8]}
          useCSSTransforms
        >
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
        </GridLayout>
      )}
    </div>
  );
}

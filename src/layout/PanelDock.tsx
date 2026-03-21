import { useMemo, useCallback, Suspense, Component, type ReactNode } from 'react';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useDeckLayout } from '@/hooks/useDeckLayout';
import { useDeck } from '@/contexts/DeckContext';
import PanelWrapper from '@/panels/PanelWrapper';
import { PANEL_MAP } from '@/panels/PanelRegistry';

class PanelErrorBoundary extends Component<{ panelId: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  componentDidCatch(err: Error) { console.error(`[Panel:${this.props.panelId}]`, err); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-full text-[10px] text-red-400/60 font-body p-2 text-center">
          Panel crashed: {this.state.error.slice(0, 80)}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function PanelDock() {
  const { panels, removePanel, updateLayout } = useDeckLayout();
  const { activeCategory } = useDeck();
  const [containerRef, containerWidth] = useContainerWidth({ initialWidth: 1200 });

  const visiblePanels = useMemo(() => {
    if (activeCategory === 'all') return panels;
    return panels.filter(p => {
      const def = PANEL_MAP.get(p.panelId);
      return def?.category === activeCategory;
    });
  }, [panels, activeCategory]);

  const layouts = useMemo(() => ({
    lg: visiblePanels.map(p => ({
      i: p.instanceId,
      x: p.x ?? 0,
      y: p.y ?? 0,
      w: Math.min(p.w || 3, 12),
      h: p.h || 3,
      minW: 2,
      minH: 2,
    })),
  }), [visiblePanels]);

  const handleLayoutChange = useCallback((layout: any[]) => {
    updateLayout(layout.map((l: any) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
  }, [updateLayout]);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10">
      <ResponsiveGridLayout
        layouts={layouts}
        width={containerWidth}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
        cols={{ lg: 12, md: 8, sm: 6, xs: 1 }}
        rowHeight={60}
        containerPadding={[8, 8]}
        margin={[8, 8]}
        draggableHandle=".panel-drag-handle"
        onLayoutChange={handleLayoutChange}
        isResizable={true}
        isDraggable={true}
        useCSSTransforms={true}
        compactType="vertical"
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
                <PanelErrorBoundary panelId={p.panelId}>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-full text-[10px] text-white/20 font-body">
                        Loading...
                      </div>
                    }
                  >
                    <Component isFullscreen={false} />
                  </Suspense>
                </PanelErrorBoundary>
              </PanelWrapper>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}

import { useMemo, Suspense, Component, type ReactNode } from 'react';
import { useDeckLayout } from '@/hooks/useDeckLayout';
import { useDeck } from '@/contexts/DeckContext';
import PanelWrapper from '@/panels/PanelWrapper';
import { PANEL_MAP } from '@/panels/PanelRegistry';

/** Per-panel error boundary so one bad panel doesn't kill the whole dock */
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
                <PanelErrorBoundary panelId={p.panelId}>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-full text-[10px] text-white/20 font-body">
                        Loading...
                      </div>
                    }
                  >
                    <Component />
                  </Suspense>
                </PanelErrorBoundary>
              </PanelWrapper>
            </div>
          );
        })}
      </div>
    </div>
  );
}

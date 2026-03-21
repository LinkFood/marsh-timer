import type { ComponentType } from 'react';

export type PanelCategory = 'intelligence' | 'migration' | 'weather' | 'analytics';

export type GridPreset = 'default' | 'equal-grid' | 'map-focus' | '2-col' | '3-col' | '4-col';

export interface PanelDef {
  id: string;
  label: string;
  category: PanelCategory;
  description: string;
  defaultW: number;
  defaultH: number;
  minW?: number;
  minH?: number;
  component: ComponentType<PanelComponentProps>;
  refreshInterval?: string;
  dataSourceCount?: number;
  dataSources?: string[];
}

export interface PanelInstance {
  panelId: string;
  instanceId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeckState {
  panels: PanelInstance[];
  version: number;
}

export interface DeckConfig {
  id: string;
  name: string;
  panels: PanelInstance[];
  grid_preset: GridPreset;
  active_layers: string[];
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface PanelComponentProps {
  width?: number;
  height?: number;
  isFullscreen?: boolean;
}

export const DEFAULT_LAYOUT: PanelInstance[] = [
  { panelId: 'whats-happening', instanceId: 'whats-happening-1', x: 0, y: 0, w: 4, h: 5 },
  { panelId: 'convergence', instanceId: 'convergence-1', x: 4, y: 0, w: 4, h: 4 },
  { panelId: 'pattern-timeline', instanceId: 'pattern-timeline-1', x: 8, y: 0, w: 4, h: 5 },
  { panelId: 'weather-events', instanceId: 'weather-events-1', x: 0, y: 5, w: 4, h: 4 },
  { panelId: 'brain-search', instanceId: 'brain-search-1', x: 4, y: 4, w: 4, h: 5 },
];

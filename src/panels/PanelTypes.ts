import type { ComponentType } from 'react';

export type PanelCategory = 'intelligence' | 'migration' | 'weather' | 'analytics';

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

export interface PanelComponentProps {
  width?: number;
  height?: number;
}

export const DEFAULT_LAYOUT: PanelInstance[] = [
  { panelId: 'convergence', instanceId: 'convergence-1', x: 0, y: 0, w: 4, h: 4 },
  { panelId: 'migration-index', instanceId: 'migration-index-1', x: 4, y: 0, w: 4, h: 4 },
  { panelId: 'weather-events', instanceId: 'weather-events-1', x: 8, y: 0, w: 4, h: 4 },
  { panelId: 'screener', instanceId: 'screener-1', x: 0, y: 4, w: 4, h: 4 },
  { panelId: 'scout-report', instanceId: 'scout-report-1', x: 4, y: 4, w: 4, h: 4 },
  { panelId: 'brain-activity', instanceId: 'brain-activity-1', x: 8, y: 4, w: 4, h: 4 },
];

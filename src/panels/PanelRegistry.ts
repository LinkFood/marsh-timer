import { lazy } from 'react';
import type { PanelDef, PanelCategory } from './PanelTypes';

export const PANEL_REGISTRY: PanelDef[] = [
  // Intelligence
  { id: 'convergence', label: 'Convergence Scores', category: 'intelligence', description: 'Top states by hunt score', defaultW: 4, defaultH: 4, component: lazy(() => import('./ConvergencePanel')) },
  { id: 'convergence-alerts', label: 'Convergence Alerts', category: 'intelligence', description: 'Score spike alerts', defaultW: 4, defaultH: 3, component: lazy(() => import('./ConvergenceAlertsPanel')) },
  { id: 'scout-report', label: 'Scout Report', category: 'intelligence', description: 'Daily AI scout brief', defaultW: 4, defaultH: 4, component: lazy(() => import('./ScoutReportPanel')) },
  { id: 'hunt-alerts', label: 'Hunt Alerts', category: 'intelligence', description: 'Proactive hunt alerts', defaultW: 4, defaultH: 3, component: lazy(() => import('./HuntAlertsPanel')) },
  { id: 'state-profile', label: 'State Profile', category: 'intelligence', description: 'Full state deep-dive', defaultW: 6, defaultH: 6, component: lazy(() => import('./StateProfilePanel')) },

  // Migration
  { id: 'migration-index', label: 'Migration Index', category: 'migration', description: 'Migration momentum tracker', defaultW: 4, defaultH: 4, component: lazy(() => import('./MigrationIndexPanel')) },
  { id: 'ebird', label: 'eBird Feed', category: 'migration', description: 'eBird sighting activity', defaultW: 4, defaultH: 4, component: lazy(() => import('./EBirdPanel')) },
  { id: 'du-reports', label: 'DU Reports', category: 'migration', description: 'DU migration articles', defaultW: 4, defaultH: 3, component: lazy(() => import('./DUReportsPanel')) },
  { id: 'screener', label: 'State Screener', category: 'migration', description: 'Sortable state convergence table', defaultW: 6, defaultH: 5, component: lazy(() => import('./ScreenerPanel')) },

  // Weather
  { id: 'weather-events', label: 'Weather Events', category: 'weather', description: 'Real-time weather events', defaultW: 4, defaultH: 4, component: lazy(() => import('./WeatherEventsPanel')) },
  { id: 'nws-alerts', label: 'NWS Alerts', category: 'weather', description: 'Severe weather alerts', defaultW: 4, defaultH: 3, component: lazy(() => import('./NWSAlertsPanel')) },
  { id: 'weather-forecast', label: 'Weather Forecast', category: 'weather', description: '16-day forecast', defaultW: 4, defaultH: 4, component: lazy(() => import('./WeatherForecastPanel')) },
  { id: 'solunar', label: 'Solunar', category: 'weather', description: 'Moon/sun data', defaultW: 4, defaultH: 3, component: lazy(() => import('./SolunarPanel')) },

  // Analytics
  { id: 'history-replay', label: 'History Replay', category: 'analytics', description: '30-day replay controls', defaultW: 6, defaultH: 4, component: lazy(() => import('./HistoryReplayPanel')) },
  { id: 'convergence-history', label: 'Convergence History', category: 'analytics', description: 'Trend charts', defaultW: 4, defaultH: 4, component: lazy(() => import('./ConvergenceHistoryPanel')) },
  { id: 'brain-activity', label: 'Brain Activity', category: 'analytics', description: 'Cron health + brain stats', defaultW: 4, defaultH: 4, component: lazy(() => import('./BrainActivityPanel')) },
  { id: 'brain-search', label: 'Brain Search', category: 'intelligence', description: 'Search 212K+ brain entries', defaultW: 4, defaultH: 5, component: lazy(() => import('./BrainSearchPanel')) },
];

export const PANEL_MAP = new Map(PANEL_REGISTRY.map(p => [p.id, p]));

export function getPanelsByCategory(category: PanelCategory): PanelDef[] {
  return PANEL_REGISTRY.filter(p => p.category === category);
}

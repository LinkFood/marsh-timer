import { lazy } from 'react';
import type { PanelDef, PanelCategory } from './PanelTypes';

export const PANEL_REGISTRY: PanelDef[] = [
  // Intelligence
  { id: 'convergence', label: 'Convergence Scores', category: 'intelligence', description: 'Top states by hunt score', defaultW: 4, defaultH: 4, component: lazy(() => import('./ConvergencePanel')), refreshInterval: 'daily', dataSourceCount: 4, dataSources: ['Convergence Engine'] },
  { id: 'convergence-alerts', label: 'Convergence Alerts', category: 'intelligence', description: 'Score spike alerts', defaultW: 4, defaultH: 3, component: lazy(() => import('./ConvergenceAlertsPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Convergence Engine'] },
  { id: 'scout-report', label: 'Scout Report', category: 'intelligence', description: 'Daily AI scout brief', defaultW: 4, defaultH: 4, component: lazy(() => import('./ScoutReportPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Scout Reports'] },
  { id: 'hunt-alerts', label: 'Hunt Alerts', category: 'intelligence', description: 'Proactive hunt alerts', defaultW: 4, defaultH: 3, component: lazy(() => import('./HuntAlertsPanel')), refreshInterval: 'daily', dataSourceCount: 3, dataSources: ['Open-Meteo', 'Brain Search', 'Convergence Engine'] },
  { id: 'state-profile', label: 'State Profile', category: 'intelligence', description: 'Full state deep-dive', defaultW: 6, defaultH: 6, component: lazy(() => import('./StateProfilePanel')), refreshInterval: 'daily', dataSourceCount: 5, dataSources: ['Convergence Engine', 'Open-Meteo', 'eBird', 'Solunar', 'State Regulations'] },

  // Migration
  { id: 'migration-index', label: 'Migration Index', category: 'migration', description: 'Migration momentum tracker', defaultW: 4, defaultH: 4, component: lazy(() => import('./MigrationIndexPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['eBird'] },
  { id: 'ebird', label: 'eBird Feed', category: 'migration', description: 'eBird sighting activity', defaultW: 4, defaultH: 4, component: lazy(() => import('./EBirdPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Cornell Lab'] },
  { id: 'du-reports', label: 'DU Reports', category: 'migration', description: 'DU migration articles', defaultW: 4, defaultH: 3, component: lazy(() => import('./DUReportsPanel')), refreshInterval: 'weekly', dataSourceCount: 2, dataSources: ['DU Migration Map', 'DU Alert Articles'] },
  { id: 'screener', label: 'State Screener', category: 'migration', description: 'Sortable state convergence table', defaultW: 6, defaultH: 5, component: lazy(() => import('./ScreenerPanel')), refreshInterval: 'daily', dataSourceCount: 4, dataSources: ['Convergence Engine'] },

  // Weather
  { id: 'weather-events', label: 'Weather Events', category: 'weather', description: 'Real-time weather events', defaultW: 4, defaultH: 4, component: lazy(() => import('./WeatherEventsPanel')), refreshInterval: '15min', dataSourceCount: 1, dataSources: ['ASOS/METAR'] },
  { id: 'nws-alerts', label: 'NWS Alerts', category: 'weather', description: 'Severe weather alerts', defaultW: 4, defaultH: 3, component: lazy(() => import('./NWSAlertsPanel')), refreshInterval: '3hr', dataSourceCount: 1, dataSources: ['NWS API'] },
  { id: 'weather-forecast', label: 'Weather Forecast', category: 'weather', description: '16-day forecast', defaultW: 4, defaultH: 4, component: lazy(() => import('./WeatherForecastPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Open-Meteo'] },
  { id: 'solunar', label: 'Solunar', category: 'weather', description: 'Moon/sun data', defaultW: 4, defaultH: 3, component: lazy(() => import('./SolunarPanel')), refreshInterval: 'weekly', dataSourceCount: 1, dataSources: ['Solunar Calendar'] },

  // Analytics
  { id: 'history-replay', label: 'History Replay', category: 'analytics', description: '30-day replay controls', defaultW: 6, defaultH: 4, component: lazy(() => import('./HistoryReplayPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Convergence Engine'] },
  { id: 'convergence-history', label: 'Convergence History', category: 'analytics', description: 'Trend charts', defaultW: 4, defaultH: 4, component: lazy(() => import('./ConvergenceHistoryPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Convergence Engine'] },
  { id: 'brain-activity', label: 'Brain Activity', category: 'analytics', description: 'Cron health + brain stats', defaultW: 4, defaultH: 4, component: lazy(() => import('./BrainActivityPanel')), refreshInterval: 'real-time', dataSourceCount: 14, dataSources: ['All Crons'] },
  { id: 'brain-search', label: 'Brain Search', category: 'intelligence', description: 'Search 295K+ brain entries', defaultW: 4, defaultH: 5, component: lazy(() => import('./BrainSearchPanel')), refreshInterval: 'real-time', dataSourceCount: 21, dataSources: ['All Sources'] },
  { id: 'chat', label: 'Brain Chat', category: 'intelligence', description: 'Talk to the brain', defaultW: 4, defaultH: 6, component: lazy(() => import('./ChatPanelInline')), refreshInterval: 'real-time', dataSourceCount: 21, dataSources: ['All Sources'] },
];

export const PANEL_MAP = new Map(PANEL_REGISTRY.map(p => [p.id, p]));

export function getPanelsByCategory(category: PanelCategory): PanelDef[] {
  return PANEL_REGISTRY.filter(p => p.category === category);
}

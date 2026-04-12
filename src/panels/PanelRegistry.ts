import { lazy } from 'react';
import type { PanelDef, PanelCategory } from './PanelTypes';

export const PANEL_REGISTRY: PanelDef[] = [
  // Intelligence
  { id: 'convergence', label: 'Convergence Scores', category: 'intelligence', description: 'Environmental convergence index by state', defaultW: 3, defaultH: 3, component: lazy(() => import('./ConvergencePanel')), refreshInterval: 'daily', dataSourceCount: 4, dataSources: ['Convergence Engine'] },
  { id: 'convergence-alerts', label: 'Convergence Alerts', category: 'intelligence', description: 'Pattern spike detection alerts', defaultW: 3, defaultH: 3, component: lazy(() => import('./ConvergenceAlertsPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Convergence Engine'] },
  { id: 'scout-report', label: 'Daily Brief', category: 'intelligence', description: 'AI-generated environmental intelligence summary', defaultW: 3, defaultH: 3, component: lazy(() => import('./ScoutReportPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Scout Reports'] },
  { id: 'hunt-alerts', label: 'Pattern Alerts', category: 'intelligence', description: 'Proactive environmental pattern alerts', defaultW: 3, defaultH: 3, component: lazy(() => import('./PatternAlertsPanel')), refreshInterval: 'daily', dataSourceCount: 3, dataSources: ['Open-Meteo', 'Brain Search', 'Convergence Engine'] },
  { id: 'disaster-watch', label: 'Disaster Watch', category: 'intelligence', description: 'Climate disaster early warning — 2-6 month predictive signals', defaultW: 3, defaultH: 4, component: lazy(() => import('./DisasterWatchPanel')), refreshInterval: 'weekly', dataSourceCount: 5, dataSources: ['AO', 'NAO', 'PDO', 'ENSO', 'PNA'] },
  { id: 'whats-happening', label: "What's Happening", category: 'intelligence', description: 'Real-time environmental signal feed', defaultW: 3, defaultH: 4, component: lazy(() => import('./WhatsHappeningPanel')), refreshInterval: 'real-time', dataSourceCount: 3, dataSources: ['Convergence', 'Weather Events', 'NWS'] },
  { id: 'state-profile', label: 'State Profile', category: 'intelligence', description: 'State-level environmental intelligence', defaultW: 4, defaultH: 5, component: lazy(() => import('./StateProfilePanel')), refreshInterval: 'daily', dataSourceCount: 5, dataSources: ['Convergence Engine', 'Open-Meteo', 'eBird', 'Lunar', 'State Regulations'] },
  { id: 'map', label: 'Map View', category: 'intelligence', description: 'Geographic intelligence view', defaultW: 4, defaultH: 4, component: lazy(() => import('./MapPanel')), refreshInterval: 'real-time', dataSourceCount: 0, dataSources: [] },

  // Migration
  { id: 'migration-index', label: 'Migration Index', category: 'migration', description: 'Migration momentum tracker', defaultW: 3, defaultH: 3, component: lazy(() => import('./MigrationIndexPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['eBird'] },
  { id: 'ebird', label: 'eBird Feed', category: 'migration', description: 'eBird sighting activity', defaultW: 3, defaultH: 3, component: lazy(() => import('./EBirdPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Cornell Lab'] },
  { id: 'du-reports', label: 'DU Reports', category: 'migration', description: 'DU migration articles', defaultW: 3, defaultH: 3, component: lazy(() => import('./DUReportsPanel')), refreshInterval: 'weekly', dataSourceCount: 2, dataSources: ['DU Migration Map', 'DU Alert Articles'] },
  { id: 'screener', label: 'State Screener', category: 'migration', description: 'Sortable state convergence table', defaultW: 4, defaultH: 4, component: lazy(() => import('./ScreenerPanel')), refreshInterval: 'daily', dataSourceCount: 4, dataSources: ['Convergence Engine'] },

  // Weather
  { id: 'weather-events', label: 'Weather Events', category: 'weather', description: 'Real-time weather events', defaultW: 3, defaultH: 3, component: lazy(() => import('./WeatherEventsPanel')), refreshInterval: '15min', dataSourceCount: 1, dataSources: ['ASOS/METAR'] },
  { id: 'nws-alerts', label: 'NWS Alerts', category: 'weather', description: 'Severe weather alerts', defaultW: 3, defaultH: 3, component: lazy(() => import('./NWSAlertsPanel')), refreshInterval: '3hr', dataSourceCount: 1, dataSources: ['NWS API'] },
  { id: 'weather-forecast', label: 'Weather Forecast', category: 'weather', description: '16-day forecast', defaultW: 3, defaultH: 3, component: lazy(() => import('./WeatherForecastPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Open-Meteo'] },
  { id: 'solunar', label: 'Lunar', category: 'weather', description: 'Moon/sun data', defaultW: 3, defaultH: 3, component: lazy(() => import('./SolunarPanel')), refreshInterval: 'weekly', dataSourceCount: 1, dataSources: ['Solunar Calendar'] },

  // Analytics
  { id: 'history-replay', label: 'History Replay', category: 'analytics', description: '30-day replay controls', defaultW: 4, defaultH: 3, component: lazy(() => import('./HistoryReplayPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Convergence Engine'] },
  { id: 'convergence-history', label: 'Convergence History', category: 'analytics', description: 'Trend charts', defaultW: 3, defaultH: 3, component: lazy(() => import('./ConvergenceHistoryPanel')), refreshInterval: 'daily', dataSourceCount: 1, dataSources: ['Convergence Engine'] },
  { id: 'brain-activity', label: 'Brain Activity', category: 'analytics', description: 'Cron health + brain stats', defaultW: 3, defaultH: 3, component: lazy(() => import('./BrainActivityPanel')), refreshInterval: 'real-time', dataSourceCount: 14, dataSources: ['All Crons'] },
  { id: 'admin-console', label: 'Admin Console', category: 'analytics', description: 'System health, cron status, web discoveries', defaultW: 4, defaultH: 5, component: lazy(() => import('./AdminConsolePanel')), refreshInterval: 'real-time', dataSourceCount: 14, dataSources: ['All Crons'] },
  { id: 'pattern-timeline', label: 'Pattern Timeline', category: 'analytics', description: 'Historical pattern matches for current conditions', defaultW: 3, defaultH: 4, component: lazy(() => import('./PatternTimelinePanel')), refreshInterval: 'on-demand', dataSourceCount: 21, dataSources: ['Brain Search'] },
  { id: 'brain-search', label: 'Brain Search', category: 'intelligence', description: 'Search 2M+ brain entries', defaultW: 3, defaultH: 4, component: lazy(() => import('./BrainSearchPanel')), refreshInterval: 'real-time', dataSourceCount: 21, dataSources: ['All Sources'] },
  { id: 'chat', label: 'Brain Chat', category: 'intelligence', description: 'Ask the environmental intelligence engine', defaultW: 3, defaultH: 5, component: lazy(() => import('./ChatPanelInline')), refreshInterval: 'real-time', dataSourceCount: 21, dataSources: ['All Sources'] },
];

export const PANEL_MAP = new Map(PANEL_REGISTRY.map(p => [p.id, p]));

export function getPanelsByCategory(category: PanelCategory): PanelDef[] {
  return PANEL_REGISTRY.filter(p => p.category === category);
}

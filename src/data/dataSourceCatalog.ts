export interface DataSourceDef {
  id: string;
  name: string;
  provider: string;
  category: 'weather' | 'migration' | 'environment' | 'intelligence' | 'satellite' | 'government';
  cronFunction?: string;
  refreshInterval: 'real-time' | '15min' | '3hr' | 'daily' | 'weekly' | 'static' | 'on-demand';
  description: string;
}

export const DATA_SOURCE_CATALOG: DataSourceDef[] = [
  // Weather
  { id: 'open-meteo', name: 'Live Weather Forecasts', provider: 'Open-Meteo', category: 'weather', cronFunction: 'hunt-weather-watchdog', refreshInterval: 'daily', description: '50-state 16-day forecast + environmental event detection' },
  { id: 'asos-metar', name: 'Real-Time Station Data', provider: 'ASOS/METAR', category: 'weather', cronFunction: 'hunt-weather-realtime', refreshInterval: '15min', description: '130-station live weather monitoring' },
  { id: 'nws-alerts', name: 'NWS Severe Alerts', provider: 'NWS API', category: 'weather', cronFunction: 'hunt-nws-monitor', refreshInterval: '3hr', description: 'Filtered severe weather alerts' },
  { id: 'rainviewer', name: 'Weather Radar', provider: 'RainViewer', category: 'weather', refreshInterval: 'real-time', description: 'Live radar overlay (frontend)' },

  // Migration
  { id: 'ebird', name: 'eBird Sightings', provider: 'Cornell Lab', category: 'migration', cronFunction: 'hunt-migration-monitor', refreshInterval: 'daily', description: 'eBird spike detection across 50 states' },
  { id: 'birdcast', name: 'BirdCast Radar', provider: 'BirdCast', category: 'migration', cronFunction: 'hunt-birdcast', refreshInterval: 'daily', description: 'Radar migration intensity' },
  { id: 'du-map', name: 'DU Migration Map', provider: 'Ducks Unlimited', category: 'migration', cronFunction: 'hunt-du-map', refreshInterval: 'weekly', description: 'Migration map pins' },
  { id: 'du-alerts', name: 'DU Alert Articles', provider: 'Ducks Unlimited', category: 'migration', cronFunction: 'hunt-du-alerts', refreshInterval: 'weekly', description: 'Migration alert articles' },
  { id: 'inaturalist', name: 'iNaturalist Obs', provider: 'iNaturalist', category: 'migration', cronFunction: 'hunt-inaturalist', refreshInterval: 'on-demand', description: 'Deer/turkey/dove observations' },

  // Satellite
  { id: 'nasa-power', name: 'NASA POWER Satellite', provider: 'NASA', category: 'satellite', cronFunction: 'hunt-nasa-power', refreshInterval: 'daily', description: 'Solar/cloud satellite data' },

  // Environment
  { id: 'drought-monitor', name: 'US Drought Monitor', provider: 'USDA', category: 'environment', cronFunction: 'hunt-drought-monitor', refreshInterval: 'weekly', description: 'Weekly drought severity' },
  { id: 'photoperiod', name: 'Photoperiod', provider: 'Calculated', category: 'environment', refreshInterval: 'static', description: 'Daylight calculations (35K entries)' },
  { id: 'usgs-water', name: 'USGS Water Levels', provider: 'USGS', category: 'environment', refreshInterval: 'on-demand', description: 'Water levels across US' },
  { id: 'noaa-tides', name: 'NOAA Tides', provider: 'NOAA', category: 'environment', refreshInterval: 'on-demand', description: 'Coastal tide readings' },
  { id: 'climate-normals', name: 'Climate Normals', provider: 'NOAA ACIS', category: 'environment', refreshInterval: 'static', description: 'Historical climate baselines' },
  { id: 'crop-progress', name: 'USDA Crop Progress', provider: 'USDA', category: 'environment', refreshInterval: 'static', description: 'Crop progress affecting habitat' },
  { id: 'air-quality', name: 'Air Quality Index', provider: 'Open-Meteo', category: 'environment', cronFunction: 'hunt-air-quality', refreshInterval: 'daily', description: 'AQI, PM2.5, ozone for 50 states' },
  { id: 'soil-conditions', name: 'Soil Monitor', provider: 'Open-Meteo', category: 'environment', cronFunction: 'hunt-soil-monitor', refreshInterval: 'daily', description: 'Soil temperature and moisture for 50 states' },
  { id: 'river-discharge', name: 'River Discharge', provider: 'Open-Meteo', category: 'environment', cronFunction: 'hunt-river-discharge', refreshInterval: 'daily', description: 'River flow vs median + flood status' },
  { id: 'ocean-buoy', name: 'Ocean Buoys', provider: 'NOAA NDBC', category: 'environment', cronFunction: 'hunt-ocean-buoy', refreshInterval: 'daily', description: 'SST, waves, pressure from 27 coastal buoys' },
  { id: 'space-weather', name: 'Space Weather', provider: 'NOAA SWPC', category: 'environment', cronFunction: 'hunt-space-weather', refreshInterval: 'daily', description: 'Solar wind, Kp index, X-ray flux' },
  { id: 'wildfire-perimeters', name: 'Wildfire Perimeters', provider: 'NIFC', category: 'environment', cronFunction: 'hunt-wildfire-perimeters', refreshInterval: 'daily', description: 'Active fire perimeters and containment' },

  // Intelligence
  { id: 'solunar', name: 'Solunar Calendar', provider: 'Calculated', category: 'intelligence', cronFunction: 'hunt-solunar-precompute', refreshInterval: 'weekly', description: '365-day precomputed solunar data' },
  { id: 'convergence', name: 'Convergence Engine', provider: 'Internal', category: 'intelligence', cronFunction: 'hunt-convergence-engine', refreshInterval: 'daily', description: '4-component scoring per state' },
  { id: 'scout-reports', name: 'Scout Reports', provider: 'Internal AI', category: 'intelligence', cronFunction: 'hunt-scout-report', refreshInterval: 'daily', description: 'Daily AI scout briefs' },

  // Government
  { id: 'species-knowledge', name: 'Species Knowledge', provider: 'Curated', category: 'government', refreshInterval: 'static', description: '152 behavioral entries across 39 monitored species' },
  { id: 'state-regulations', name: 'State Regulations', provider: 'State DNRs', category: 'government', refreshInterval: 'static', description: 'Hunting regulation links per species/state' },
];

export const DATA_SOURCE_MAP = new Map(DATA_SOURCE_CATALOG.map(s => [s.id, s]));

export function getSourcesByCronFunction(cronFn: string): DataSourceDef | undefined {
  return DATA_SOURCE_CATALOG.find(s => s.cronFunction === cronFn);
}

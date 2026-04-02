import type { LayerDef, LayerPreset } from './LayerTypes';

export const LAYER_REGISTRY: LayerDef[] = [
  // === Environment ===
  { id: 'wetlands', label: 'Wetlands', category: 'environment', description: 'NWI wetland polygons', mapboxLayers: ['wetland-fill'] },
  { id: 'water-bodies', label: 'Water Bodies', category: 'environment', description: 'Lakes, reservoirs, ponds', mapboxLayers: ['water-fill'] },
  { id: 'waterways', label: 'Waterways', category: 'environment', description: 'Rivers, streams, canals', mapboxLayers: ['waterway-lines', 'waterway-intermittent', 'waterway-labels'] },
  { id: 'parks', label: 'Parks', category: 'environment', description: 'National and state parks', mapboxLayers: ['parks-fill'] },
  { id: 'trails', label: 'Trails', category: 'environment', description: 'Hiking and access trails', mapboxLayers: ['trails-lines'] },
  { id: 'agriculture', label: 'Agriculture', category: 'environment', description: 'Cropland and agricultural zones', mapboxLayers: ['agriculture-fill'] },
  { id: 'land-cover', label: 'Land Cover', category: 'environment', description: 'NLCD land classification', mapboxLayers: ['landcover-fill'] },
  { id: 'contours', label: 'Contours', category: 'environment', description: 'Elevation contour lines', mapboxLayers: ['contour-lines', 'contour-labels'] },
  { id: 'counties', label: 'Counties', category: 'environment', description: 'County boundaries', mapboxLayers: ['county-fill'] },

  // === Migration ===
  { id: 'ebird-heatmap', label: 'eBird Heatmap', category: 'migration', description: 'Sighting density heatmap', mapboxLayers: ['ebird-heatmap'], defaultOn: true },
  { id: 'ebird-clusters', label: 'eBird Clusters', category: 'migration', description: 'Individual sighting clusters', mapboxLayers: ['ebird-dots', 'ebird-clusters', 'ebird-cluster-count', 'ebird-cluster-glow'] },
  { id: 'flyway-corridors', label: 'Flyway Corridors', category: 'migration', description: 'Major flyway boundaries', mapboxLayers: ['flyway-corridor-fill', 'flyway-corridor-labels'] },
  { id: 'flyway-flow', label: 'Flyway Flow', category: 'migration', description: 'Directional migration flow', mapboxLayers: ['flyway-flow-lines'] },
  { id: 'migration-front', label: 'Migration Front', category: 'migration', description: 'Leading edge of migration wave', mapboxLayers: ['migration-front-line', 'migration-front-label', 'migration-front-glow'] },
  { id: 'du-pins', label: 'DU Pins', category: 'migration', description: 'Ducks Unlimited report pins', mapboxLayers: ['du-pins-dots', 'du-pins-clusters', 'du-pins-cluster-count'] },
  { id: 'birdcast', label: 'BirdCast', category: 'migration', description: 'Radar migration intensity by state', mapboxLayers: ['birdcast-fill'] },

  // === Weather ===
  { id: 'radar', label: 'Radar', category: 'weather', description: 'NEXRAD precipitation radar', mapboxLayers: ['radar-overlay'] },
  { id: 'wind-flow', label: 'Wind Flow', category: 'weather', description: 'Surface wind speed and direction', mapboxLayers: ['wind-flow', 'wind-speed-labels', 'wind-arrow-heads'], defaultOn: true },
  { id: 'isobars', label: 'Isobars', category: 'weather', description: 'Pressure contours and centers', mapboxLayers: ['isobar-lines', 'pressure-center-labels'] },
  { id: 'pressure-trends', label: 'Pressure Trends', category: 'weather', description: 'Rising/falling pressure arrows', mapboxLayers: ['pressure-trend-arrows'], defaultOn: true },
  { id: 'nws-alerts', label: 'NWS Alerts', category: 'weather', description: 'Active severe weather warnings', mapboxLayers: ['nws-alert-fill', 'nws-alert-outline', 'nws-alert-labels'] },
  { id: 'weather-events', label: 'Weather Events', category: 'weather', description: 'Detected weather events', mapboxLayers: ['weather-event-circles', 'weather-event-pulse', 'weather-event-labels'], defaultOn: true },
  { id: 'ocean-buoys', label: 'Ocean Buoys', category: 'weather', description: 'NOAA NDBC buoy observations', mapboxLayers: ['buoy-circles', 'buoy-labels'], defaultOn: true },
  { id: 'temperature', label: 'Temperature', category: 'weather', description: 'Surface temperature overlay', mapboxLayers: ['temp-tiles-overlay'] },

  // === Intelligence ===
  { id: 'convergence-heatmap', label: 'Convergence Heatmap', category: 'intelligence', description: '3D state extrusion by score', mapboxLayers: ['states-extrusion'], defaultOn: true },
  { id: 'convergence-scores', label: 'Score Labels', category: 'intelligence', description: 'Numeric score pills on states', mapboxLayers: ['convergence-score-bg', 'convergence-score-label', 'convergence-forming-label'] },
  { id: 'state-abbr-labels', label: 'State Labels', category: 'intelligence', description: 'State abbreviation labels', mapboxLayers: ['state-abbr-labels'], defaultOn: true },
  { id: 'convergence-pulse', label: 'Convergence Pulse', category: 'intelligence', description: 'Pulsing glow on high-score states', mapboxLayers: ['convergence-pulse'], defaultOn: true },
  { id: 'perfect-storm', label: 'Perfect Storm', category: 'intelligence', description: 'Ring highlight on max convergence', mapboxLayers: ['perfect-storm-glow', 'perfect-storm-ring'], defaultOn: true },
  { id: 'convergence-delta', label: '24h Change', category: 'intelligence', description: 'Score change from yesterday', mapboxLayers: ['convergence-delta-labels'], defaultOn: false },
  { id: 'arc-phase', label: 'Arc Phase', category: 'intelligence', description: 'State outlines colored by active arc phase', mapboxLayers: ['arc-phase-outline'], defaultOn: true },
  { id: 'brain-connections', label: 'Brain Activity', category: 'intelligence', description: 'Cross-domain pattern link hotspots', mapboxLayers: ['brain-activity-glow', 'brain-activity-count'], defaultOn: true },

  // === Terrain ===
  { id: 'satellite', label: 'Satellite', category: 'terrain', description: 'Satellite imagery basemap', mapboxLayers: [], defaultOn: true },
  { id: '3d-terrain', label: '3D Terrain', category: 'terrain', description: 'Elevation-based terrain', mapboxLayers: [], defaultOn: true },
];

export const LAYER_PRESETS: LayerPreset[] = [
  {
    id: 'scout',
    label: 'Field Recon',
    description: 'Field recon: wetlands, water, parks, trails, eBird clusters',
    layers: ['wetlands', 'water-bodies', 'waterways', 'parks', 'trails', 'ebird-clusters', 'counties', 'flyway-corridors'],
  },
  {
    id: 'weather',
    label: 'Weather',
    description: 'Full weather picture: radar, wind, isobars, NWS alerts, events',
    layers: ['radar', 'wind-flow', 'isobars', 'pressure-trends', 'nws-alerts', 'weather-events', 'ocean-buoys'],
  },
  {
    id: 'intel',
    label: 'Intelligence',
    description: 'Convergence heatmap, pulse, migration front, perfect storm',
    layers: ['convergence-heatmap', 'convergence-pulse', 'perfect-storm', 'arc-phase', 'brain-connections', 'migration-front', 'nws-alerts', 'weather-events', 'ocean-buoys', 'wind-flow', 'ebird-heatmap'],
  },
  {
    id: 'terrain',
    label: 'Terrain',
    description: 'Land cover, contours, 3D terrain',
    layers: ['land-cover', 'contours', '3d-terrain', 'satellite'],
  },
];

export const LAYER_MAP = new Map(LAYER_REGISTRY.map(l => [l.id, l]));

/** Get all Mapbox layer IDs controlled by a logical layer */
export function getMapboxLayerIds(layerId: string): string[] {
  return LAYER_MAP.get(layerId)?.mapboxLayers ?? [];
}

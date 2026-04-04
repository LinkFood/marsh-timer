import {
  Cloud, Bird, Droplets, Thermometer, Mountain, PawPrint,
  Globe, Moon, Brain, Clock, FileText, Database
} from 'lucide-react';

export interface ContentTypeGroup {
  key: string;
  label: string;
  icon: typeof Cloud;
  color: string;
  types: string[];
  description: string;
}

export const CONTENT_TYPE_GROUPS: ContentTypeGroup[] = [
  {
    key: 'weather',
    label: 'Weather',
    icon: Cloud,
    color: 'text-orange-400 bg-orange-400/10',
    description: 'Forecasts, events, alerts, radar',
    types: [
      'weather-daily', 'weather-forecast', 'weather-event', 'weather-realtime',
      'weather-pattern', 'nws-alert', 'pressure-tendency', 'forecast-accuracy',
    ],
  },
  {
    key: 'storms',
    label: 'Storm History',
    icon: Clock,
    color: 'text-red-400 bg-red-400/10',
    description: '35 years of NOAA storm events (1990–2025)',
    types: ['storm-event'],
  },
  {
    key: 'migration',
    label: 'Migration',
    icon: Bird,
    color: 'text-cyan-400 bg-cyan-400/10',
    description: 'Bird migration radar, spikes, acoustic',
    types: [
      'migration-daily', 'migration-spike', 'migration-spike-extreme',
      'migration-spike-significant', 'migration-spike-moderate', 'migration-lull',
      'migration-report-card', 'birdcast-daily', 'birdcast-historical',
      'birdweather-daily', 'birdweather-acoustic', 'ebird-hotspot',
      'murmuration-index',
    ],
  },
  {
    key: 'water',
    label: 'Water',
    icon: Droplets,
    color: 'text-blue-400 bg-blue-400/10',
    description: 'Rivers, tides, ocean buoys, discharge',
    types: [
      'usgs-water', 'noaa-tide', 'river-discharge', 'ocean-buoy',
    ],
  },
  {
    key: 'climate',
    label: 'Climate',
    icon: Thermometer,
    color: 'text-purple-400 bg-purple-400/10',
    description: '76 years of AO, NAO, PNA, ENSO, PDO indices',
    types: [
      'climate-index', 'climate-index-daily', 'climate-normal',
      'drought-weekly', 'disaster-watch',
    ],
  },
  {
    key: 'land',
    label: 'Soil & Land',
    icon: Mountain,
    color: 'text-amber-400 bg-amber-400/10',
    description: 'Soil, crops, wildfire, snow, evapotranspiration',
    types: [
      'soil-conditions', 'crop-progress', 'crop-progress-weekly', 'crop-data',
      'wildfire-perimeter', 'fire-activity', 'snow-cover-monthly', 'snotel-daily',
      'evapotranspiration',
    ],
  },
  {
    key: 'wildlife',
    label: 'Wildlife',
    icon: PawPrint,
    color: 'text-emerald-400 bg-emerald-400/10',
    description: 'iNaturalist, GBIF, USFWS breeding surveys',
    types: [
      'inaturalist-monthly', 'inaturalist-daily', 'gbif-monthly',
      'usfws-breeding-survey', 'usfws_breeding', 'usfws_harvest', 'usfws_hip',
      'phenology-observation', 'species-behavior',
    ],
  },
  {
    key: 'atmosphere',
    label: 'Atmosphere & Space',
    icon: Globe,
    color: 'text-violet-400 bg-violet-400/10',
    description: 'Air quality, geomagnetic, solar, power outages',
    types: [
      'air-quality', 'geomagnetic-kp', 'space-weather', 'nasa-daily',
      'solar-radiation', 'cloud-visibility', 'humidity-profile',
      'power-outage', 'pollen-data',
    ],
  },
  {
    key: 'solunar',
    label: 'Solunar',
    icon: Moon,
    color: 'text-yellow-400 bg-yellow-400/10',
    description: 'Moon phase, feeding windows, photoperiod',
    types: ['solunar-weekly', 'photoperiod'],
  },
  {
    key: 'intelligence',
    label: 'Brain Intel',
    icon: Brain,
    color: 'text-pink-400 bg-pink-400/10',
    description: 'AI synthesis, anomalies, correlations, convergence',
    types: [
      'convergence-score', 'convergence-report-card', 'compound-risk-alert',
      'anomaly-alert', 'correlation-discovery', 'ai-synthesis',
      'state-brief', 'bio-environmental-correlation',
      'arc-fingerprint', 'arc-grade-reasoning', 'alert-grade', 'alert-calibration',
    ],
  },
  {
    key: 'historical',
    label: 'Historical',
    icon: Clock,
    color: 'text-stone-400 bg-stone-400/10',
    description: 'Newspapers, earthquake events, ice cover',
    types: [
      'historical-newspaper', 'earthquake-event', 'glerl-ice-cover',
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: FileText,
    color: 'text-teal-400 bg-teal-400/10',
    description: 'DU reports, regulations, search trends',
    types: [
      'du_report', 'du_alert', 'regulation', 'hunting-knowledge',
      'fact', 'search-trends', 'weather-forecast',
    ],
  },
];

export const ALL_DOMAINS_GROUP: ContentTypeGroup = {
  key: 'all',
  label: 'All Domains',
  icon: Database,
  color: 'text-white/60 bg-white/[0.06]',
  description: 'Search everything',
  types: [],
};

/** Look up which group a content_type belongs to */
export function getGroupForType(contentType: string): ContentTypeGroup | null {
  return CONTENT_TYPE_GROUPS.find(g => g.types.includes(contentType)) || null;
}

/** Get the color class for any content_type */
export function typeColor(contentType: string): string {
  const group = getGroupForType(contentType);
  return group?.color || 'text-white/50 bg-white/[0.06]';
}

/** Get content_types array for a group key, or null for 'all' */
export function getTypesForGroup(groupKey: string | null): string[] | null {
  if (!groupKey || groupKey === 'all') return null;
  const group = CONTENT_TYPE_GROUPS.find(g => g.key === groupKey);
  return group?.types || null;
}

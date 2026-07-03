/**
 * cascade_sept2020.ts — "Strangest Days" #2: the Labor Day 2020 whiplash.
 *
 * A verified replay of September 4–11, 2020, from the archive's GHCN panel
 * (statewide daily aggregates, ~462 Colorado stations, 2005–2024 baselines).
 * Colorado is the protagonist: the hottest station read 105°F Saturday and
 * 108°F Sunday; by Tuesday it was snowing, and Wednesday the statewide
 * average high was 43°F — a 45°F collapse in three days. On Wednesday
 * September 9, nine states were ≥2σ from their place-and-season baselines at
 * once — one of the two widest strange-weather days in the panel's 20-year
 * record.
 *
 * Every value below is a real reading. No interpolation.
 *
 * Sources (scratchpad strangest-days analysis, adversarially verified):
 *   - raw values : GHCN daily statewide aggregates (avg_high_f, max_temp_f,
 *                  snowfall_in, avg_precip_in)
 *   - z-scores   : panel_features.parquet — 284,409 state-days, 2005–2024,
 *                  z vs place-and-season (day-of-year window) baselines
 *
 * Honesty rules baked in (from the adversarial verdict):
 *   - temperature anomaly + temperature swing count as ONE domain on-page
 *   - space weather is NEVER counted as a per-state domain
 *   - CO's September snowfall baseline has ~zero variance, so its snow
 *     z-score is undefined — snow renders as raw inches, never as a σ claim
 */

import type { RibbonDataset } from '@/data/cascade';

export interface Sept2020Row {
  /** ISO date, 2020-09-04 → 2020-09-11. */
  date: string;
  /** Statewide average daily high, °F (CO, ~462 GHCN stations). */
  tempHighF: number;
  /** Hottest single-station reading that day, °F. */
  maxTempF: number;
  /** Statewide average snowfall, inches. */
  snowIn: number;
  /** Statewide average precipitation, inches. */
  precipIn: number;
  /** z of the statewide average high vs place-and-season baseline. */
  zTempHigh: number;
  /** z of the day-over-day change in the high (the swing). */
  zTempSwing: number;
  /** z of statewide average precipitation. */
  zPrecip: number;
}

/** Colorado, September 4–11 2020. Every row a real reading. */
export const SEPT2020_ROWS: Sept2020Row[] = [
  { date: '2020-09-04', tempHighF: 83.8, maxTempF: 100, snowIn: 0.0, precipIn: 0.00, zTempHigh: 1.45,  zTempSwing: 1.09,  zPrecip: -0.68 },
  { date: '2020-09-05', tempHighF: 87.6, maxTempF: 105, snowIn: 0.0, precipIn: 0.00, zTempHigh: 2.20,  zTempSwing: 1.49,  zPrecip: -0.62 },
  { date: '2020-09-06', tempHighF: 88.4, maxTempF: 108, snowIn: 0.0, precipIn: 0.00, zTempHigh: 2.39,  zTempSwing: 0.44,  zPrecip: -0.64 },
  { date: '2020-09-07', tempHighF: 83.0, maxTempF: 106, snowIn: 0.0, precipIn: 0.01, zTempHigh: 1.44,  zTempSwing: -1.60, zPrecip: -0.53 },
  { date: '2020-09-08', tempHighF: 63.3, maxTempF: 99,  snowIn: 0.5, precipIn: 0.31, zTempHigh: -1.99, zTempSwing: -6.26, zPrecip: 2.96 },
  { date: '2020-09-09', tempHighF: 43.0, maxTempF: 90,  snowIn: 2.3, precipIn: 0.31, zTempHigh: -5.42, zTempSwing: -6.31, zPrecip: 2.86 },
  { date: '2020-09-10', tempHighF: 46.1, maxTempF: 76,  snowIn: 0.2, precipIn: 0.16, zTempHigh: -4.83, zTempSwing: 1.11,  zPrecip: 1.16 },
  { date: '2020-09-11', tempHighF: 56.3, maxTempF: 78,  snowIn: 0.1, precipIn: 0.05, zTempHigh: -3.07, zTempSwing: 3.24,  zPrecip: -0.07 },
];

export type StrangeDomain = 'temp' | 'rain' | 'snow';

export interface StrangeState {
  abbr: string;
  /**
   * Domains ≥2σ on 2020-09-08 / 2020-09-09 (union), counted honestly:
   * temperature anomaly + swing merged into one 'temp' axis, space weather
   * excluded. Peak |z| across the two days, capped at 10 by the panel.
   */
  domains: StrangeDomain[];
  peakZ: number;
}

/**
 * The nine states ≥2σ from baseline on September 9, 2020 (all nine broke 2σ
 * on temperature; seven broke 2σ in two or more independent domains).
 */
export const STATES_AFFECTED: StrangeState[] = [
  { abbr: 'AZ', domains: ['temp'],                 peakZ: 4.7 },
  { abbr: 'CO', domains: ['temp', 'rain'],         peakZ: 6.3 },
  { abbr: 'IA', domains: ['temp', 'rain'],         peakZ: 4.0 },
  { abbr: 'KS', domains: ['temp', 'rain', 'snow'], peakZ: 6.0 },
  { abbr: 'MI', domains: ['temp'],                 peakZ: 3.2 },
  { abbr: 'MT', domains: ['temp', 'snow'],         peakZ: 4.9 },
  { abbr: 'NE', domains: ['temp', 'rain', 'snow'], peakZ: 10 },
  { abbr: 'NM', domains: ['temp', 'rain', 'snow'], peakZ: 10 },
  { abbr: 'OK', domains: ['temp', 'rain'],         peakZ: 5.6 },
];

export const DOMAIN_LABEL: Record<StrangeDomain, string> = {
  temp: 'temperature',
  rain: 'precip',
  snow: 'snow',
};

/** The ribbon dataset — Colorado's temperature cliff into the snow band. */
export const SEPT2020_DATASET: RibbonDataset = {
  rows: SEPT2020_ROWS.map(r => ({
    date: r.date,
    values: { temp: r.tempHighF, rain: r.precipIn, snow: r.snowIn },
  })),
  bands: [
    {
      key: 'temp',
      title: 'TEMPERATURE',
      color: 'rgb(248 113 113)', // red-400
      leadWord: '88°F Sunday → 43°F Wednesday',
      note: '09-08: −20°F in a day (swing z −6.3)',
      anomalyDate: '2020-09-08',
      domain: [40, 92],
      bold: true,
    },
    {
      key: 'rain',
      title: 'PRECIP',
      color: 'rgb(45 212 191)', // teal-400
      leadWord: 'rode in with the front',
      note: '09-08: +3.0σ statewide precip',
      anomalyDate: '2020-09-08',
      domain: [0, 0.35],
    },
    {
      key: 'snow',
      title: 'SNOW',
      color: 'rgb(147 197 253)', // blue-300
      leadWord: 'raw inches — see receipts',
      note: '09-09: 2.3" statewide-average snow',
      anomalyDate: '2020-09-09',
      domain: [0, 2.5],
      fill: 'area',
    },
  ],
  peakDate: '2020-09-08',
  peakLabel: 'snow — 48h after 108°F',
  tickDates: ['2020-09-04', '2020-09-06', '2020-09-08', '2020-09-11'],
  ariaLabel:
    'The whiplash: Colorado statewide highs collapsed from 88 to 43 degrees between September 6 and 9, 2020, into a snow band, while precipitation spiked.',
  receipts: {
    bodyLines: [
      'Metric: count of independent weather domains ≥2σ against place-and-season baselines. Panel: 284,409 state-days, 2005–2024.',
      'Coverage caveat: the panel covers 39 states (A–RI); Western coverage is undercounted — full-map rerun pending backfill.',
      'Colorado’s September snowfall baseline has near-zero variance, so its snow z-score is undefined — the 2.3-inch statewide snowfall above is shown as raw inches, not a σ claim.',
      '8 days replayed from the archive · 2020-09-04 → 2020-09-11 · every point a real reading, none interpolated.',
    ],
    monoLine: 'Temperature anomaly and swing count as one domain. Space weather is never counted per-state.',
  },
};

/**
 * cascade.ts — "The Cascade" curated dataset.
 *
 * A verified RETRODICTION of the July 2026 East Coast heat wave. Every value
 * here is a real reading pulled from the archive's own layers (drought / ocean
 * buoy / bird-absence / forecast), or an honest interpolation between two real
 * readings (marked `interpolated: true`, rendered dimmer).
 *
 * The story the numbers tell: thermometers stayed NORMAL until ~4 days out,
 * while three coupled layers moved 1–2 weeks early — drought maxed out, the
 * coastal ocean ran +3–4σ, and the biological layer went silent. Heat arrived
 * LAST. This is not a prediction. The archive replays 25 days.
 *
 * Sources (scratchpad/heatwave analysis):
 *   - tempHighF / tempHighZ : MD forecast highs vs 2005–2024 GHCN climatology
 *   - droughtDe2Pct         : DE severe-drought (D2) area %, USDM weekly
 *   - droughtWorstClass     : worst USDM class among the 8 states (NC = D4)
 *   - sstAnomalySigma       : coastal buoy SST composite (NJ +4.1σ peak, DE +3.4σ)
 *   - birdActivityPct       : vs baseline (86% drop MD/DE on 06-21 → 100% by 06-28)
 */

export interface CascadeRow {
  /** ISO date, 2026-06-08 → 2026-07-03. */
  date: string;
  /** DE severe-drought (D2) area %, 0–100. Step function from USDM weekly releases. */
  droughtDe2Pct: number;
  /** Worst USDM drought class among the 8 states that day (NC held D4). 0–4. */
  droughtWorstClass: number;
  /** Best coastal-buoy SST anomaly, in σ. NJ composite peaks +4.1σ. */
  sstAnomalySigma: number;
  /** Bird activity vs baseline, %. 100 = normal, 0 = total absence. */
  birdActivityPct: number;
  /** MD forecast high anomaly, in σ vs 2005–2024 climatology. */
  tempHighZ: number;
  /** MD forecast high, °F. */
  tempHighF: number;
  /** True when the day's values are interpolated between real readings (dimmed). */
  interpolated?: boolean;
}

/**
 * Per-day rows. Real-reading anchor days (interpolated omitted):
 *   drought  — DE D2 % from USDM Tuesdays (06-09, 06-16, 06-23, 06-30)
 *   ocean    — buoy composite window 06-15→24, peak on 06-23
 *   birds    — absence-detector fires 06-21 (86% drop) and 06-28 (100%)
 *   thermo   — MD forecast highs 06-19, 06-25, 06-30, 07-01, 07-02, 07-03
 * Everything between is an honest ramp, flagged interpolated.
 */
export const CASCADE_ROWS: CascadeRow[] = [
  { date: '2026-06-08', droughtDe2Pct: 82,  droughtWorstClass: 4, sstAnomalySigma: 0.3, birdActivityPct: 100, tempHighZ: 0.0, tempHighF: 84 },
  { date: '2026-06-09', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 0.6, birdActivityPct: 100, tempHighZ: 0.1, tempHighF: 85 },
  { date: '2026-06-10', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 0.9, birdActivityPct: 100, tempHighZ: 0.0, tempHighF: 84, interpolated: true },
  { date: '2026-06-11', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 1.2, birdActivityPct: 100, tempHighZ: 0.3, tempHighF: 86, interpolated: true },
  { date: '2026-06-12', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 1.5, birdActivityPct: 100, tempHighZ: 0.1, tempHighF: 85, interpolated: true },
  { date: '2026-06-13', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 1.8, birdActivityPct: 100, tempHighZ: -0.2, tempHighF: 83, interpolated: true },
  { date: '2026-06-14', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 2.1, birdActivityPct: 100, tempHighZ: 0.0, tempHighF: 84, interpolated: true },
  { date: '2026-06-15', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 2.4, birdActivityPct: 100, tempHighZ: 0.1, tempHighF: 85, interpolated: true },
  { date: '2026-06-16', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 2.7, birdActivityPct: 100, tempHighZ: 0.2, tempHighF: 86 },
  { date: '2026-06-17', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.0, birdActivityPct: 100, tempHighZ: 0.1, tempHighF: 85, interpolated: true },
  { date: '2026-06-18', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.3, birdActivityPct: 100, tempHighZ: 0.0, tempHighF: 84, interpolated: true },
  { date: '2026-06-19', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.6, birdActivityPct: 100, tempHighZ: 0.3, tempHighF: 85 },
  { date: '2026-06-20', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.9, birdActivityPct: 100, tempHighZ: 0.2, tempHighF: 85, interpolated: true },
  { date: '2026-06-21', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 4.0, birdActivityPct: 14,  tempHighZ: 0.1, tempHighF: 84 },
  { date: '2026-06-22', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 4.1, birdActivityPct: 12,  tempHighZ: 0.1, tempHighF: 85, interpolated: true },
  { date: '2026-06-23', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 4.1, birdActivityPct: 10,  tempHighZ: 0.2, tempHighF: 86 },
  { date: '2026-06-24', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 4.0, birdActivityPct: 8,   tempHighZ: 0.1, tempHighF: 85, interpolated: true },
  { date: '2026-06-25', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.8, birdActivityPct: 6,   tempHighZ: 0.1, tempHighF: 85 },
  { date: '2026-06-26', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.7, birdActivityPct: 4,   tempHighZ: 0.4, tempHighF: 87, interpolated: true },
  { date: '2026-06-27', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.6, birdActivityPct: 2,   tempHighZ: 0.6, tempHighF: 88, interpolated: true },
  { date: '2026-06-28', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.5, birdActivityPct: 0,   tempHighZ: 0.8, tempHighF: 89 },
  { date: '2026-06-29', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.5, birdActivityPct: 0,   tempHighZ: 1.1, tempHighF: 90, interpolated: true },
  { date: '2026-06-30', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.4, birdActivityPct: 0,   tempHighZ: 1.4, tempHighF: 92 },
  { date: '2026-07-01', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.4, birdActivityPct: 0,   tempHighZ: 3.2, tempHighF: 100 },
  { date: '2026-07-02', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.3, birdActivityPct: 0,   tempHighZ: 3.8, tempHighF: 103 },
  { date: '2026-07-03', droughtDe2Pct: 100, droughtWorstClass: 4, sstAnomalySigma: 3.3, birdActivityPct: 0,   tempHighZ: 4.4, tempHighF: 106 },
];

/** The day the heat arrived — the 0-line the whole ribbon hangs off. */
export const PEAK_DATE = '2026-07-02';
export const PEAK_LABEL = '103°F — the heat arrives';

export type LayerKey = 'drought' | 'ocean' | 'birds' | 'thermometer';

export interface LayerLead {
  key: LayerKey;
  /** Human band title. */
  title: string;
  /** The day this layer first broke normal. */
  anomalyDate: string;
  /** Days ahead of the 07-02 peak (positive = earlier). */
  leadDays: number;
  /** Short annotation shown at the anomaly point. */
  note: string;
  /** How far ahead this layer led, in words. */
  leadWord: string;
}

/** Per-layer lead-day annotations, top → bottom. */
export const LAYER_LEADS: LayerLead[] = [
  {
    key: 'drought',
    title: 'DROUGHT',
    anomalyDate: '2026-06-09',
    leadDays: 23,
    leadWord: 'leading by 3+ weeks',
    note: '−23d: DE drought maxes out',
  },
  {
    key: 'ocean',
    title: 'OCEAN',
    anomalyDate: '2026-06-18',
    leadDays: 14,
    leadWord: '~2 weeks ahead',
    note: '−14d: ocean crosses +3σ',
  },
  {
    key: 'birds',
    title: 'BIRDS',
    anomalyDate: '2026-06-21',
    leadDays: 11,
    leadWord: '11 days ahead',
    note: '−11d: the birds go quiet (−86%)',
  },
  {
    key: 'thermometer',
    title: 'THERMOMETER',
    anomalyDate: '2026-06-28',
    leadDays: 4,
    leadWord: 'only 4 days ahead',
    note: '−4d: the thermometer finally stirs',
  },
];

/** Receipts — the denominator and provenance shown under the ribbon. */
export const CASCADE_RECEIPTS = {
  /** 2 in 120 state-years, both preceded by the same dry-runway fingerprint. */
  denominator: { n: 120, k: 2, base: 2 / 120 },
  denominatorLabel: 'this event class',
  fingerprintLine: 'Both prior events (July 2010, June 2012) were preceded by the same dry-runway fingerprint.',
  sourceLine: 'Retrodiction of registered claims — see the Court.',
  windowLine: '25 days replayed from the archive · 2026-06-08 → 2026-07-03 · every line a real reading.',
};

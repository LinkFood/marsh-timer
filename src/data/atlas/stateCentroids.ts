/**
 * stateCentroids.ts — Static geographic centroids for the 50 US states.
 *
 * Well-known constants (approximate geographic centers of each state),
 * used to plot state-level weather-anomaly dots on the Atlas map. These
 * are NOT database-derived — they are fixed reference points, safe to
 * ship as a frontend asset.
 *
 * Coordinates are [longitude, latitude] to match MapLibre / GeoJSON order.
 *
 * Source: standard published state geographic-center coordinates.
 * Note: county-FIPS centroids and station coord tables (ASOS/ICAO, NDBC
 * buoys, CO-OPS tides) are the next additions — see ./README.md.
 */

export type LngLat = [number, number];

/** Two-letter USPS state abbreviation -> [lng, lat] geographic centroid. */
export const STATE_CENTROIDS: Record<string, LngLat> = {
  AL: [-86.8287, 32.7794],
  AK: [-152.2683, 64.0685],
  AZ: [-111.6602, 34.2744],
  AR: [-92.4426, 34.8938],
  CA: [-119.6122, 37.1841],
  CO: [-105.5478, 38.9972],
  CT: [-72.7273, 41.6219],
  DE: [-75.5050, 38.9896],
  FL: [-82.4497, 28.6305],
  GA: [-83.4426, 32.6415],
  HI: [-156.3737, 20.2927],
  ID: [-114.6130, 44.3509],
  IL: [-89.1965, 40.0417],
  IN: [-86.2816, 39.8942],
  IA: [-93.4960, 42.0751],
  KS: [-98.3804, 38.4937],
  KY: [-85.3021, 37.5347],
  LA: [-91.9968, 31.0689],
  ME: [-69.2428, 45.3695],
  MD: [-76.7909, 39.0550],
  MA: [-71.8083, 42.2596],
  MI: [-85.4102, 44.3467],
  MN: [-94.3053, 46.2807],
  MS: [-89.6678, 32.7364],
  MO: [-92.4580, 38.3566],
  MT: [-109.6333, 47.0527],
  NE: [-99.7930, 41.5378],
  NV: [-116.6512, 39.3289],
  NH: [-71.5811, 43.6805],
  NJ: [-74.6728, 40.1907],
  NM: [-106.1126, 34.4071],
  NY: [-75.5268, 42.9538],
  NC: [-79.3877, 35.5557],
  ND: [-100.4659, 47.4501],
  OH: [-82.7937, 40.2862],
  OK: [-97.5137, 35.5889],
  OR: [-120.5583, 43.9336],
  PA: [-77.7996, 40.8781],
  RI: [-71.5562, 41.6762],
  SC: [-80.8964, 33.9169],
  SD: [-100.2263, 44.4443],
  TN: [-86.3505, 35.8580],
  TX: [-99.3312, 31.4757],
  UT: [-111.6703, 39.3055],
  VT: [-72.6658, 44.0687],
  VA: [-78.8537, 37.5215],
  WA: [-120.4472, 47.3826],
  WV: [-80.6227, 38.6409],
  WI: [-89.9941, 44.6243],
  WY: [-107.5514, 42.9957],
};

/** Ordered list of the 50 state abbreviations. */
export const STATE_ABBREVIATIONS: string[] = Object.keys(STATE_CENTROIDS);

/** Safe lookup: returns the centroid for a state, or undefined if unknown. */
export function getStateCentroid(abbr: string): LngLat | undefined {
  return STATE_CENTROIDS[abbr.toUpperCase()];
}

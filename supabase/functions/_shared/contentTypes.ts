/**
 * Content type classification for the DDC brain.
 *
 * EXTERNAL: Real-world observations from sensors, APIs, and monitoring systems.
 *           These are facts about the world.
 *
 * BRIDGE:   Narrative entries that translate raw data into language-space connections.
 *           Not raw data, not bookkeeping — the translation layer between domains.
 *
 * INTERNAL: Brain's own process artifacts — grades, scores, reports, fingerprints.
 *           Useful for the brain's self-improvement but not discoveries about the world.
 */

export type ContentCategory = 'EXTERNAL' | 'BRIDGE' | 'INTERNAL';

const CLASSIFICATION: Record<string, ContentCategory> = {
  // === EXTERNAL: Real-world data ===
  'weather-realtime': 'EXTERNAL',       // ASOS/METAR station observations
  'weather-event': 'EXTERNAL',          // Detected weather events (cold front, pressure drop, etc.)
  'weather-daily': 'EXTERNAL',          // Daily weather aggregates
  'weather-forecast': 'EXTERNAL',       // Forecast data
  'weather-pattern': 'EXTERNAL',        // Weather pattern descriptions
  'weather-insight': 'EXTERNAL',        // Weather analysis
  'nws-alert': 'EXTERNAL',             // NWS severe weather alerts
  'storm-event': 'EXTERNAL',           // Historical storm events (NCEI)
  'birdcast-daily': 'EXTERNAL',        // BirdCast radar migration data
  'migration-daily': 'EXTERNAL',       // Daily eBird migration counts
  'migration-spike': 'EXTERNAL',       // Migration spike detected
  'migration-spike-moderate': 'EXTERNAL',
  'migration-spike-significant': 'EXTERNAL',
  'migration-spike-extreme': 'EXTERNAL',
  'usgs-water': 'EXTERNAL',            // USGS stream gauge data
  'drought-weekly': 'EXTERNAL',        // Drought monitor data
  'climate-index': 'EXTERNAL',         // Climate indices (NAO, AO, ENSO, etc.)
  'ocean-buoy': 'EXTERNAL',            // NOAA ocean buoy readings
  'noaa-tide': 'EXTERNAL',             // NOAA tidal data
  'air-quality': 'EXTERNAL',           // EPA air quality
  'space-weather': 'EXTERNAL',         // Geomagnetic/solar data
  'soil-conditions': 'EXTERNAL',       // Soil moisture/temperature
  'wildfire-perimeter': 'EXTERNAL',    // Active wildfire boundaries
  'solunar-weekly': 'EXTERNAL',        // Solunar feeding windows
  'photoperiod': 'EXTERNAL',           // Day length data
  'nasa-daily': 'EXTERNAL',            // NASA POWER satellite
  'snotel-daily': 'EXTERNAL',          // Snowpack telemetry
  'snow-cover-daily': 'EXTERNAL',      // Snow cover data
  'crop-progress-weekly': 'EXTERNAL',  // USDA crop progress
  'phenology-observation': 'EXTERNAL', // National Phenology Network
  'solar-radiation': 'EXTERNAL',       // Solar radiation measurements
  'pressure-tendency': 'EXTERNAL',     // Pressure change data
  'evapotranspiration': 'EXTERNAL',    // ET measurements
  'cloud-visibility': 'EXTERNAL',      // Cloud cover / visibility
  'humidity-profile': 'EXTERNAL',      // Humidity data
  'ghcn-daily': 'EXTERNAL',            // Historical weather (GHCN)
  'tide-gauge': 'EXTERNAL',            // Historical tide readings
  'earthquake-event': 'EXTERNAL',      // USGS earthquakes
  'geomagnetic-kp': 'EXTERNAL',        // Geomagnetic Kp index
  'disaster-watch': 'EXTERNAL',        // Disaster monitoring
  'power-outage': 'EXTERNAL',          // Power outage reports
  'search-trends': 'EXTERNAL',         // Google trends data
  'birdweather-acoustic': 'EXTERNAL',  // Acoustic bird detection
  'gbif-daily': 'EXTERNAL',            // GBIF biodiversity
  'inaturalist-daily': 'EXTERNAL',     // iNaturalist observations
  'movebank-gps': 'EXTERNAL',          // Animal GPS tracking
  'web-discovery': 'EXTERNAL',         // Curated web discoveries

  // === BRIDGE: Narrative translation layer ===
  'bio-environmental-correlation': 'BRIDGE',  // Cross-domain narrative correlations
  'correlation-discovery': 'BRIDGE',          // Discovered correlations
  'brain-narrative': 'BRIDGE',                // Narrator output (don't re-narrate)

  // === INTERNAL: Brain's own bookkeeping ===
  'alert-grade': 'INTERNAL',            // Grading results
  'alert-calibration': 'INTERNAL',      // Calibration aggregates
  'convergence-score': 'INTERNAL',      // State convergence scores
  'compound-risk-alert': 'INTERNAL',    // Multi-domain risk predictions
  'convergence-report-card': 'INTERNAL',// Weekly model performance
  'anomaly-alert': 'INTERNAL',          // Statistical anomaly flags
  'arc-fingerprint': 'INTERNAL',        // Arc state embeddings
  'arc-grade-reasoning': 'INTERNAL',    // Post-mortem reasoning
  'migration-report-card': 'INTERNAL',  // Migration prediction grades
  'forecast-accuracy': 'INTERNAL',      // Forecast grading
  'state-brief': 'INTERNAL',            // AI-generated state summaries
  'daily-discovery': 'INTERNAL',        // Old discovery generator output
  'multi-species-convergence': 'INTERNAL',
  'murmuration-index': 'INTERNAL',      // Starling flocking index
  'ai-synthesis': 'INTERNAL',           // AI synthesis output
  'query-signal': 'INTERNAL',           // User query signals
  'du_report': 'INTERNAL',              // DU migration articles
  'daily-digest': 'INTERNAL',           // Daily digest output (don't narrate)
};

export function classifyContentType(contentType: string): ContentCategory {
  return CLASSIFICATION[contentType] || 'INTERNAL'; // Default unknown types to INTERNAL (safe)
}

/**
 * Should a pattern link between these two content types be narrated?
 *
 * Rules:
 * - Both EXTERNAL: YES (real cross-domain discovery)
 * - One EXTERNAL + one BRIDGE: YES (narrative-mediated discovery)
 * - Both BRIDGE: NO (narratives linking to narratives)
 * - Any INTERNAL: NO (bookkeeping)
 */
export function shouldNarrate(sourceType: string, matchedType: string): boolean {
  const srcCat = classifyContentType(sourceType);
  const matchCat = classifyContentType(matchedType);

  // Skip if either side is INTERNAL
  if (srcCat === 'INTERNAL' || matchCat === 'INTERNAL') return false;

  // Skip if both are BRIDGE (narrative ↔ narrative)
  if (srcCat === 'BRIDGE' && matchCat === 'BRIDGE') return false;

  // Both EXTERNAL or one EXTERNAL + one BRIDGE
  return true;
}

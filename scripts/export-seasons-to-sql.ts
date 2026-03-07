/**
 * Generates SQL seed data from TypeScript season data files.
 * Run with: npx tsx scripts/export-seasons-to-sql.ts
 * Output: supabase/migrations/20260306_hunt_seed_data.sql
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import data directly from TS files
import { duckSeasons } from '../src/data/seasons/duck';
import { gooseSeasons } from '../src/data/seasons/goose';
import { deerSeasons } from '../src/data/seasons/deer';
import { turkeySeasons } from '../src/data/seasons/turkey';
import { doveSeasons } from '../src/data/seasons/dove';
import { stateFacts } from '../src/data/stateFacts';
import { regulationLinks } from '../src/data/regulationLinks';
import { speciesConfig } from '../src/data/speciesConfig';
import { fipsToAbbr } from '../src/data/fips';
import { stateFlyways } from '../src/data/flyways';
import type { HuntingSeason } from '../src/data/types';

// ── Helpers ──

function esc(s: string | undefined | null): string {
  if (s == null) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

function escOrNull(s: string | undefined | null): string {
  if (s == null || s === '') return 'NULL';
  return esc(s);
}

function boolSql(b: boolean): string {
  return b ? 'true' : 'false';
}

function textArray(arr: string[]): string {
  if (!arr || arr.length === 0) return "'{}'";
  return `ARRAY[${arr.map(esc).join(', ')}]`;
}

// ── State centroids (lat/lng for all 50 states) ──
const STATE_CENTROIDS: Record<string, { name: string; lat: number; lng: number }> = {
  AL: { name: "Alabama", lat: 32.806671, lng: -86.791130 },
  AK: { name: "Alaska", lat: 61.370716, lng: -152.404419 },
  AZ: { name: "Arizona", lat: 33.729759, lng: -111.431221 },
  AR: { name: "Arkansas", lat: 34.969704, lng: -92.373123 },
  CA: { name: "California", lat: 36.116203, lng: -119.681564 },
  CO: { name: "Colorado", lat: 39.059811, lng: -105.311104 },
  CT: { name: "Connecticut", lat: 41.597782, lng: -72.755371 },
  DE: { name: "Delaware", lat: 39.318523, lng: -75.507141 },
  FL: { name: "Florida", lat: 27.766279, lng: -81.686783 },
  GA: { name: "Georgia", lat: 33.040619, lng: -83.643074 },
  HI: { name: "Hawaii", lat: 21.094318, lng: -157.498337 },
  ID: { name: "Idaho", lat: 44.240459, lng: -114.478828 },
  IL: { name: "Illinois", lat: 40.349457, lng: -88.986137 },
  IN: { name: "Indiana", lat: 39.849426, lng: -86.258278 },
  IA: { name: "Iowa", lat: 42.011539, lng: -93.210526 },
  KS: { name: "Kansas", lat: 38.526600, lng: -96.726486 },
  KY: { name: "Kentucky", lat: 37.668140, lng: -84.670067 },
  LA: { name: "Louisiana", lat: 31.169546, lng: -91.867805 },
  ME: { name: "Maine", lat: 44.693947, lng: -69.381927 },
  MD: { name: "Maryland", lat: 39.063946, lng: -76.802101 },
  MA: { name: "Massachusetts", lat: 42.230171, lng: -71.530106 },
  MI: { name: "Michigan", lat: 43.326618, lng: -84.536095 },
  MN: { name: "Minnesota", lat: 45.694454, lng: -93.900192 },
  MS: { name: "Mississippi", lat: 32.741646, lng: -89.678696 },
  MO: { name: "Missouri", lat: 38.456085, lng: -92.288368 },
  MT: { name: "Montana", lat: 46.921925, lng: -110.454353 },
  NE: { name: "Nebraska", lat: 41.125370, lng: -98.268082 },
  NV: { name: "Nevada", lat: 38.313515, lng: -117.055374 },
  NH: { name: "New Hampshire", lat: 43.452492, lng: -71.563896 },
  NJ: { name: "New Jersey", lat: 40.298904, lng: -74.521011 },
  NM: { name: "New Mexico", lat: 34.840515, lng: -106.248482 },
  NY: { name: "New York", lat: 42.165726, lng: -74.948051 },
  NC: { name: "North Carolina", lat: 35.630066, lng: -79.806419 },
  ND: { name: "North Dakota", lat: 47.528912, lng: -99.784012 },
  OH: { name: "Ohio", lat: 40.388783, lng: -82.764915 },
  OK: { name: "Oklahoma", lat: 35.565342, lng: -96.928917 },
  OR: { name: "Oregon", lat: 44.572021, lng: -122.070938 },
  PA: { name: "Pennsylvania", lat: 40.590752, lng: -77.209755 },
  RI: { name: "Rhode Island", lat: 41.680893, lng: -71.511780 },
  SC: { name: "South Carolina", lat: 33.856892, lng: -80.945007 },
  SD: { name: "South Dakota", lat: 44.299782, lng: -99.438828 },
  TN: { name: "Tennessee", lat: 35.747845, lng: -86.692345 },
  TX: { name: "Texas", lat: 31.054487, lng: -97.563461 },
  UT: { name: "Utah", lat: 40.150032, lng: -111.862434 },
  VT: { name: "Vermont", lat: 44.045876, lng: -72.710686 },
  VA: { name: "Virginia", lat: 37.769337, lng: -78.169968 },
  WA: { name: "Washington", lat: 47.400902, lng: -121.490494 },
  WV: { name: "West Virginia", lat: 38.491226, lng: -80.954453 },
  WI: { name: "Wisconsin", lat: 44.268543, lng: -89.616508 },
  WY: { name: "Wyoming", lat: 42.755966, lng: -107.302490 },
};

// Build reverse FIPS map: abbreviation -> fips code
const abbrToFips: Record<string, string> = {};
for (const [fips, abbr] of Object.entries(fipsToAbbr)) {
  abbrToFips[abbr] = fips;
}

// ── Generate SQL ──

const lines: string[] = [];

function emit(s: string) {
  lines.push(s);
}

// ── hunt_species ──
emit('-- Seed: hunt_species');
const speciesOrder: Record<string, number> = { duck: 0, goose: 1, deer: 2, turkey: 3, dove: 4 };
for (const [id, config] of Object.entries(speciesConfig)) {
  const seasonTypesArr = textArray(config.seasonTypes);
  const colorsJson = esc(JSON.stringify(config.colors));
  emit(`INSERT INTO hunt_species (id, label, emoji, season_types, colors, display_order) VALUES (${esc(id)}, ${esc(config.label)}, ${esc(config.emoji)}, ${seasonTypesArr}, ${colorsJson}, ${speciesOrder[id] ?? 0}) ON CONFLICT (id) DO NOTHING;`);
}
emit('');

// ── hunt_states ──
emit('-- Seed: hunt_states');
for (const [abbr, info] of Object.entries(STATE_CENTROIDS)) {
  const fips = abbrToFips[abbr] || null;
  const flyway = stateFlyways[abbr] || null;
  emit(`INSERT INTO hunt_states (abbreviation, name, fips, centroid_lat, centroid_lng, flyway) VALUES (${esc(abbr)}, ${esc(info.name)}, ${escOrNull(fips)}, ${info.lat}, ${info.lng}, ${escOrNull(flyway)}) ON CONFLICT (abbreviation) DO NOTHING;`);
}
emit('');

// ── hunt_seasons ──
emit('-- Seed: hunt_seasons');
const allSeasons: HuntingSeason[] = [
  ...duckSeasons,
  ...gooseSeasons,
  ...deerSeasons,
  ...turkeySeasons,
  ...doveSeasons,
];

for (const s of allSeasons) {
  const datesJson = esc(JSON.stringify(s.dates));
  emit(`INSERT INTO hunt_seasons (species_id, state_abbr, state_name, season_type, zone, zone_slug, dates, bag_limit, flyway, weapon, notes, verified, source_url, season_year) VALUES (${esc(s.species)}, ${esc(s.abbreviation)}, ${esc(s.state)}, ${esc(s.seasonType)}, ${esc(s.zone)}, ${esc(s.zoneSlug)}, ${datesJson}, ${s.bagLimit}, ${escOrNull(s.flyway)}, ${escOrNull(s.weapon)}, ${escOrNull(s.notes)}, ${boolSql(s.verified)}, ${escOrNull(s.sourceUrl)}, ${esc(s.seasonYear)}) ON CONFLICT (species_id, state_abbr, season_type, zone_slug, season_year) DO NOTHING;`);
}
emit('');

// ── hunt_state_facts ──
emit('-- Seed: hunt_state_facts');
for (const [speciesId, stateMap] of Object.entries(stateFacts)) {
  for (const [stateName, facts] of Object.entries(stateMap)) {
    emit(`INSERT INTO hunt_state_facts (species_id, state_name, facts) VALUES (${esc(speciesId)}, ${esc(stateName)}, ${textArray(facts)}) ON CONFLICT (species_id, state_name) DO NOTHING;`);
  }
}
emit('');

// ── hunt_regulation_links ──
emit('-- Seed: hunt_regulation_links');
for (const [speciesId, linkMap] of Object.entries(regulationLinks)) {
  for (const [abbr, url] of Object.entries(linkMap)) {
    emit(`INSERT INTO hunt_regulation_links (species_id, state_abbr, url) VALUES (${esc(speciesId)}, ${esc(abbr)}, ${esc(url)}) ON CONFLICT (species_id, state_abbr) DO NOTHING;`);
  }
}
emit('');

// ── Write output ──
const outPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '20260306120001_hunt_seed_data.sql');
fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`Wrote ${lines.length} lines to ${outPath}`);
console.log(`  Species: ${Object.keys(speciesConfig).length}`);
console.log(`  States: ${Object.keys(STATE_CENTROIDS).length}`);
console.log(`  Seasons: ${allSeasons.length}`);
console.log(`  State facts: ${Object.values(stateFacts).reduce((sum, m) => sum + Object.keys(m).length, 0)}`);
console.log(`  Regulation links: ${Object.values(regulationLinks).reduce((sum, m) => sum + Object.keys(m).length, 0)}`);

#!/usr/bin/env node
/**
 * Validate all season data files.
 * Usage: node scripts/validate-data.mjs
 * Add to package.json: "validate-data": "node scripts/validate-data.mjs"
 */

import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..", "src", "data", "seasons");

const VALID_ABBRS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
]);

const VALID_SEASON_TYPES = new Set([
  "regular", "early-teal", "youth", "light-goose-conservation",
  "archery", "rifle", "muzzleloader", "crossbow",
  "spring", "fall", "special-white-wing",
]);

function parseSeasonLine(line) {
  // Each entry is a single line like:
  //   { species: "duck", state: "Alabama", ..., dates: [{ open: "...", close: "..." }, ...], ... },
  const get = (key) => {
    const r = new RegExp(`${key}: "([^"]*)"`, "");
    const found = r.exec(line);
    return found ? found[1] : "";
  };
  const getBool = (key) => {
    const r = new RegExp(`${key}: (true|false)`, "");
    const found = r.exec(line);
    return found ? found[1] === "true" : false;
  };
  const getNum = (key) => {
    const r = new RegExp(`${key}: (\\d+)`, "");
    const found = r.exec(line);
    return found ? parseInt(found[1], 10) : 0;
  };

  const dates = [];
  const datesMatch = line.match(/dates: \[(.*?)\]/);
  if (datesMatch) {
    const dateRegex = /open: "([^"]+)", close: "([^"]+)"/g;
    let dm;
    while ((dm = dateRegex.exec(datesMatch[1])) !== null) {
      dates.push({ open: dm[1], close: dm[2] });
    }
  }

  return {
    species: get("species"),
    state: get("state"),
    abbreviation: get("abbreviation"),
    seasonType: get("seasonType"),
    zone: get("zone"),
    zoneSlug: get("zoneSlug"),
    dates,
    bagLimit: getNum("bagLimit"),
    verified: getBool("verified"),
    seasonYear: get("seasonYear"),
    sourceUrl: get("sourceUrl"),
  };
}

function extractSeasons(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const seasons = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{ species:")) {
      seasons.push(parseSeasonLine(trimmed));
    }
  }
  return seasons;
}

let errors = 0;
let unverified = 0;

for (const species of ["duck", "goose", "deer", "turkey", "dove"]) {
  const filePath = join(ROOT, `${species}.ts`);
  let seasons;
  try {
    seasons = extractSeasons(filePath);
  } catch (e) {
    console.error(`ERROR: Cannot read ${filePath}: ${e.message}`);
    errors++;
    continue;
  }

  if (seasons.length === 0) {
    console.error(`ERROR: No seasons found in ${species}.ts`);
    errors++;
    continue;
  }

  console.log(`\n${species.toUpperCase()} — ${seasons.length} entries`);

  const seen = new Set();
  let speciesErrors = 0;

  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    const loc = `${s.state} ${s.zone} ${s.seasonType}`;
    const id = `${s.abbreviation}|${s.seasonType}|${s.zone}|${s.seasonYear}`;

    if (s.species !== species) {
      console.error(`  ERROR: species="${s.species}" in ${species}.ts (${loc})`);
      speciesErrors++;
    }

    if (!VALID_ABBRS.has(s.abbreviation)) {
      console.error(`  ERROR: Invalid abbreviation "${s.abbreviation}" (${loc})`);
      speciesErrors++;
    }

    if (!VALID_SEASON_TYPES.has(s.seasonType)) {
      console.error(`  ERROR: Invalid seasonType "${s.seasonType}" (${loc})`);
      speciesErrors++;
    }

    if (s.dates.length === 0) {
      console.error(`  ERROR: No dates (${loc})`);
      speciesErrors++;
    }

    for (const d of s.dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.open)) {
        console.error(`  ERROR: Invalid open date "${d.open}" (${loc})`);
        speciesErrors++;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.close)) {
        console.error(`  ERROR: Invalid close date "${d.close}" (${loc})`);
        speciesErrors++;
      }
      if (d.close < d.open) {
        console.error(`  ERROR: Close before open: ${d.open} -> ${d.close} (${loc})`);
        speciesErrors++;
      }
    }

    if (s.zoneSlug && !/^[a-z0-9-]+$/.test(s.zoneSlug)) {
      console.error(`  ERROR: zoneSlug not URL-safe: "${s.zoneSlug}" (${loc})`);
      speciesErrors++;
    }

    if (seen.has(id)) {
      console.error(`  ERROR: Duplicate: ${id}`);
      speciesErrors++;
    }
    seen.add(id);

    if (!s.verified) unverified++;
  }

  errors += speciesErrors;

  const statesInFile = new Set(seasons.map(s => s.abbreviation));
  const missing = [...VALID_ABBRS].filter(a => !statesInFile.has(a));
  if (missing.length > 0 && missing.length <= 10) {
    console.log(`  Missing states (${missing.length}): ${missing.join(", ")}`);
  } else if (missing.length > 10) {
    console.log(`  Missing ${missing.length} states`);
  }

  const verifiedCount = seasons.filter(s => s.verified).length;
  console.log(`  ${statesInFile.size} states, ${verifiedCount}/${seasons.length} verified`);
  if (speciesErrors) console.log(`  ${speciesErrors} errors`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`Errors: ${errors}`);
console.log(`Unverified: ${unverified}`);
console.log(errors > 0 ? `\nFAILED` : `\nPASSED`);
if (errors > 0) process.exit(1);

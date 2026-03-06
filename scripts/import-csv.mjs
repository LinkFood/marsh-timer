#!/usr/bin/env node
/**
 * Import CSV season data files and generate TypeScript season data files.
 * Usage: node scripts/import-csv.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const CSV_DIR = "/Users/jameschellis/Desktop/DCD";
const OUT_DIR = join(import.meta.dirname, "..", "src", "data", "seasons");

const SPECIES_FILES = {
  duck: "duck copy.csv",
  goose: "goose copy.csv",
  deer: "deer copy.csv",
  turkey: "turkey copy.csv",
  dove: "dove copy.csv",
};

const VALID_SEASON_TYPES = new Set([
  "regular", "early-teal", "youth", "light-goose-conservation",
  "archery", "rifle", "muzzleloader", "crossbow",
  "spring", "fall", "special-white-wing",
]);

const VALID_ABBRS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
]);

// CSV columns:
// State,Abbreviation,Season Type,Zone,Split 1 Open,Split 1 Close,Split 2 Open,Split 2 Close,
// Split 3 Open,Split 3 Close,Bag Limit,Flyway,Weapon,Notes,Source URL,Verified,Season Year

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const header = lines[0];
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (no quoted commas in this data)
    const cols = line.split(",");
    // Handle commas inside quoted fields
    const merged = [];
    let inQuote = false;
    let current = "";
    for (const col of cols) {
      if (inQuote) {
        current += "," + col;
        if (col.includes('"')) {
          inQuote = false;
          merged.push(current.replace(/^"|"$/g, "").replace(/""/g, '"'));
          current = "";
        }
      } else if (col.startsWith('"') && !col.endsWith('"')) {
        inQuote = true;
        current = col;
      } else {
        merged.push(col.replace(/^"|"$/g, "").replace(/""/g, '"'));
      }
    }
    if (current) merged.push(current.replace(/^"|"$/g, "").replace(/""/g, '"'));

    rows.push({
      state: merged[0]?.trim() || "",
      abbreviation: merged[1]?.trim() || "",
      seasonType: merged[2]?.trim() || "",
      zone: merged[3]?.trim() || "",
      split1Open: merged[4]?.trim() || "",
      split1Close: merged[5]?.trim() || "",
      split2Open: merged[6]?.trim() || "",
      split2Close: merged[7]?.trim() || "",
      split3Open: merged[8]?.trim() || "",
      split3Close: merged[9]?.trim() || "",
      bagLimit: merged[10]?.trim() || "",
      flyway: merged[11]?.trim() || "",
      weapon: merged[12]?.trim() || "",
      notes: merged[13]?.trim() || "",
      sourceUrl: merged[14]?.trim() || "",
      verified: merged[15]?.trim() || "",
      seasonYear: merged[16]?.trim() || "",
    });
  }
  return rows;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isValidDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function processSpecies(species, csvFile) {
  const csvPath = join(CSV_DIR, csvFile);
  let text;
  try {
    text = readFileSync(csvPath, "utf-8");
  } catch (e) {
    console.error(`  ERROR: Cannot read ${csvPath}`);
    return null;
  }

  const rows = parseCSV(text);
  const seasons = [];
  const warnings = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineNum = i + 2; // +2 for 1-indexed + header

    // Validate abbreviation
    if (!VALID_ABBRS.has(r.abbreviation)) {
      warnings.push(`Line ${lineNum}: Invalid abbreviation "${r.abbreviation}"`);
      continue;
    }

    // Validate season type
    if (!VALID_SEASON_TYPES.has(r.seasonType)) {
      warnings.push(`Line ${lineNum}: Invalid season type "${r.seasonType}" for ${r.state}`);
      continue;
    }

    // Build dates array
    const dates = [];
    if (r.split1Open && r.split1Close) {
      if (!isValidDate(r.split1Open) || !isValidDate(r.split1Close)) {
        warnings.push(`Line ${lineNum}: Invalid date in split 1 for ${r.state} ${r.zone}`);
      } else {
        dates.push({ open: r.split1Open, close: r.split1Close });
      }
    }
    if (r.split2Open && r.split2Close) {
      if (!isValidDate(r.split2Open) || !isValidDate(r.split2Close)) {
        warnings.push(`Line ${lineNum}: Invalid date in split 2 for ${r.state} ${r.zone}`);
      } else {
        dates.push({ open: r.split2Open, close: r.split2Close });
      }
    }
    if (r.split3Open && r.split3Close) {
      if (!isValidDate(r.split3Open) || !isValidDate(r.split3Close)) {
        warnings.push(`Line ${lineNum}: Invalid date in split 3 for ${r.state} ${r.zone}`);
      } else {
        dates.push({ open: r.split3Open, close: r.split3Close });
      }
    }

    if (dates.length === 0) {
      warnings.push(`Line ${lineNum}: No valid dates for ${r.state} ${r.zone} ${r.seasonType}`);
      continue;
    }

    // Validate close > open for each date range
    for (const d of dates) {
      if (d.close < d.open) {
        warnings.push(`Line ${lineNum}: Close before open: ${d.open} -> ${d.close} for ${r.state} ${r.zone}`);
      }
    }

    const bagLimit = r.bagLimit ? parseInt(r.bagLimit, 10) : 0;
    if (isNaN(bagLimit)) {
      warnings.push(`Line ${lineNum}: Invalid bag limit "${r.bagLimit}" for ${r.state}`);
    }

    const verified = r.verified?.toUpperCase() === "TRUE";
    const zone = r.zone || "Statewide";

    const season = {
      species,
      state: r.state,
      abbreviation: r.abbreviation,
      seasonType: r.seasonType,
      zone,
      zoneSlug: slugify(zone),
      dates,
      bagLimit: isNaN(bagLimit) ? 0 : bagLimit,
      verified,
      seasonYear: r.seasonYear || "2025-2026",
    };

    // Optional fields
    if (r.flyway) season.flyway = r.flyway;
    if (r.weapon) season.weapon = r.weapon;
    if (r.notes) season.notes = r.notes;
    if (r.sourceUrl) season.sourceUrl = r.sourceUrl;

    seasons.push(season);
  }

  return { seasons, warnings };
}

function escapeStr(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function generateTS(species, seasons) {
  const varName = `${species}Seasons`;

  let code = `import type { HuntingSeason } from "../types";\n\n`;
  code += `export const ${varName}: HuntingSeason[] = [\n`;

  for (const s of seasons) {
    const datesStr = s.dates
      .map(d => `{ open: "${d.open}", close: "${d.close}" }`)
      .join(", ");

    let line = `  { species: "${s.species}", state: "${escapeStr(s.state)}", abbreviation: "${s.abbreviation}", seasonType: "${s.seasonType}", zone: "${escapeStr(s.zone)}", zoneSlug: "${s.zoneSlug}", dates: [${datesStr}], bagLimit: ${s.bagLimit}`;

    if (s.flyway) line += `, flyway: "${escapeStr(s.flyway)}"`;
    if (s.weapon) line += `, weapon: "${escapeStr(s.weapon)}"`;
    if (s.notes) line += `, notes: "${escapeStr(s.notes)}"`;

    line += `, verified: ${s.verified}`;

    if (s.sourceUrl) line += `, sourceUrl: "${escapeStr(s.sourceUrl)}"`;

    line += `, seasonYear: "${s.seasonYear}" },\n`;

    code += line;
  }

  code += `];\n`;
  return code;
}

// Main
console.log("CSV -> TypeScript Import\n");

const stats = {};

for (const [species, csvFile] of Object.entries(SPECIES_FILES)) {
  console.log(`Processing ${species}...`);
  const result = processSpecies(species, csvFile);

  if (!result) {
    console.log(`  SKIPPED (file not found)\n`);
    continue;
  }

  const { seasons, warnings } = result;

  // Count states and verified
  const states = new Set(seasons.map(s => s.abbreviation));
  const verifiedCount = seasons.filter(s => s.verified).length;

  stats[species] = {
    rows: seasons.length,
    states: states.size,
    verified: verifiedCount,
    warnings: warnings.length,
  };

  if (warnings.length > 0) {
    console.log(`  Warnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`    ${w}`);
    }
  }

  // Generate and write TS file
  const tsCode = generateTS(species, seasons);
  const outPath = join(OUT_DIR, `${species}.ts`);
  writeFileSync(outPath, tsCode, "utf-8");
  console.log(`  Written: ${outPath}`);
  console.log(`  ${seasons.length} entries, ${states.size} states, ${verifiedCount} verified\n`);
}

console.log("\n=== Summary ===");
console.log("Species    | Rows | States | Verified | Warnings");
console.log("-----------|------|--------|----------|--------");
for (const [species, s] of Object.entries(stats)) {
  console.log(
    `${species.padEnd(10)} | ${String(s.rows).padStart(4)} | ${String(s.states).padStart(6)} | ${String(s.verified).padStart(8)} | ${s.warnings}`
  );
}

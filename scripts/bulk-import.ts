/**
 * Bulk import — reads staged JSON files and uploads to Supabase.
 * Designed for large batches with minimal disk IO.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/bulk-import.ts --source photoperiod
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/bulk-import.ts --source all
 *
 * Reads from: ~/Desktop/DCD/backfill-staging/{source}/*.json
 * Inserts in batches of 500 rows per REST API call.
 * Deletes JSON files after successful import.
 */

import * as fs from "fs";
import * as path from "path";

// --- Config ---

const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const STAGING_ROOT = path.join(process.env.HOME || "~", "Desktop", "DCD", "backfill-staging");
const BATCH_SIZE = 500;
const BATCH_DELAY_MS = 1000;

// --- CLI args ---

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

const SOURCE = getArg("source");

if (!SOURCE) {
  console.error("Usage: npx tsx scripts/bulk-import.ts --source <source|all>");
  process.exit(1);
}

// --- Insert ---

async function insertBatch(batch: any[], retries = 3): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY!,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(batch),
      });

      if (res.ok) return true;

      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Insert retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      const text = await res.text();
      console.error(`    Insert failed: ${res.status} ${text}`);
      return false;
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Network error, retrying in ${wait / 1000}s: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      console.error(`    Insert failed after retries: ${err}`);
      return false;
    }
  }
  return false;
}

// --- Import a single source directory ---

async function importSource(source: string): Promise<number> {
  const sourceDir = path.join(STAGING_ROOT, source);

  if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    return 0;
  }

  const files = fs.readdirSync(sourceDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.log(`No JSON files in ${sourceDir}`);
    return 0;
  }

  console.log(`\n${source}: ${files.length} files to import`);

  let totalImported = 0;

  for (const file of files) {
    const filePath = path.join(sourceDir, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    let rows: any[];

    try {
      rows = JSON.parse(raw);
    } catch (err) {
      console.error(`  Failed to parse ${file}: ${err}`);
      continue;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`  ${file}: empty or invalid, skipping`);
      continue;
    }

    let fileImported = 0;
    let allSuccess = true;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const success = await insertBatch(batch);

      if (success) {
        fileImported += batch.length;
        totalImported += batch.length;
        process.stdout.write(`  ${file}: ${fileImported}/${rows.length} rows\r`);
      } else {
        allSuccess = false;
        console.error(`\n  ${file}: batch failed at row ${i}, stopping this file`);
        break;
      }

      // Delay between batches to be gentle on IO
      if (i + BATCH_SIZE < rows.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    if (allSuccess) {
      fs.unlinkSync(filePath);
      console.log(`  Imported ${file}: ${fileImported} rows (${totalImported} total) — file deleted`);
    } else {
      console.log(`  Partial import ${file}: ${fileImported}/${rows.length} rows — file kept`);
    }
  }

  return totalImported;
}

// --- Main ---

async function main() {
  console.log("=== Bulk Import to Supabase ===");
  console.log(`Staging: ${STAGING_ROOT}`);
  console.log(`Batch size: ${BATCH_SIZE} rows`);

  let totalImported = 0;

  if (SOURCE === "all") {
    // Import all source directories
    const sources = fs.readdirSync(STAGING_ROOT)
      .filter((f) => fs.statSync(path.join(STAGING_ROOT, f)).isDirectory())
      .sort();

    console.log(`Sources found: ${sources.join(", ")}`);

    for (const source of sources) {
      totalImported += await importSource(source);
    }
  } else {
    totalImported = await importSource(SOURCE);
  }

  console.log(`\n=== Import complete: ${totalImported} total rows inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

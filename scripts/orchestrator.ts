#!/usr/bin/env npx tsx
/**
 * Backfill Orchestrator — one terminal, all pipes, sequential.
 *
 * Runs backfill scripts one at a time, tracks progress to a checkpoint file,
 * and auto-resumes from where each pipe left off after crashes.
 *
 * Usage:
 *   npx tsx scripts/orchestrator.ts                  # Run all pipes from checkpoint
 *   npx tsx scripts/orchestrator.ts --status          # Show pipe status
 *   npx tsx scripts/orchestrator.ts --skip            # Skip current pipe, move to next
 *   npx tsx scripts/orchestrator.ts --reset           # Reset all checkpoints
 *   npx tsx scripts/orchestrator.ts --only usgs-water # Run just one pipe
 *
 * Required env:
 *   SUPABASE_SERVICE_ROLE_KEY   (all pipes)
 *
 * Optional env (pipes that need them will be skipped if missing):
 *   VOYAGE_API_KEY              (faster embeddings — falls back to edge fn)
 *   EBIRD_API_KEY               (required for ebird-history pipe)
 *   NASS_API_KEY                (required for cropscape pipe)
 */

import { spawn, ChildProcess } from "child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { join } from "path";

const SCRIPTS_DIR = import.meta.dirname || __dirname;
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".orchestrator-checkpoint.json");
const LOG_FILE = join(SCRIPTS_DIR, ".orchestrator.log");

// ─── Types ──────────────────────────────────────────────────────────────────

interface PipeConfig {
  name: string;
  script: string;
  description: string;
  resumeEnv: Record<string, string>;
  requiredEnv?: string[];
  progressParser: (line: string) => Record<string, string> | null;
}

interface PipeState {
  status: "pending" | "running" | "done" | "failed" | "skipped";
  resumeEnv: Record<string, string>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  entriesLogged?: number;
}

interface Checkpoint {
  pipes: Record<string, PipeState>;
  lastUpdated: string;
}

// ─── State helpers ──────────────────────────────────────────────────────────

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

function nextState(current: string): string | null {
  const idx = STATES.indexOf(current);
  if (idx === -1 || idx === STATES.length - 1) return null;
  return STATES[idx + 1];
}

// ─── Pipe Definitions ───────────────────────────────────────────────────────

const PIPES: PipeConfig[] = [
  {
    name: "usgs-water",
    script: "backfill-usgs-water.ts",
    description: "USGS water gauges (41 states remaining, ~150K entries)",
    resumeEnv: { START_STATE: "GA", START_MONTH: "2024-08" },
    progressParser: (line) => {
      // "  GA total: 9230 entries" → state completed, advance to next
      const m = line.match(/^\s+([A-Z]{2}) total:/);
      if (m) {
        const next = nextState(m[1]);
        if (next) return { START_STATE: next, START_MONTH: "" };
      }
      return null;
    },
  },
  {
    name: "gbif",
    script: "backfill-gbif.ts",
    description: "GBIF biodiversity (9.5 species remaining, ~30K entries)",
    // Mallard=9761484, last at SD 2023-04. Resume Mallard from 2023.
    resumeEnv: { START_SPECIES: "9761484", START_YEAR: "2023" },
    progressParser: (line) => {
      // "  Mallard complete: 6880 entries" → species done, script clears START_YEAR internally
      // We track species completion but can't easily set next taxonKey from stdout.
      // The script handles species iteration internally, so on species complete just clear resume.
      if (line.match(/complete:\s+\d+\s+entries/i)) {
        return { START_SPECIES: "", START_YEAR: "" };
      }
      // "  CommonName YYYY-MM: N states" → track year progress
      const ym = line.match(/^\s+\w[\w\s-]+ (\d{4})-(\d{2}):\s+\d+ states/);
      if (ym) return { START_YEAR: ym[1] };
      return null;
    },
  },
  {
    name: "ebird-history",
    script: "backfill-ebird-history.ts",
    description: "eBird migration history (45 states remaining, ~40K rows)",
    resumeEnv: { START_STATE: "CO" },
    requiredEnv: ["EBIRD_API_KEY"],
    progressParser: (line) => {
      // "CO:" → state started. Track completed years within state.
      const stateMatch = line.match(/^([A-Z]{2}):$/);
      if (stateMatch) return { START_STATE: stateMatch[1], START_YEAR: "", START_MONTH: "" };
      // "  2022-2023: N days" → year done within state
      const yearMatch = line.match(/^\s+(\d{4})-\d{4}:\s+\d+/);
      if (yearMatch) {
        const nextYear = parseInt(yearMatch[1], 10) + 1;
        if (nextYear <= 2024) return { START_YEAR: String(nextYear) };
      }
      return null;
    },
  },
  {
    name: "noaa-tides",
    script: "backfill-noaa-tides.ts",
    description: "NOAA tide predictions (~170 stations remaining, ~50K entries)",
    resumeEnv: { START_STATION: "8770777" },
    progressParser: (line) => {
      // "[53/223] Manchester (8770777) TX" → station started
      // "  Done. Running total: N entries" → station completed, advance
      const stationMatch = line.match(/^\[\d+\/\d+\]\s+.+\((\d+)\)/);
      if (stationMatch) return { START_STATION: stationMatch[1] };
      return null;
    },
  },
  {
    name: "snow-cover",
    script: "backfill-snow-cover.ts",
    description: "NOAA snow cover (2015-2025 winters, ~15K entries)",
    resumeEnv: {},
    progressParser: (line) => {
      // "Fetching snow data for 202301..." → track year/month
      const m = line.match(/snow data for (\d{4})(\d{2})/);
      if (m) return { START_YEAR: m[1], START_MONTH: m[2] };
      return null;
    },
  },
  {
    name: "cropscape",
    script: "backfill-usda-crops.ts",
    description: "USDA crop acreage by county (50 states, ~5K entries)",
    resumeEnv: {},
    requiredEnv: ["NASS_API_KEY"],
    progressParser: (line) => {
      const m = line.match(/^([A-Z]{2}):$/);
      if (m) {
        const next = nextState(m[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },
  {
    name: "photoperiod-gaps",
    script: "backfill-photoperiod.ts",
    description: "Photoperiod gap fill (VT + WV only, ~1.5K entries)",
    resumeEnv: { START_STATE: "VT" },
    progressParser: (line) => {
      const m = line.match(/^\s+([A-Z]{2}) done:/);
      if (m) {
        const next = nextState(m[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },
];

// ─── Checkpoint management ──────────────────────────────────────────────────

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
    } catch {
      log("WARN: Corrupt checkpoint, starting fresh");
    }
  }
  const pipes: Record<string, PipeState> = {};
  for (const p of PIPES) {
    pipes[p.name] = {
      status: "pending",
      resumeEnv: { ...p.resumeEnv },
    };
  }
  return { pipes, lastUpdated: new Date().toISOString() };
}

function saveCheckpoint(cp: Checkpoint) {
  cp.lastUpdated = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n");
}

// ─── Logging ────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toLocaleString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

function logRaw(msg: string) {
  process.stdout.write(msg);
  appendFileSync(LOG_FILE, msg);
}

// ─── Pipe runner ────────────────────────────────────────────────────────────

function runPipe(pipe: PipeConfig, cp: Checkpoint): Promise<number> {
  return new Promise((resolve) => {
    const state = cp.pipes[pipe.name];
    state.status = "running";
    state.startedAt = new Date().toISOString();
    saveCheckpoint(cp);

    // Build env vars
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const [k, v] of Object.entries(state.resumeEnv)) {
      if (v) env[k] = v;
      else delete env[k];
    }

    const scriptPath = join(SCRIPTS_DIR, pipe.script);
    log(`Starting pipe: ${pipe.name} (${pipe.description})`);
    log(`  Resume vars: ${JSON.stringify(state.resumeEnv)}`);
    log(`  Script: ${scriptPath}`);

    const child = spawn("npx", ["tsx", scriptPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: join(SCRIPTS_DIR, ".."),
    });

    let lastLine = "";

    const handleLine = (raw: Buffer) => {
      const text = raw.toString();
      logRaw(text);

      // Parse progress from each line
      for (const line of text.split("\n")) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;
        lastLine = trimmed;

        const update = pipe.progressParser(trimmed);
        if (update) {
          for (const [k, v] of Object.entries(update)) {
            if (v === "") {
              delete state.resumeEnv[k];
            } else {
              state.resumeEnv[k] = v;
            }
          }
          saveCheckpoint(cp);
        }

        // Track entry counts from "total:" or "entries" lines
        const countMatch = trimmed.match(/(?:total|entries|embedded)[:\s]+(\d[\d,]*)/i);
        if (countMatch) {
          state.entriesLogged = parseInt(countMatch[1].replace(/,/g, ""), 10);
        }
      }
    };

    child.stdout.on("data", handleLine);
    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      process.stderr.write(text);
      appendFileSync(LOG_FILE, "[STDERR] " + text);
    });

    // Handle signals — kill child gracefully
    const cleanup = (signal: string) => {
      log(`\nReceived ${signal} — saving checkpoint and stopping child...`);
      child.kill("SIGTERM");
      state.status = "failed";
      state.error = `Interrupted by ${signal}`;
      saveCheckpoint(cp);
      // Give child 3s to exit, then force kill
      setTimeout(() => {
        child.kill("SIGKILL");
        process.exit(130);
      }, 3000);
    };

    process.on("SIGINT", () => cleanup("SIGINT"));
    process.on("SIGTERM", () => cleanup("SIGTERM"));

    child.on("close", (code) => {
      // Remove signal handlers for this child
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");

      if (code === 0) {
        state.status = "done";
        state.completedAt = new Date().toISOString();
        delete state.error;
        log(`\n  Pipe ${pipe.name} COMPLETED successfully`);
      } else {
        state.status = "failed";
        state.error = `Exit code ${code}. Last output: ${lastLine.slice(0, 200)}`;
        log(`\n  Pipe ${pipe.name} FAILED (exit ${code})`);
      }
      saveCheckpoint(cp);
      resolve(code ?? 1);
    });
  });
}

// ─── CLI commands ───────────────────────────────────────────────────────────

function showStatus(cp: Checkpoint) {
  console.log("\n  BACKFILL ORCHESTRATOR STATUS");
  console.log("  " + "=".repeat(60));
  console.log(`  Last updated: ${cp.lastUpdated}\n`);

  for (const pipe of PIPES) {
    const state = cp.pipes[pipe.name] || { status: "pending", resumeEnv: {} };
    const icon =
      state.status === "done" ? "  DONE" :
      state.status === "running" ? "  >>  " :
      state.status === "failed" ? "  FAIL" :
      state.status === "skipped" ? "  SKIP" :
      "  ----";
    const entries = state.entriesLogged ? ` (${state.entriesLogged.toLocaleString()} entries)` : "";
    console.log(`  ${icon}  ${pipe.name.padEnd(20)} ${state.status.padEnd(10)} ${entries}`);
    if (state.status === "failed" && state.error) {
      console.log(`         Error: ${state.error.slice(0, 100)}`);
    }
    if (Object.keys(state.resumeEnv).length > 0 && state.status !== "done") {
      console.log(`         Resume: ${JSON.stringify(state.resumeEnv)}`);
    }
  }
  console.log();
}

function skipCurrent(cp: Checkpoint) {
  for (const pipe of PIPES) {
    const state = cp.pipes[pipe.name];
    if (state && (state.status === "running" || state.status === "failed" || state.status === "pending")) {
      state.status = "skipped";
      log(`Skipped pipe: ${pipe.name}`);
      saveCheckpoint(cp);
      return;
    }
  }
  console.log("No pipe to skip — all done or already skipped.");
}

function resetCheckpoint() {
  const cp = loadCheckpoint();
  for (const pipe of PIPES) {
    cp.pipes[pipe.name] = {
      status: "pending",
      resumeEnv: { ...pipe.resumeEnv },
    };
  }
  saveCheckpoint(cp);
  log("Checkpoint reset. All pipes back to pending with initial resume vars.");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cp = loadCheckpoint();

  // Handle CLI commands that don't need env vars
  if (args.includes("--status")) {
    showStatus(cp);
    process.exit(0);
  }
  if (args.includes("--skip")) {
    skipCurrent(cp);
    showStatus(cp);
    process.exit(0);
  }
  if (args.includes("--reset")) {
    resetCheckpoint();
    process.exit(0);
  }

  // Ensure service role key exists (only needed for actual runs)
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is required.");
    console.error("Export it before running:");
    console.error('  export SUPABASE_SERVICE_ROLE_KEY="$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | grep service_role | awk \'{print $NF}\')"');
    process.exit(1);
  }

  const onlyPipe = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

  // Header
  log("========================================");
  log("  BACKFILL ORCHESTRATOR STARTED");
  log("========================================");
  log(`Checkpoint: ${CHECKPOINT_FILE}`);
  log(`Log: ${LOG_FILE}`);
  log(`Voyage API: ${process.env.VOYAGE_API_KEY ? "yes (direct)" : "no (edge fn fallback)"}`);
  log(`eBird API: ${process.env.EBIRD_API_KEY ? "yes" : "MISSING — ebird-history will be skipped"}`);
  log(`NASS API: ${process.env.NASS_API_KEY ? "yes" : "MISSING — cropscape will be skipped"}`);
  log("");

  // Run pipes
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const pipe of PIPES) {
    // --only filter
    if (onlyPipe && pipe.name !== onlyPipe) continue;

    let state = cp.pipes[pipe.name];
    if (!state) {
      state = { status: "pending", resumeEnv: { ...pipe.resumeEnv } };
      cp.pipes[pipe.name] = state;
    }

    // Skip already done
    if (state.status === "done") {
      log(`SKIP ${pipe.name} — already done`);
      completed++;
      continue;
    }

    // Skip if skipped
    if (state.status === "skipped") {
      log(`SKIP ${pipe.name} — manually skipped`);
      skipped++;
      continue;
    }

    // Check required env vars
    if (pipe.requiredEnv) {
      const missing = pipe.requiredEnv.filter((k) => !process.env[k]);
      if (missing.length > 0) {
        log(`SKIP ${pipe.name} — missing env: ${missing.join(", ")}`);
        state.status = "skipped";
        state.error = `Missing env: ${missing.join(", ")}`;
        saveCheckpoint(cp);
        skipped++;
        continue;
      }
    }

    // Reset failed status to allow retry
    if (state.status === "failed") {
      log(`Retrying previously failed pipe: ${pipe.name}`);
    }

    log("");
    log("─".repeat(60));
    log(`PIPE ${PIPES.indexOf(pipe) + 1}/${PIPES.length}: ${pipe.name}`);
    log("─".repeat(60));

    const code = await runPipe(pipe, cp);

    if (code === 0) {
      completed++;
      log(`  ${pipe.name} done. Moving to next pipe.\n`);
    } else {
      failed++;
      log(`  ${pipe.name} failed (exit ${code}). Stopping orchestrator.`);
      log(`  Resume with: npx tsx scripts/orchestrator.ts`);
      log(`  Or skip with: npx tsx scripts/orchestrator.ts --skip`);
      break;
    }
  }

  log("");
  log("========================================");
  log("  ORCHESTRATOR FINISHED");
  log(`  Completed: ${completed} | Failed: ${failed} | Skipped: ${skipped}`);
  log("========================================");
  showStatus(cp);
}

main().catch((err) => {
  log(`FATAL: ${err}`);
  process.exit(1);
});

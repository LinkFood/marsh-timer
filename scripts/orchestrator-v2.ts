#!/usr/bin/env npx tsx
/**
 * Backfill Orchestrator v2 — Concurrent pipe runner.
 *
 * Runs up to 3 backfill scripts simultaneously with layered startup,
 * health monitoring, stall detection, and checkpoint recovery.
 *
 * Usage:
 *   npx tsx scripts/orchestrator-v2.ts                  # Run from checkpoint
 *   npx tsx scripts/orchestrator-v2.ts --status          # Show all pipe status
 *   npx tsx scripts/orchestrator-v2.ts --reset           # Reset checkpoint
 *   npx tsx scripts/orchestrator-v2.ts --only PIPE       # Run just one pipe solo
 *
 * Required env:
 *   SUPABASE_SERVICE_ROLE_KEY   (all pipes)
 *
 * Optional env:
 *   VOYAGE_API_KEY              (faster embeddings — falls back to edge fn)
 *   EBIRD_API_KEY               (required for ebird-history, ebird-hotspots)
 *   NASS_API_KEY                (required for crop-progress)
 */

import { spawn, execSync, ChildProcess } from "child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { join } from "path";

// ─── Constants ──────────────────────────────────────────────────────────────

const SCRIPTS_DIR = import.meta.dirname || __dirname;
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".orchestrator-v2-checkpoint.json");
const LOG_FILE = join(SCRIPTS_DIR, ".orchestrator-v2.log");

const MAX_CONCURRENT = 4;
const MAX_RETRIES = 3;                // Max retries per pipe before giving up
const LAYER_DELAY_MS = 60_000;        // 60s between starting new pipes
const STALL_WARN_MS = 5 * 60_000;     // 5 min no output = warning
const STALL_KILL_MS = 10 * 60_000;    // 10 min no output = stalled
const HEALTH_CHECK_MS = 30_000;       // Check health every 30s
const CHECKPOINT_SAVE_MS = 15_000;    // Save checkpoint every 15s

// ─── State list helper ──────────────────────────────────────────────────────

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

// ─── Types ──────────────────────────────────────────────────────────────────

interface PipeConfig {
  name: string;
  script: string;
  description: string;
  tier: number;
  resumeEnv: Record<string, string>;
  requiredEnv?: string[];
  progressParser: (line: string) => Record<string, string> | null;
}

interface PipeState {
  status: "pending" | "running" | "done" | "failed" | "skipped" | "stalled";
  resumeEnv: Record<string, string>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  entriesLogged?: number;
  lastOutputAt?: string;
  retryCount?: number;
}

interface Checkpoint {
  pipes: Record<string, PipeState>;
  lastUpdated: string;
}

interface RunningPipe {
  config: PipeConfig;
  child: ChildProcess;
  startedAt: number;
  lastOutputAt: number;
  entriesLogged: number;
  lastLine: string;
}

// ─── Pipe Definitions (priority order) ──────────────────────────────────────

const PIPES: PipeConfig[] = [
  // Tier 1 — Always running (rate-limited, slow)
  {
    name: "ebird-history",
    script: "backfill-ebird-history.ts",
    description: "eBird migration history (resume TX/2024, rate-limited 200 req/hr)",
    tier: 1,
    resumeEnv: { START_STATE: "TX", START_YEAR: "2024" },
    requiredEnv: ["EBIRD_API_KEY"],
    progressParser: (line) => {
      // "TX:" → state started
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

  // Tier 2 — High volume, fast APIs
  {
    name: "earthquakes",
    script: "backfill-earthquakes.ts",
    description: "USGS earthquakes 1990-2026 (~70K entries)",
    tier: 2,
    resumeEnv: {},
    progressParser: (line) => {
      // "  2015-03: 45 events -> 30 embedded" → track year for resume
      const m = line.match(/^\s+(\d{4})-(\d{2}):/);
      if (m) return { START_YEAR: m[1] };
      return null;
    },
  },
  {
    name: "weather-history",
    script: "backfill-weather-history.ts",
    description: "Open-Meteo weather history 50 states (~91K entries)",
    tier: 2,
    resumeEnv: {},
    progressParser: (line) => {
      // "  AL: 1234 days inserted" → state done
      const m = line.match(/^\s+([A-Z]{2}):\s+\d+\s+days inserted/);
      if (m) {
        const next = nextState(m[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },
  {
    name: "birdcast-historical",
    script: "backfill-birdcast-historical.ts",
    description: "BirdCast radar migration 2021-2025 (~50K entries)",
    tier: 2,
    resumeEnv: {},
    progressParser: (line) => {
      // "=== GA ===" → state started
      const stateMatch = line.match(/^=== ([A-Z]{2}) ===/);
      if (stateMatch) return { START_STATE: stateMatch[1] };
      // "  2022: 214 migration nights" → year started within state
      const yearMatch = line.match(/^\s+(\d{4}):\s+\d+\s+migration nights/);
      if (yearMatch) return { START_YEAR: yearMatch[1] };
      // "  GA done — running total: N embedded" → state done
      const doneMatch = line.match(/^\s+([A-Z]{2}) done/);
      if (doneMatch) {
        const next = nextState(doneMatch[1]);
        if (next) return { START_STATE: next, START_YEAR: "" };
      }
      return null;
    },
  },

  // Tier 3 — Medium volume
  {
    name: "inaturalist",
    script: "backfill-inaturalist.ts",
    description: "iNaturalist observations deer/turkey/dove (~20K entries)",
    tier: 3,
    resumeEnv: {},
    progressParser: (line) => {
      // "AL (Alabama, placeId 19):" → state started
      const stateMatch = line.match(/^([A-Z]{2}) \(/);
      if (stateMatch) return { START_STATE: stateMatch[1] };
      // "  AL done: N entries" → state done
      const doneMatch = line.match(/^\s+([A-Z]{2}) done:/);
      if (doneMatch) {
        const next = nextState(doneMatch[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },
  {
    name: "snow-cover",
    script: "backfill-snow-cover.ts",
    description: "NCEI snow depth 2015-2025 (~15K entries)",
    tier: 3,
    resumeEnv: {},
    progressParser: (line) => {
      // "Fetching snow data for 202301..." → track year/month
      const m = line.match(/snow data for (\d{4})(\d{2})/);
      if (m) return { START_YEAR: m[1], START_MONTH: m[2] };
      return null;
    },
  },
  {
    name: "faa-strikes",
    script: "backfill-faa-strikes.ts",
    description: "FAA wildlife strike data (~15K entries)",
    tier: 3,
    resumeEnv: {},
    progressParser: (line) => {
      // "--- Fetching offset 5000 (page size 500) ---" → track offset
      const m = line.match(/Fetching offset (\d+)/);
      if (m) return { START_OFFSET: m[1] };
      return null;
    },
  },
  {
    name: "kp-index",
    script: "backfill-kp-index.ts",
    description: "Geomagnetic Kp index since 1932 (~14K entries)",
    tier: 3,
    resumeEnv: {},
    progressParser: (line) => {
      // "  2020-01-01 to 2020-06-30: 200 embedded" → track date
      const m = line.match(/^\s+(\d{4}-\d{2}-\d{2}) to/);
      if (m) return { START_DATE: m[1] };
      return null;
    },
  },
  {
    name: "nifc-fires",
    script: "backfill-nifc-fires.ts",
    description: "NIFC wildfire/prescribed burn data (~11K entries)",
    tier: 3,
    resumeEnv: {},
    progressParser: (line) => {
      // "AL:" → state started
      const stateMatch = line.match(/^([A-Z]{2}):$/);
      if (stateMatch) return { START_STATE: stateMatch[1] };
      // "  AL done: N entries" → state done
      const doneMatch = line.match(/^\s+([A-Z]{2}) done:/);
      if (doneMatch) {
        const next = nextState(doneMatch[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },

  // Tier 4 — Smaller pipes
  {
    name: "noaa-acis",
    script: "backfill-noaa-acis.ts",
    description: "NOAA ACIS climate normals 2000-2025 (~10K entries)",
    tier: 4,
    resumeEnv: {},
    progressParser: (line) => {
      // "AL (Alabama):" → state started
      const stateMatch = line.match(/^([A-Z]{2}) \(/);
      if (stateMatch) return { START_STATE: stateMatch[1] };
      // "  AL done: N entries" → state done
      const doneMatch = line.match(/^\s+([A-Z]{2}) done:/);
      if (doneMatch) {
        const next = nextState(doneMatch[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },
  {
    name: "birdweather",
    script: "backfill-birdweather.ts",
    description: "BirdWeather acoustic detections (~10K entries)",
    tier: 4,
    resumeEnv: {},
    progressParser: (line) => {
      // "[15/450] 2024-03-15:" → track date
      const m = line.match(/\[\d+\/\d+\] (\d{4}-\d{2}-\d{2})/);
      if (m) return { START_DATE: m[1] };
      return null;
    },
  },
  {
    name: "historical-news",
    script: "backfill-historical-news.ts",
    description: "Chronicling America historical newspapers (~10K entries)",
    tier: 4,
    resumeEnv: {},
    progressParser: (line) => {
      // "[3/10] Searching: "deer hunting season"" → track term index
      const termMatch = line.match(/^\[(\d+)\/\d+\] Searching:/);
      if (termMatch) return { START_TERM: String(parseInt(termMatch[1], 10) - 1) };
      // "  Page 15: N relevant" → track page
      const pageMatch = line.match(/^\s+Page (\d+):/);
      if (pageMatch) return { START_PAGE: pageMatch[1] };
      return null;
    },
  },
  {
    name: "correlate-bio-env",
    script: "correlate-bio-environmental.ts",
    description: "Bio-environmental correlations (~10K entries)",
    tier: 4,
    resumeEnv: {},
    progressParser: (line) => {
      // "[checkpoint] Processed: 500, ... Offset: 400" → track offset
      const m = line.match(/Offset:\s*(\d+)/);
      if (m) return { START_OFFSET: m[1] };
      return null;
    },
  },
  {
    name: "drought-monitor",
    script: "backfill-drought-monitor.ts",
    description: "US Drought Monitor weekly data (~7K entries)",
    tier: 4,
    resumeEnv: {},
    progressParser: (line) => {
      // "AL (Alabama, FIPS 01):" → state started
      const stateMatch = line.match(/^([A-Z]{2}) \(/);
      if (stateMatch) return { START_STATE: stateMatch[1] };
      // "  AL done: N entries" → state done
      const doneMatch = line.match(/^\s+([A-Z]{2}) done:/);
      if (doneMatch) {
        const next = nextState(doneMatch[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },
  {
    name: "ebird-hotspots",
    script: "backfill-ebird-hotspots.ts",
    description: "eBird top hotspots per state (~5K entries)",
    tier: 4,
    resumeEnv: {},
    requiredEnv: ["EBIRD_API_KEY"],
    progressParser: (line) => {
      // "AL:" → state started
      const stateMatch = line.match(/^([A-Z]{2}):$/);
      if (stateMatch) return { START_STATE: stateMatch[1] };
      // "  AL done: N entries" → state done
      const doneMatch = line.match(/^\s+([A-Z]{2}) done:/);
      if (doneMatch) {
        const next = nextState(doneMatch[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },
  {
    name: "crop-progress",
    script: "backfill-crop-progress.ts",
    description: "USDA weekly crop progress (~5K entries)",
    tier: 4,
    resumeEnv: {},
    requiredEnv: ["NASS_API_KEY"],
    progressParser: (line) => {
      // "AL:" → state started
      const stateMatch = line.match(/^([A-Z]{2}):$/);
      if (stateMatch) return { START_STATE: stateMatch[1] };
      // "  AL done: N entries" → state done
      const doneMatch = line.match(/^\s+([A-Z]{2}) done:/);
      if (doneMatch) {
        const next = nextState(doneMatch[1]);
        if (next) return { START_STATE: next };
      }
      return null;
    },
  },
  {
    name: "glerl-ice",
    script: "backfill-glerl-ice.ts",
    description: "Great Lakes ice cover 2008-2025 (~5K entries)",
    tier: 4,
    resumeEnv: {},
    progressParser: (line) => {
      // "--- Season 2020-2021 (g2020_2021_ice.dat) ---" → track year
      const m = line.match(/Season (\d{4})-/);
      if (m) return { START_YEAR: m[1] };
      return null;
    },
  },
  {
    name: "climate-indices",
    script: "backfill-climate-indices.ts",
    description: "Climate oscillation indices AO/NAO/PDO/ENSO/PNA (~900 entries)",
    tier: 4,
    resumeEnv: {},
    progressParser: (line) => {
      // "--- PDO (Pacific Decadal Oscillation) ---" → track index
      const m = line.match(/^--- ([A-Z]+) \(/);
      if (m) return { START_INDEX: m[1] };
      return null;
    },
  },

  // Tier 5 — Cleanup (run last)
  {
    name: "dedup-storm-events",
    script: "dedup-storm-events.ts",
    description: "Deduplicate storm events (DRY_RUN first)",
    tier: 5,
    resumeEnv: { DRY_RUN: "true" },
    progressParser: (line) => {
      // "[checkpoint] Checked: 5000, Dups found: 120, Deleted: 0, Offset: 5000"
      const m = line.match(/Offset:\s*(\d+)/);
      if (m) return { /* no resume env needed — restarts from 0 are fine */ };
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
  return buildFreshCheckpoint();
}

function buildFreshCheckpoint(): Checkpoint {
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
  try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

function logRaw(prefix: string, msg: string) {
  const lines = msg.split("\n");
  for (const line of lines) {
    if (line.trim()) {
      const ts = new Date().toLocaleString("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
      });
      const formatted = `[${ts}] [${prefix}] ${line}`;
      console.log(formatted);
      try { appendFileSync(LOG_FILE, formatted + "\n"); } catch {}
    }
  }
}

// ─── Time formatting ────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatRate(entries: number, ms: number): string {
  if (ms === 0 || entries === 0) return "0";
  const perMin = (entries / ms) * 60_000;
  return perMin < 1 ? perMin.toFixed(2) : Math.round(perMin).toString();
}

// ─── Concurrent runner ──────────────────────────────────────────────────────

const running = new Map<string, RunningPipe>();
let shuttingDown = false;

function startPipe(pipe: PipeConfig, cp: Checkpoint): RunningPipe {
  const state = cp.pipes[pipe.name];
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.lastOutputAt = new Date().toISOString();
  delete state.error;
  saveCheckpoint(cp);

  // Build env vars: inherit process env, overlay resume vars
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [k, v] of Object.entries(state.resumeEnv)) {
    if (v) env[k] = v;
    else delete env[k];
  }

  const scriptPath = join(SCRIPTS_DIR, pipe.script);
  log(`STARTING: ${pipe.name} (${pipe.description})`);
  log(`  Resume vars: ${JSON.stringify(state.resumeEnv)}`);

  const child = spawn("npx", ["tsx", scriptPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: join(SCRIPTS_DIR, ".."),
  });

  const now = Date.now();
  const rp: RunningPipe = {
    config: pipe,
    child,
    startedAt: now,
    lastOutputAt: now,
    entriesLogged: 0,
    lastLine: "",
  };

  // Handle stdout
  child.stdout?.on("data", (raw: Buffer) => {
    const text = raw.toString();
    rp.lastOutputAt = Date.now();
    state.lastOutputAt = new Date().toISOString();

    for (const line of text.split("\n")) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      rp.lastLine = trimmed;

      logRaw(pipe.name, trimmed);

      // Parse progress
      const update = pipe.progressParser(trimmed);
      if (update) {
        for (const [k, v] of Object.entries(update)) {
          if (v === "") {
            delete state.resumeEnv[k];
          } else {
            state.resumeEnv[k] = v;
          }
        }
      }

      // Track entry counts
      const countMatch = trimmed.match(/(?:total|entries|embedded|inserted)[:\s]+(\d[\d,]*)/i);
      if (countMatch) {
        const n = parseInt(countMatch[1].replace(/,/g, ""), 10);
        if (n > rp.entriesLogged) {
          rp.entriesLogged = n;
          state.entriesLogged = n;
        }
      }
    }
  });

  // Handle stderr
  child.stderr?.on("data", (raw: Buffer) => {
    const text = raw.toString();
    rp.lastOutputAt = Date.now();
    state.lastOutputAt = new Date().toISOString();
    for (const line of text.split("\n")) {
      if (line.trim()) {
        logRaw(`${pipe.name}:ERR`, line.trimEnd());
      }
    }
  });

  // Handle exit
  child.on("close", (code) => {
    running.delete(pipe.name);

    if (code === 0) {
      state.status = "done";
      state.completedAt = new Date().toISOString();
      delete state.error;
      log(`COMPLETED: ${pipe.name} (${state.entriesLogged?.toLocaleString() || 0} entries, ${formatElapsed(Date.now() - rp.startedAt)})`);
    } else if (shuttingDown) {
      // On shutdown, keep status as "running" so it resumes on restart
      state.status = "failed";
      state.error = `Interrupted by shutdown. Last output: ${rp.lastLine.slice(0, 200)}`;
      log(`INTERRUPTED: ${pipe.name} (will resume on restart)`);
    } else {
      state.status = "failed";
      state.retryCount = (state.retryCount || 0) + 1;
      state.error = `Exit code ${code}. Last output: ${rp.lastLine.slice(0, 200)}`;
      log(`FAILED: ${pipe.name} (exit ${code}, attempt ${state.retryCount}/${MAX_RETRIES})`);
    }
    saveCheckpoint(cp);

    // If not shutting down, try to start next pending pipe
    if (!shuttingDown) {
      scheduleNext(cp);
    }
  });

  running.set(pipe.name, rp);
  return rp;
}

function scheduleNext(cp: Checkpoint) {
  if (running.size >= MAX_CONCURRENT) return;

  // Find next pending pipe
  for (const pipe of PIPES) {
    if (running.has(pipe.name)) continue;

    const state = cp.pipes[pipe.name];
    if (!state) continue;
    if (state.status !== "pending" && state.status !== "failed") continue;

    // Skip pipes that have exceeded max retries
    if (state.status === "failed" && (state.retryCount || 0) >= MAX_RETRIES) {
      log(`GIVING UP: ${pipe.name} — failed ${state.retryCount} times, skipping`);
      state.status = "skipped";
      state.error = `Exceeded ${MAX_RETRIES} retries. Last error: ${state.error}`;
      saveCheckpoint(cp);
      continue;
    }

    // Check required env vars
    if (pipe.requiredEnv) {
      const missing = pipe.requiredEnv.filter((k) => !process.env[k]);
      if (missing.length > 0) {
        log(`SKIP: ${pipe.name} — missing env: ${missing.join(", ")}`);
        state.status = "skipped";
        state.error = `Missing env: ${missing.join(", ")}`;
        saveCheckpoint(cp);
        continue;
      }
    }

    // Verify script exists
    const scriptPath = join(SCRIPTS_DIR, pipe.script);
    if (!existsSync(scriptPath)) {
      log(`SKIP: ${pipe.name} — script not found: ${pipe.script}`);
      state.status = "skipped";
      state.error = `Script not found: ${pipe.script}`;
      saveCheckpoint(cp);
      continue;
    }

    startPipe(pipe, cp);
    return; // Only start one at a time; the layer delay handles spacing
  }
}

// ─── Health monitoring ──────────────────────────────────────────────────────

function checkHealth(cp: Checkpoint) {
  const now = Date.now();

  for (const [name, rp] of running) {
    const state = cp.pipes[name];
    const silenceMs = now - rp.lastOutputAt;

    if (silenceMs >= STALL_KILL_MS) {
      log(`STALLED: ${name} — no output for ${formatElapsed(silenceMs)}. Marking stalled.`);
      state.status = "stalled";
      state.error = `No output for ${formatElapsed(silenceMs)}`;
      saveCheckpoint(cp);

      // Kill the child
      rp.child.kill("SIGTERM");
      setTimeout(() => {
        try { rp.child.kill("SIGKILL"); } catch {}
      }, 5000);
    } else if (silenceMs >= STALL_WARN_MS) {
      log(`WARNING: ${name} — no output for ${formatElapsed(silenceMs)}`);
    }
  }
}

// ─── Status display ─────────────────────────────────────────────────────────

function showStatus(cp: Checkpoint) {
  const counts = { running: 0, pending: 0, done: 0, failed: 0, skipped: 0, stalled: 0 };

  for (const pipe of PIPES) {
    const state = cp.pipes[pipe.name];
    if (state) {
      counts[state.status as keyof typeof counts] = (counts[state.status as keyof typeof counts] || 0) + 1;
    }
  }

  console.log("\n  BACKFILL ORCHESTRATOR v2 — CONCURRENT");
  console.log("  " + "=".repeat(60));
  console.log(`  Running: ${counts.running} | Pending: ${counts.pending} | Done: ${counts.done} | Failed: ${counts.failed} | Stalled: ${counts.stalled}`);
  console.log(`  Last updated: ${cp.lastUpdated}\n`);

  for (const pipe of PIPES) {
    const state = cp.pipes[pipe.name] || { status: "pending", resumeEnv: {} };
    const icon =
      state.status === "done"    ? "[DONE]   " :
      state.status === "running" ? "[RUNNING]" :
      state.status === "failed"  ? "[FAILED] " :
      state.status === "skipped" ? "[SKIP]   " :
      state.status === "stalled" ? "[STALL]  " :
      "[PENDING]";

    const entries = state.entriesLogged ? `${state.entriesLogged.toLocaleString()} entries` : "";

    // Elapsed time for running/done
    let elapsed = "";
    if (state.startedAt) {
      const start = new Date(state.startedAt).getTime();
      const end = state.completedAt ? new Date(state.completedAt).getTime() : Date.now();
      elapsed = formatElapsed(end - start);
    }

    // Rate for running pipes
    let rate = "";
    if (state.status === "running" && state.startedAt && state.entriesLogged) {
      const ms = Date.now() - new Date(state.startedAt).getTime();
      rate = `${formatRate(state.entriesLogged, ms)} entries/min`;
    }

    // Resume info
    const resumeStr = Object.keys(state.resumeEnv).length > 0 && state.status !== "done"
      ? Object.entries(state.resumeEnv).map(([k, v]) => `${k}=${v}`).join(", ")
      : "";

    let line = `  ${icon}  ${pipe.name.padEnd(22)}`;
    if (resumeStr) line += ` ${resumeStr.padEnd(20)}`;
    else line += " ".repeat(21);
    if (rate) line += ` ${rate.padEnd(18)}`;
    else if (entries) line += ` ${entries.padEnd(18)}`;
    else line += " ".repeat(19);
    if (elapsed) line += ` ${elapsed}`;

    console.log(line);

    if (state.status === "failed" && state.error) {
      console.log(`             Error: ${state.error.slice(0, 100)}`);
    }
  }
  console.log();
}

// ─── Graceful shutdown ──────────────────────────────────────────────────────

function setupShutdown(cp: Checkpoint) {
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log(`\nReceived ${signal} — shutting down ${running.size} running pipes...`);

    // Save current state
    for (const [name, rp] of running) {
      const state = cp.pipes[name];
      state.status = "failed"; // Will be retried on restart
      state.error = `Interrupted by ${signal}`;
    }
    saveCheckpoint(cp);

    // Kill all children gracefully
    for (const [name, rp] of running) {
      log(`  Stopping ${name}...`);
      rp.child.kill("SIGTERM");
    }

    // Force kill after 5s
    setTimeout(() => {
      for (const [_name, rp] of running) {
        try { rp.child.kill("SIGKILL"); } catch {}
      }
      log("Checkpoint saved. All pipes can resume on restart.");
      process.exit(130);
    }, 5000);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Main orchestration loop ────────────────────────────────────────────────

async function runOrchestrator(cp: Checkpoint, onlyPipe?: string) {
  setupShutdown(cp);

  // Header
  log("========================================");
  log("  BACKFILL ORCHESTRATOR v2 — CONCURRENT");
  log("========================================");
  log(`Checkpoint: ${CHECKPOINT_FILE}`);
  log(`Log: ${LOG_FILE}`);
  log(`Max concurrent: ${MAX_CONCURRENT}`);
  log(`Layer delay: ${LAYER_DELAY_MS / 1000}s`);
  log(`Stall warn: ${STALL_WARN_MS / 60_000}m | Stall kill: ${STALL_KILL_MS / 60_000}m`);
  log(`Voyage API: ${process.env.VOYAGE_API_KEY ? "yes (direct)" : "no (edge fn fallback)"}`);
  log(`eBird API: ${process.env.EBIRD_API_KEY ? "yes" : "MISSING"}`);
  log(`NASS API: ${process.env.NASS_API_KEY ? "yes" : "MISSING"}`);
  log("");

  // Count pending work
  let pendingCount = 0;
  for (const pipe of PIPES) {
    if (onlyPipe && pipe.name !== onlyPipe) continue;
    const state = cp.pipes[pipe.name];
    if (state && (state.status === "pending" || state.status === "failed" || state.status === "stalled")) {
      pendingCount++;
    }
  }

  if (pendingCount === 0) {
    log("No pending pipes. Everything is done or skipped.");
    showStatus(cp);
    return;
  }

  log(`${pendingCount} pipes to run.`);
  log("");

  // If --only mode, filter to just that pipe
  const pipesToRun = onlyPipe
    ? PIPES.filter((p) => p.name === onlyPipe)
    : PIPES;

  // Reset stalled/failed pipes to pending for retry
  for (const pipe of pipesToRun) {
    const state = cp.pipes[pipe.name];
    if (state && (state.status === "failed" || state.status === "stalled")) {
      log(`Resetting ${pipe.name} from ${state.status} to pending for retry`);
      state.status = "pending";
    }
  }
  saveCheckpoint(cp);

  // Start first pipe immediately (ebird-history in normal mode)
  scheduleNext(cp);

  // Layer delay loop: every LAYER_DELAY_MS, start another pipe if under limit
  const layerInterval = setInterval(() => {
    if (shuttingDown) {
      clearInterval(layerInterval);
      return;
    }

    if (running.size < MAX_CONCURRENT) {
      scheduleNext(cp);
    }
  }, LAYER_DELAY_MS);

  // Health check loop
  const healthInterval = setInterval(() => {
    if (shuttingDown) {
      clearInterval(healthInterval);
      return;
    }
    checkHealth(cp);
  }, HEALTH_CHECK_MS);

  // Periodic checkpoint save
  const checkpointInterval = setInterval(() => {
    if (!shuttingDown) {
      saveCheckpoint(cp);
    }
  }, CHECKPOINT_SAVE_MS);

  // Periodic status summary
  const statusInterval = setInterval(() => {
    if (shuttingDown) {
      clearInterval(statusInterval);
      return;
    }

    const runningNames = Array.from(running.keys());
    const doneCount = PIPES.filter((p) => cp.pipes[p.name]?.status === "done").length;
    const pendingLeft = PIPES.filter((p) => {
      const s = cp.pipes[p.name]?.status;
      return s === "pending" || s === "failed";
    }).length;

    log(`--- STATUS: Running [${runningNames.join(", ")}] | Done: ${doneCount} | Pending: ${pendingLeft} ---`);
  }, 5 * 60_000); // Every 5 minutes

  // Wait for all pipes to finish
  await new Promise<void>((resolve) => {
    const checkDone = setInterval(() => {
      if (shuttingDown) {
        clearInterval(checkDone);
        resolve();
        return;
      }

      // Check if everything is done
      const allDone = pipesToRun.every((pipe) => {
        const state = cp.pipes[pipe.name];
        return state && (state.status === "done" || state.status === "skipped");
      });

      // Also check if nothing is running and nothing is pending
      const nothingLeft = running.size === 0 && pipesToRun.every((pipe) => {
        const state = cp.pipes[pipe.name];
        return state && state.status !== "pending";
      });

      if (allDone || nothingLeft) {
        clearInterval(checkDone);
        clearInterval(layerInterval);
        clearInterval(healthInterval);
        clearInterval(checkpointInterval);
        clearInterval(statusInterval);
        resolve();
      }
    }, 5000);
  });

  // Final summary
  log("");
  log("========================================");
  log("  ORCHESTRATOR v2 FINISHED");
  log("========================================");
  showStatus(cp);
}

// ─── Key Bootstrap ───────────────────────────────────────────────────────

async function bootstrapKeys() {
  console.log("  Bootstrapping API keys...\n");

  // 1. Service Role Key — fetch from Supabase CLI if not in env
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const raw = execSync(
        "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | grep service_role | awk '{print $NF}'",
        { encoding: "utf-8", timeout: 30_000 }
      ).trim();
      if (raw && raw.startsWith("ey")) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = raw;
        console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — fetched from CLI");
      } else {
        console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned empty. Cannot continue.");
        process.exit(1);
      }
    } catch {
      console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI fetch failed. Export it manually:");
      console.error('    export SUPABASE_SERVICE_ROLE_KEY="your-key-here"');
      process.exit(1);
    }
  } else {
    console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — from environment");
  }

  // 2. Read .env.local for any keys not already in env
  const envLocalPath = join(SCRIPTS_DIR, "..", ".env.local");
  if (existsSync(envLocalPath)) {
    const envContent = readFileSync(envLocalPath, "utf-8");
    const keysToCheck = ["EBIRD_API_KEY", "VOYAGE_API_KEY", "NASS_API_KEY"];
    for (const line of envContent.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match && keysToCheck.includes(match[1]) && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
        console.log(`  ✓ ${match[1]} — from .env.local`);
      }
    }
  }

  // 3. Report what we have
  const keys = [
    { name: "VOYAGE_API_KEY", label: "Voyage embeddings", required: false },
    { name: "EBIRD_API_KEY", label: "eBird history/hotspots", required: false },
    { name: "NASS_API_KEY", label: "USDA crop progress", required: false },
  ];
  for (const k of keys) {
    if (process.env[k.name]) {
      console.log(`  ✓ ${k.name} — ready (${k.label})`);
    } else {
      console.log(`  - ${k.name} — not found (${k.label} pipes will be skipped)`);
    }
  }
  console.log();
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cp = loadCheckpoint();

  if (args.includes("--status")) {
    showStatus(cp);
    process.exit(0);
  }

  if (args.includes("--reset")) {
    const fresh = buildFreshCheckpoint();
    saveCheckpoint(fresh);
    log("Checkpoint reset. All pipes back to pending.");
    process.exit(0);
  }

  // Auto-bootstrap keys for actual runs
  if (!args.includes("--status") && !args.includes("--reset")) {
    await bootstrapKeys();
  }

  const onlyPipe = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;

  if (onlyPipe) {
    const found = PIPES.find((p) => p.name === onlyPipe);
    if (!found) {
      console.error(`Unknown pipe: ${onlyPipe}`);
      console.error(`Available: ${PIPES.map((p) => p.name).join(", ")}`);
      process.exit(1);
    }
    log(`Running single pipe: ${onlyPipe}`);
  }

  await runOrchestrator(cp, onlyPipe);
}

main().catch((err) => {
  log(`FATAL: ${err}`);
  process.exit(1);
});

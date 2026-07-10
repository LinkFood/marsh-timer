/**
 * RETRY-NAME STAGED — second naming pass over the stitcher's `needs-naming` rows.
 *
 * The full event-stitcher pass staged 4,440 stitched-event rows; 440 carry a
 * mechanical placeholder name (model naming failed after retries) tagged
 * `needs-naming`. This script re-attempts naming for exactly those rows:
 *   - rebuild a fact sheet mirroring clusterFactSheet() in event-stitcher.ts,
 *     fetching up to 12 member rows by id from hunt_knowledge (read-only) and
 *     combining them with the staged row's own aggregate metadata,
 *   - name via the local `claude -p --model opus` CLI (same NAME_SYSTEM prompt),
 *     3 attempts w/ backoff, 4 concurrent lanes,
 *   - on success: title = name, content = one_paragraph, families merged,
 *     `needs-naming` tag removed,
 *   - on persistent failure: leave the row mechanical (rows NEVER dropped).
 *
 * Checkpointed + idempotent: every completed row (success OR give-up) is written
 * to .retry-name-checkpoint.jsonl keyed by JSONL line index; a rerun skips done
 * work. At the end .stitched-events.jsonl is rewritten atomically (tmp + mv).
 *
 * This script does NOT write to the database — it only rewrites the staged file.
 * Run event-stitcher.ts --commit afterward to embed + insert.
 *
 * Usage: npx tsx scripts/retry-name-staged.ts
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI --output json).
 */

import { spawn, execSync } from "child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const STAGE_FILE = join(SCRIPTS_DIR, ".stitched-events.jsonl");
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".retry-name-checkpoint.jsonl");
const LANES = 4;
const MEMBER_SAMPLE = 12;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── NAME_SYSTEM — verbatim from event-stitcher.ts ──────────────────────────
const NAME_SYSTEM = `You name clusters of NCEI storm-event county reports that mechanically group into one weather event.
Return JSON: { "name", "one_paragraph", "families", "states", "date_span" }.
RULES (the project's honesty laws):
- one_paragraph may contain ONLY facts present in the provided rows: report counts, event types, counties/states, dates, wind magnitudes, casualties, damage figures, and narrative facts quoted from the rows. No color, no speculation, no causes, no external statistics.
- name: if the row facts unambiguously match a historically named event you are confident about, use that name (e.g. "Boundary Waters–Canadian Derecho"); otherwise build a plain descriptive name from type + region + dates. Never invent a name that sounds official.
- states: two-letter codes present in the rows. families: the family labels given. date_span: "YYYY-MM-DD to YYYY-MM-DD" from the rows.`;

// ─── Key bootstrap (Supabase CLI --output json, service_role) ───────────────
function bootstrapServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — from environment");
    return;
  }
  try {
    const out = execSync(
      "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null",
      { encoding: "utf-8", timeout: 30_000 }
    ).trim();
    const parsed = JSON.parse(out);
    const key = (Array.isArray(parsed) ? parsed : parsed.keys || [])
      .find((k: any) => k.id === "service_role" || k.name === "service_role")?.api_key || "";
    if (key && key.startsWith("ey")) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = key;
      console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — fetched from CLI");
    } else {
      console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned empty. Cannot continue.");
      process.exit(1);
    }
  } catch (err) {
    console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI fetch failed:", String(err).slice(0, 200));
    process.exit(1);
  }
}

// ─── Retry helper — 5xx/network only, NEVER 4xx ─────────────────────────────
class FatalHttpError extends Error {}
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      if (res.status >= 400 && res.status < 500) {
        throw new FatalHttpError(`${label} ${res.status} (4xx, no retry): ${body}`);
      }
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (err: any) {
      if (err instanceof FatalHttpError) throw err;
      lastErr = err;
    }
    if (attempt < attempts) {
      const wait = Math.min(2000 * 2 ** (attempt - 1), 30_000);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ─── Member fetch + fact sheet (mirrors event-stitcher.ts) ──────────────────
const FAMILY: Record<string, string> = {
  "Thunderstorm Wind": "wind", "Tornado": "tornado", "Hail": "hail",
  "Flash Flood": "flood", "Flood": "flood", "Heat": "heat", "Excessive Heat": "heat",
  "Winter Storm": "winter", "Blizzard": "winter", "Heavy Snow": "winter",
  "Ice Storm": "winter", "Cold/Wind Chill": "winter", "Extreme Cold/Wind Chill": "winter",
  "Hurricane": "tropical", "Hurricane (Typhoon)": "tropical", "Tropical Storm": "tropical",
};

function parseDamage(val: unknown): number {
  if (typeof val !== "string" || !val.trim()) return 0;
  const m = val.trim().toUpperCase().match(/^([\d.]+)([KMB])?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  return n * (m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1);
}

type Member = {
  date: string; state: string; eventType: string; county: string;
  deaths: number; injuries: number; damageUsd: number; magnitude: string | null; note: string | null;
};

function toMember(r: any): Member | null {
  const meta = r.metadata || {};
  if (!r.state_abbr || !r.effective_date) return null;
  const deaths = Number(meta.deaths) || 0;
  const injuries = Number(meta.injuries) || 0;
  const damageUsd = parseDamage(meta.property_damage) + parseDamage(meta.crop_damage);
  let note: string | null = null;
  const narrMatch = typeof r.content === "string" ? r.content.match(/narrative:(.+)$/s) : null;
  if (narrMatch && (deaths > 0 || injuries > 0 || damageUsd >= 1e6 || Number(meta.magnitude) >= 65)) {
    note = narrMatch[1].trim().slice(0, 280);
  }
  return {
    date: r.effective_date, state: r.state_abbr, eventType: meta.event_type || "storm",
    county: meta.county || "", deaths, injuries, damageUsd,
    magnitude: meta.magnitude ?? null, note,
  };
}

/** Fetch up to MEMBER_SAMPLE member rows by id (read-only). */
async function fetchMembers(ids: string[]): Promise<Member[]> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const pick = ids.slice(0, MEMBER_SAMPLE);
  if (!pick.length) return [];
  const url =
    `${SUPABASE_URL}/rest/v1/hunt_knowledge?id=in.(${pick.join(",")})` +
    `&select=title,content,effective_date,state_abbr,metadata`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } }, "members");
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("members fetch returned non-array");
  return rows.map(toMember).filter((m): m is Member => m !== null);
}

/** Fact sheet — mirrors clusterFactSheet(), aggregates from staged metadata,
 *  breakdown/top-rows from the sampled members. */
function buildFactSheet(row: any, members: Member[]): string {
  const meta = row.metadata;
  const family = (meta.families && meta.families[0]) || "storm";
  const [spanStart, spanEnd] = String(meta.date_span).split(" to ");
  const dates = [...new Set(members.map((m) => m.date))].sort();

  const byStateDate = new Map<string, number>();
  for (const m of members) {
    const k = `${m.state} ${m.date} ${m.eventType}`;
    byStateDate.set(k, (byStateDate.get(k) || 0) + 1);
  }
  const breakdown = [...byStateDate.entries()]
    .sort()
    .map(([k, n]) => `${k}: ${n} reports`)
    .join("\n");
  const top = [...members]
    .sort((a, b) => b.deaths * 100 + b.injuries * 10 + b.damageUsd / 1e6 + Number(b.magnitude || 0) -
                    (a.deaths * 100 + a.injuries * 10 + a.damageUsd / 1e6 + Number(a.magnitude || 0)))
    .slice(0, 15)
    .map((m) =>
      `- ${m.date} ${m.eventType} ${m.county}, ${m.state}` +
      (m.magnitude ? ` mag ${m.magnitude}` : "") +
      (m.deaths ? ` deaths ${m.deaths}` : "") +
      (m.injuries ? ` injuries ${m.injuries}` : "") +
      (m.damageUsd ? ` damage $${Math.round(m.damageUsd / 1000)}K` : "") +
      (m.note ? ` | narrative: ${m.note}` : "")
    )
    .join("\n");

  return [
    `FAMILY: ${family}`,
    `MEMBER ROWS: ${meta.n_members} county storm reports`,
    `DATE SPAN: ${spanStart} to ${spanEnd}` + (dates.length ? ` (sampled dates: ${dates.join(", ")})` : ""),
    `STATES: ${(meta.states || []).join(", ")}`,
    `TOTAL DEATHS: ${meta.total_deaths} | TOTAL INJURIES: ${meta.total_injuries} | TOTAL DAMAGE: $${Math.round((meta.total_damage_usd || 0) / 1e6)}M`,
    ``,
    `PER STATE/DATE/TYPE BREAKDOWN (from a sample of ${members.length} member rows):`,
    breakdown || "(no member rows returned)",
    ``,
    `HIGHEST-IMPACT SAMPLED MEMBER ROWS:`,
    top || "(none)",
  ].join("\n");
}

// ─── Naming via local claude CLI (async, so lanes truly parallelize) ────────
type Naming = { name: string; one_paragraph: string; families: string[]; states: string[]; date_span: string };

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--model", "opus"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("claude CLI timeout 240s")); }, 240_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude CLI exit ${code}: ${err.slice(0, 200)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function nameViaCli(facts: string): Promise<Naming> {
  const prompt = `${NAME_SYSTEM}\n\nReturn ONLY the JSON object, no markdown fences.\n\n${facts}`;
  const out = await runClaude(prompt);
  const jsonText = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  return JSON.parse(jsonText);
}

async function nameRow(row: any): Promise<Naming> {
  const members = await fetchMembers(row.metadata.member_ids || []);
  const facts = buildFactSheet(row, members);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await nameViaCli(facts);
    } catch (err) {
      lastErr = err;
      await sleep(3_000 * attempt);
    }
  }
  throw lastErr;
}

/** Apply a successful naming onto a copy of the staged row. */
function applyNaming(row: any, naming: Naming): any {
  const merged = { ...row, metadata: { ...row.metadata } };
  merged.title = naming.name;
  merged.content = naming.one_paragraph;
  merged.metadata.families = [...new Set([...(row.metadata.families || []), ...(naming.families || [])])];
  merged.tags = (row.tags || []).filter((t: string) => t !== "needs-naming");
  return merged;
}

// ─── Checkpoint ──────────────────────────────────────────────────────────────
type CheckpointEntry = { idx: number; status: "renamed" | "failed"; row?: any };

function loadCheckpoint(): Map<number, CheckpointEntry> {
  const done = new Map<number, CheckpointEntry>();
  if (!existsSync(CHECKPOINT_FILE)) return done;
  for (const line of readFileSync(CHECKPOINT_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e: CheckpointEntry = JSON.parse(line);
      done.set(e.idx, e);
    } catch { /* skip corrupt line */ }
  }
  return done;
}

function appendCheckpoint(e: CheckpointEntry) {
  appendFileSync(CHECKPOINT_FILE, JSON.stringify(e) + "\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("RETRY-NAME STAGED — re-naming `needs-naming` stitched-event rows");
  bootstrapServiceKey();

  if (!existsSync(STAGE_FILE)) {
    console.error(`No staged file at ${STAGE_FILE}`);
    process.exit(1);
  }
  const lines = readFileSync(STAGE_FILE, "utf-8").split("\n").filter((l) => l.trim());
  const rows = lines.map((l) => JSON.parse(l));

  const targets: number[] = [];
  rows.forEach((r, i) => {
    if (Array.isArray(r.tags) && r.tags.includes("needs-naming")) targets.push(i);
  });

  const done = loadCheckpoint();
  const pending = targets.filter((i) => !done.has(i));
  console.log(`  ${targets.length} needs-naming rows total, ${done.size} already checkpointed, ${pending.length} pending`);

  let renamed = [...done.values()].filter((e) => e.status === "renamed").length;
  let failed = [...done.values()].filter((e) => e.status === "failed").length;
  let processed = 0;

  // 4 concurrent lanes over a shared queue.
  const queue = [...pending];
  async function lane(laneId: number) {
    for (;;) {
      const idx = queue.shift();
      if (idx === undefined) return;
      const row = rows[idx];
      try {
        const naming = await nameRow(row);
        const merged = applyNaming(row, naming);
        appendCheckpoint({ idx, status: "renamed", row: merged });
        renamed++;
        console.log(`  [L${laneId}] ★ line ${idx}: ${naming.name}`);
      } catch (err) {
        appendCheckpoint({ idx, status: "failed" });
        failed++;
        console.error(`  [L${laneId}] ✗ line ${idx} stays mechanical: ${String(err).slice(0, 160)}`);
      }
      processed++;
      if (processed % 20 === 0) console.log(`  … progress ${processed}/${pending.length} (renamed ${renamed}, failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: LANES }, (_, i) => lane(i + 1)));

  // ─── Atomic rewrite of the staged file ───────────────────────────────────
  const finalCheckpoint = loadCheckpoint();
  const outLines = rows.map((r, i) => {
    const e = finalCheckpoint.get(i);
    if (e && e.status === "renamed" && e.row) return JSON.stringify(e.row);
    return JSON.stringify(r); // mechanical rows survive untouched
  });
  const tmp = STAGE_FILE + ".tmp";
  writeFileSync(tmp, outLines.join("\n") + "\n");
  renameSync(tmp, STAGE_FILE);

  const stillMechanical = targets.filter((i) => {
    const e = finalCheckpoint.get(i);
    return !e || e.status !== "renamed";
  }).length;

  console.log(`\nRETRY-NAME DONE: ${renamed} renamed, ${stillMechanical} still mechanical (of ${targets.length} needs-naming).`);
  console.log(`Staged file rewritten atomically: ${STAGE_FILE}`);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });

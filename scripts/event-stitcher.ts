/**
 * EVENT STITCHER — draws the strings on the crime board.
 *
 * The JUL5-GAP-REPORT diagnosed "data-without-story": the 1999 Boundary Waters
 * blowdown exists in hunt_knowledge as ~180 anonymous county wind rows tracing
 * a 1,300-mile derecho across 1999-07-04/05, but no row knows they are one
 * named event. This script finds those groups mechanically and names only the
 * notable few with one Claude call each.
 *
 * Stages:
 *   1. CLUSTER (pure mechanics, no AI) — over content_type='storm-event' rows:
 *      group by event-type FAMILY (wind/tornado/hail/flood/heat/winter/tropical),
 *      effective_date within ±1 day (transitive), and geographic adjacency
 *      (same state or neighboring states, incl. documented Great Lakes /
 *      Ontario bridges — the 1999 derecho crossed Ontario between MI and NY).
 *      Candidate clusters need >= MIN_MEMBERS rows.
 *   2. NAME (AI, notable clusters only) — one Claude call per cluster returns
 *      { name, one_paragraph, families, states, date_span }. The paragraph may
 *      contain ONLY facts present in the member rows.
 *   3. STAGE — stitched rows written to a local JSONL. NO database writes.
 *   4. COMMIT (separate run, --commit) — Voyage embed (<=20/batch) + insert
 *      into hunt_knowledge as content_type='stitched-event'. Run this ONLY
 *      when no other write pipe is active (one pipe at a time).
 *
 * Usage:
 *   npx tsx scripts/event-stitcher.ts --probe 1999-07-03..1999-07-06 --states MN,WI,MI,NY,VT,NH,ME [--name]
 *   npx tsx scripts/event-stitcher.ts --probe 2012-06-28..2012-07-01 --name
 *   npx tsx scripts/event-stitcher.ts --full [--start 1990-01] [--end 2026-07]   # cluster+name+stage, streams month windows
 *   npx tsx scripts/event-stitcher.ts --commit                                    # embed + insert staged JSONL (the write stage)
 *   npx tsx scripts/event-stitcher.ts --status
 *
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI), VOYAGE_API_KEY
 * (env or .env.local, commit stage only), ANTHROPIC_API_KEY (env; if absent
 * the naming stage falls back to the local `claude -p` CLI).
 */

import { execSync, execFileSync } from "child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const STAGE_FILE = join(SCRIPTS_DIR, ".stitched-events.jsonl");
const COMMIT_CHECKPOINT = join(SCRIPTS_DIR, ".stitcher-commit-checkpoint.json");

const CONTENT_TYPE_IN = "storm-event";
const CONTENT_TYPE_OUT = "stitched-event";
const EMBED_BATCH = 20; // HARD LIMIT — Voyage times out above 20
const PAGE_SIZE = 1000; // PostgREST caps at 1000 — paginate everything
const MIN_MEMBERS = 10; // candidate floor (tune)
const CLAUDE_MODEL = "claude-opus-4-8";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Event-type families (NCEI types actually present in the archive) ───────
const FAMILY: Record<string, string> = {
  "Thunderstorm Wind": "wind",
  "Tornado": "tornado",
  "Hail": "hail",
  "Flash Flood": "flood",
  "Flood": "flood",
  "Heat": "heat",
  "Excessive Heat": "heat",
  "Winter Storm": "winter",
  "Blizzard": "winter",
  "Heavy Snow": "winter",
  "Ice Storm": "winter",
  "Cold/Wind Chill": "winter",
  "Extreme Cold/Wind Chill": "winter",
  "Hurricane": "tropical",
  "Hurricane (Typhoon)": "tropical",
  "Tropical Storm": "tropical",
  // Drought and Wildfire are deliberately excluded: drought rows are monthly
  // county entries that would chain into meaningless months-long megaclusters.
};

// ─── State adjacency (land borders) + documented storm-corridor bridges ─────
const ADJ: Record<string, string[]> = {
  AL: ["FL", "GA", "MS", "TN"],
  AK: [],
  AZ: ["CA", "CO", "NM", "NV", "UT"],
  AR: ["LA", "MO", "MS", "OK", "TN", "TX"],
  CA: ["AZ", "NV", "OR"],
  CO: ["AZ", "KS", "NE", "NM", "OK", "UT", "WY"],
  CT: ["MA", "NY", "RI"],
  DE: ["MD", "NJ", "PA"],
  FL: ["AL", "GA"],
  GA: ["AL", "FL", "NC", "SC", "TN"],
  HI: [],
  ID: ["MT", "NV", "OR", "UT", "WA", "WY"],
  IL: ["IA", "IN", "KY", "MO", "WI"],
  IN: ["IL", "KY", "MI", "OH"],
  IA: ["IL", "MN", "MO", "NE", "SD", "WI"],
  KS: ["CO", "MO", "NE", "OK"],
  KY: ["IL", "IN", "MO", "OH", "TN", "VA", "WV"],
  LA: ["AR", "MS", "TX"],
  ME: ["NH"],
  MD: ["DE", "PA", "VA", "WV"],
  MA: ["CT", "NH", "NY", "RI", "VT"],
  MI: ["IN", "OH", "WI"],
  MN: ["IA", "ND", "SD", "WI"],
  MS: ["AL", "AR", "LA", "TN"],
  MO: ["AR", "IA", "IL", "KS", "KY", "NE", "OK", "TN"],
  MT: ["ID", "ND", "SD", "WY"],
  NE: ["CO", "IA", "KS", "MO", "SD", "WY"],
  NV: ["AZ", "CA", "ID", "OR", "UT"],
  NH: ["MA", "ME", "VT"],
  NJ: ["DE", "NY", "PA"],
  NM: ["AZ", "CO", "OK", "TX", "UT"],
  NY: ["CT", "MA", "NJ", "PA", "VT"],
  NC: ["GA", "SC", "TN", "VA"],
  ND: ["MN", "MT", "SD"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  OK: ["AR", "CO", "KS", "MO", "NM", "TX"],
  OR: ["CA", "ID", "NV", "WA"],
  PA: ["DE", "MD", "NJ", "NY", "OH", "WV"],
  RI: ["CT", "MA"],
  SC: ["GA", "NC"],
  SD: ["IA", "MN", "MT", "ND", "NE", "WY"],
  TN: ["AL", "AR", "GA", "KY", "MO", "MS", "NC", "VA"],
  TX: ["AR", "LA", "NM", "OK"],
  UT: ["AZ", "CO", "ID", "NM", "NV", "WY"],
  VT: ["MA", "NH", "NY"],
  VA: ["KY", "MD", "NC", "TN", "WV"],
  WA: ["ID", "OR"],
  WV: ["KY", "MD", "OH", "PA", "VA"],
  WI: ["IA", "IL", "MI", "MN"],
  WY: ["CO", "ID", "MT", "NE", "SD", "UT"],
};

// Storm systems don't respect the border: these pairs are separated only by a
// Great Lake or Canadian territory that a moving storm crosses in hours.
// Without the MI–NY (southern Ontario) bridge the 1999 Boundary Waters derecho
// splits into two clusters exactly where it crossed Ontario.
const BRIDGES: Array<[string, string]> = [
  ["MI", "NY"], // southern Ontario traverse (Port Huron → Buffalo)
  ["MN", "MI"], // Lake Superior water border
  ["MI", "IL"], // Lake Michigan water border
];
for (const [a, b] of BRIDGES) {
  if (!ADJ[a].includes(b)) ADJ[a].push(b);
  if (!ADJ[b].includes(a)) ADJ[b].push(a);
}

function statesAdjacent(a: string, b: string): boolean {
  return a === b || (ADJ[a] || []).includes(b);
}

// ─── Key bootstrap (same pattern as otd-ingest.ts / orchestrator-v2.ts) ─────
function bootstrapServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — from environment");
    return;
  }
  try {
    const out = execSync(
      "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null",
      { encoding: "utf-8", timeout: 30_000 }
    ).trim();
    let key = "";
    try {
      const parsed = JSON.parse(out);
      key =
        (parsed.keys || parsed || []).find?.(
          (k: any) => k.name === "service_role" || k.id === "service_role"
        )?.api_key || "";
    } catch {
      const line = out.split("\n").find((l) => l.includes("service_role"));
      key = line ? line.trim().split(/\s+/).pop() || "" : "";
    }
    if (key && key.startsWith("ey")) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = key;
      console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — fetched from CLI");
    } else {
      console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned empty. Cannot continue.");
      process.exit(1);
    }
  } catch {
    console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI fetch failed. Export it and rerun.");
    process.exit(1);
  }
}

function bootstrapVoyageKey() {
  if (process.env.VOYAGE_API_KEY) {
    console.log("  ✓ VOYAGE_API_KEY — from environment");
    return;
  }
  const envLocalPath = join(SCRIPTS_DIR, "..", ".env.local");
  if (existsSync(envLocalPath)) {
    for (const line of readFileSync(envLocalPath, "utf-8").split("\n")) {
      const match = line.match(/^VOYAGE_API_KEY=(.+)$/);
      if (match) {
        process.env.VOYAGE_API_KEY = match[1].trim();
        console.log("  ✓ VOYAGE_API_KEY — from .env.local");
      }
    }
  }
  if (!process.env.VOYAGE_API_KEY) {
    console.error("  ✗ VOYAGE_API_KEY required for --commit.");
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
      console.log(`  ${label}: attempt ${attempt} failed (${String(lastErr).slice(0, 120)}), retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ─── Stage 1: fetch + cluster ────────────────────────────────────────────────
type MemberRow = {
  id: string;
  date: string; // effective_date
  state: string;
  family: string;
  eventType: string;
  county: string;
  deaths: number;
  injuries: number;
  damageUsd: number;
  magnitude: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null; // trimmed narrative, kept only when it carries facts
};

function parseDamage(val: unknown): number {
  if (typeof val !== "string" || !val.trim()) return 0;
  const m = val.trim().toUpperCase().match(/^([\d.]+)([KMB])?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  return n * (m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1);
}

function toMember(r: any): MemberRow | null {
  const meta = r.metadata || {};
  const family = FAMILY[meta.event_type];
  if (!family || !r.state_abbr || !r.effective_date) return null;
  const deaths = Number(meta.deaths) || 0;
  const injuries = Number(meta.injuries) || 0;
  const damageUsd = parseDamage(meta.property_damage) + parseDamage(meta.crop_damage);
  // Keep a narrative excerpt only when the row is impactful — controls memory
  // on the full pass and keeps naming prompts lean.
  let note: string | null = null;
  const narrMatch = typeof r.content === "string" ? r.content.match(/narrative:(.+)$/s) : null;
  if (narrMatch && (deaths > 0 || injuries > 0 || damageUsd >= 1e6 || Number(meta.magnitude) >= 65)) {
    note = narrMatch[1].trim().slice(0, 280);
  }
  return {
    id: r.id,
    date: r.effective_date,
    state: r.state_abbr,
    family,
    eventType: meta.event_type,
    county: meta.county || "",
    deaths,
    injuries,
    damageUsd,
    magnitude: meta.magnitude ?? null,
    lat: typeof meta.lat === "number" ? meta.lat : null,
    lng: typeof meta.lng === "number" ? meta.lng : null,
    note,
  };
}

/** Paginated fetch of storm-event rows for a date window (read-only, bounded). */
async function fetchWindow(dateGte: string, dateLte: string, states: string[] | null): Promise<MemberRow[]> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const rows: MemberRow[] = [];
  let offset = 0;
  for (;;) {
    let url =
      `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
      `?content_type=eq.${CONTENT_TYPE_IN}` +
      `&effective_date=gte.${dateGte}&effective_date=lte.${dateLte}` +
      `&select=id,effective_date,state_abbr,metadata,content` +
      `&order=effective_date.asc,id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    if (states && states.length) url += `&state_abbr=in.(${states.join(",")})`;
    const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } }, `fetch ${dateGte} +${offset}`);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error("fetch returned non-array");
    for (const r of page) {
      const m = toMember(r);
      if (m) rows.push(m);
    }
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    await sleep(120);
  }
  return rows;
}

// Union-find over buckets keyed by family|date|state. Rows in the same bucket
// are trivially one candidate; buckets merge when dates are within ±1 day and
// states are the same or adjacent. Bucket count is small (states × dates ×
// families), so the pairwise pass is cheap even on big windows.
type Cluster = { members: MemberRow[]; family: string };

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

function clusterRows(rows: MemberRow[]): Cluster[] {
  const buckets = new Map<string, MemberRow[]>();
  for (const r of rows) {
    const k = `${r.family}|${r.date}|${r.state}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(r);
  }
  const keys = [...buckets.keys()];
  const parent = keys.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const a = find(i), b = find(j);
    if (a !== b) parent[a] = b;
  };
  const parsed = keys.map((k) => {
    const [family, date, state] = k.split("|");
    return { family, date, state };
  });
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (parsed[i].family !== parsed[j].family) continue;
      if (dayDiff(parsed[i].date, parsed[j].date) > 1) continue;
      if (!statesAdjacent(parsed[i].state, parsed[j].state)) continue;
      union(i, j);
    }
  }
  const grouped = new Map<number, MemberRow[]>();
  for (let i = 0; i < keys.length; i++) {
    const root = find(i);
    let g = grouped.get(root);
    if (!g) grouped.set(root, (g = []));
    g.push(...buckets.get(keys[i])!);
  }
  return [...grouped.values()].map((members) => ({ members, family: members[0].family }));
}

// ─── Notability ──────────────────────────────────────────────────────────────
type ClusterStats = {
  n: number;
  states: string[];
  dates: string[]; // sorted unique
  deaths: number;
  injuries: number;
  damageUsd: number;
  score: number;
};

function statsOf(c: Cluster): ClusterStats {
  const states = [...new Set(c.members.map((m) => m.state))].sort();
  const dates = [...new Set(c.members.map((m) => m.date))].sort();
  const deaths = c.members.reduce((s, m) => s + m.deaths, 0);
  const injuries = c.members.reduce((s, m) => s + m.injuries, 0);
  const damageUsd = c.members.reduce((s, m) => s + m.damageUsd, 0);
  const score =
    c.members.length +
    100 * deaths +
    10 * injuries +
    damageUsd / 1e6 +
    25 * (states.length - 1);
  return { n: c.members.length, states, dates, deaths, injuries, damageUsd, score };
}

/** Notability floor — the "few" that earn an LLM call. Tune here. */
function isNotable(s: ClusterStats): boolean {
  if (s.n < MIN_MEMBERS) return false;
  return (
    s.score >= 200 ||
    s.deaths >= 3 ||
    s.injuries >= 25 ||
    s.damageUsd >= 100e6 ||
    (s.states.length >= 4 && s.n >= 40)
  );
}

// ─── Stage 2: AI naming ──────────────────────────────────────────────────────
const NAME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "one_paragraph", "families", "states", "date_span"],
  properties: {
    name: { type: "string" },
    one_paragraph: { type: "string" },
    families: { type: "array", items: { type: "string" } },
    states: { type: "array", items: { type: "string" } },
    date_span: { type: "string" },
  },
} as const;

const NAME_SYSTEM = `You name clusters of NCEI storm-event county reports that mechanically group into one weather event.
Return JSON: { "name", "one_paragraph", "families", "states", "date_span" }.
RULES (the project's honesty laws):
- one_paragraph may contain ONLY facts present in the provided rows: report counts, event types, counties/states, dates, wind magnitudes, casualties, damage figures, and narrative facts quoted from the rows. No color, no speculation, no causes, no external statistics.
- name: if the row facts unambiguously match a historically named event you are confident about, use that name (e.g. "Boundary Waters–Canadian Derecho"); otherwise build a plain descriptive name from type + region + dates. Never invent a name that sounds official.
- states: two-letter codes present in the rows. families: the family labels given. date_span: "YYYY-MM-DD to YYYY-MM-DD" from the rows.`;

function clusterFactSheet(c: Cluster, s: ClusterStats): string {
  const byStateDate = new Map<string, number>();
  for (const m of c.members) {
    const k = `${m.state} ${m.date} ${m.eventType}`;
    byStateDate.set(k, (byStateDate.get(k) || 0) + 1);
  }
  const breakdown = [...byStateDate.entries()]
    .sort()
    .map(([k, n]) => `${k}: ${n} reports`)
    .join("\n");
  const top = [...c.members]
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
    `FAMILY: ${c.family}`,
    `MEMBER ROWS: ${s.n} county storm reports`,
    `DATES: ${s.dates.join(", ")}`,
    `STATES: ${s.states.join(", ")}`,
    `TOTAL DEATHS: ${s.deaths} | TOTAL INJURIES: ${s.injuries} | TOTAL DAMAGE: $${Math.round(s.damageUsd / 1e6)}M`,
    ``,
    `PER STATE/DATE/TYPE BREAKDOWN:`,
    breakdown,
    ``,
    `HIGHEST-IMPACT MEMBER ROWS:`,
    top,
  ].join("\n");
}

type Naming = { name: string; one_paragraph: string; families: string[]; states: string[]; date_span: string };

let namingCostUsd = 0;

async function nameClusterViaApi(facts: string): Promise<Naming> {
  const res = await fetchWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        thinking: { type: "adaptive" },
        system: NAME_SYSTEM,
        output_config: { format: { type: "json_schema", schema: NAME_SCHEMA } },
        messages: [{ role: "user", content: facts }],
      }),
    },
    "claude"
  );
  const data = await res.json();
  if (data.usage) {
    namingCostUsd += (data.usage.input_tokens / 1e6) * 5 + (data.usage.output_tokens / 1e6) * 25;
  }
  const text = (data.content || []).find((b: any) => b.type === "text")?.text || "";
  return JSON.parse(text);
}

/** Fallback when no ANTHROPIC_API_KEY is exported: local Claude Code CLI. */
function nameClusterViaCli(facts: string): Naming {
  const prompt = `${NAME_SYSTEM}\n\nReturn ONLY the JSON object, no markdown fences.\n\n${facts}`;
  const out = execFileSync("claude", ["-p", "--model", "opus"], {
    input: prompt,
    encoding: "utf-8",
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const jsonText = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  return JSON.parse(jsonText);
}

async function nameCluster(c: Cluster, s: ClusterStats): Promise<Naming> {
  const facts = clusterFactSheet(c, s);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (process.env.ANTHROPIC_API_KEY) return await nameClusterViaApi(facts);
      return nameClusterViaCli(facts);
    } catch (err) {
      lastErr = err;
      await sleep(3_000 * attempt);
    }
  }
  throw lastErr;
}

/** Mechanical naming when the model can't be reached — the rows must survive. */
function fallbackNaming(c: Cluster, s: ClusterStats): Naming {
  const span = `${s.dates[0]} to ${s.dates[s.dates.length - 1]}`;
  const casualties = s.deaths ? ` ${s.deaths} deaths, ${s.injuries} injuries.` : "";
  return {
    name: `${c.family} — ${s.states.join(", ")} — ${span}`,
    one_paragraph: `${s.n} recorded ${c.family.toLowerCase()} rows across ${s.states.join(", ")}, ${span}.${casualties} Named mechanically after model naming failed; awaiting a re-name pass.`,
    families: [c.family],
    states: s.states,
    date_span: span,
  };
}

// ─── Stage 3: build + stage stitched rows ───────────────────────────────────
function primaryState(c: Cluster): string {
  const counts = new Map<string, number>();
  for (const m of c.members) counts.set(m.state, (counts.get(m.state) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function buildStitchedRow(c: Cluster, s: ClusterStats, naming: Naming) {
  return {
    content_type: CONTENT_TYPE_OUT,
    title: naming.name,
    content: naming.one_paragraph,
    effective_date: s.dates[0],
    state_abbr: primaryState(c),
    species: null,
    tags: ["stitched-event"],
    metadata: {
      member_ids: c.members.map((m) => m.id),
      states: s.states,
      families: [...new Set([c.family, ...(naming.families || [])])],
      date_span: `${s.dates[0]} to ${s.dates[s.dates.length - 1]}`,
      total_deaths: s.deaths,
      total_injuries: s.injuries,
      total_damage_usd: Math.round(s.damageUsd),
      n_members: s.n,
      source: "stitcher-v1",
    },
  };
}

function stageRow(row: ReturnType<typeof buildStitchedRow>) {
  appendFileSync(STAGE_FILE, JSON.stringify(row) + "\n");
}

// ─── Probe / full-pass drivers ───────────────────────────────────────────────
function fmtCluster(c: Cluster, s: ClusterStats): string {
  return (
    `${c.family.toUpperCase()} | ${s.n} members | ${s.states.join(",")} | ` +
    `${s.dates[0]}..${s.dates[s.dates.length - 1]} | deaths ${s.deaths} inj ${s.injuries} ` +
    `dmg $${Math.round(s.damageUsd / 1e6)}M | score ${Math.round(s.score)}${isNotable(s) ? " ★NOTABLE" : ""}`
  );
}

async function runProbe(range: string, states: string[] | null, doName: boolean) {
  const [gte, lte] = range.split("..");
  if (!gte || !lte) {
    console.error("Bad --probe range, expected YYYY-MM-DD..YYYY-MM-DD");
    process.exit(1);
  }
  console.log(`\n=== PROBE ${gte}..${lte}${states ? ` states=${states.join(",")}` : " (all states)"} — READ-ONLY ===`);
  const rows = await fetchWindow(gte, lte, states);
  console.log(`fetched ${rows.length} storm-event rows (family-mapped)`);
  const clusters = clusterRows(rows).filter((c) => c.members.length >= MIN_MEMBERS);
  clusters.sort((a, b) => statsOf(b).score - statsOf(a).score);
  console.log(`${clusters.length} candidate clusters (>=${MIN_MEMBERS} members):\n`);
  for (const c of clusters) console.log("  " + fmtCluster(c, statsOf(c)));

  if (doName) {
    const notable = clusters.filter((c) => isNotable(statsOf(c))).slice(0, 3);
    console.log(`\n--- NAMING top ${notable.length} notable clusters (${process.env.ANTHROPIC_API_KEY ? "Claude API" : "claude CLI fallback"}) ---`);
    for (const c of notable) {
      const s = statsOf(c);
      try {
        const naming = await nameCluster(c, s);
        const row = buildStitchedRow(c, s, naming);
        stageRow(row);
        console.log(`\n★ ${naming.name}  [${row.metadata.date_span} | ${s.states.join(",")} | ${s.n} members]`);
        console.log(`  ${naming.one_paragraph}`);
      } catch (err) {
        console.error(`  naming failed: ${String(err).slice(0, 300)}`);
      }
    }
    if (namingCostUsd > 0) console.log(`\nnaming cost this run: $${namingCostUsd.toFixed(4)}`);
    console.log(`staged rows appended to ${STAGE_FILE} (NOT inserted — run --commit later)`);
  }
}

function* monthWindows(start: string, end: string): Generator<[string, string]> {
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    yield [`${y}-${String(m).padStart(2, "0")}-01`, `${y}-${String(m).padStart(2, "0")}-${last}`];
    m++;
    if (m > 12) { m = 1; y++; }
  }
}

/**
 * Full pass — streams month windows so it never holds 1.5M rows in memory and
 * never runs an unbounded query. Clusters that touch the final day of a window
 * stay "open" and merge with the next month's rows before being finalized.
 */
async function runFull(start: string, end: string) {
  console.log(`\n=== FULL PASS ${start}..${end} — cluster + name + STAGE (no inserts) ===`);
  let carry: MemberRow[] = [];
  let totalRows = 0, totalClusters = 0, totalNotable = 0, named = 0, nameFailed = 0;
  const windows = [...monthWindows(start, end)];
  for (let w = 0; w < windows.length; w++) {
    const [gte, lte] = windows[w];
    const rows = await fetchWindow(gte, lte, null);
    totalRows += rows.length;
    const pool = carry.concat(rows);
    const clusters = clusterRows(pool);
    // Clusters touching the last 2 days of the window may continue next month.
    const boundary = Date.parse(lte) - 86_400_000;
    const done: Cluster[] = [];
    carry = [];
    for (const c of clusters) {
      const maxDate = Math.max(...c.members.map((m) => Date.parse(m.date)));
      if (w < windows.length - 1 && maxDate >= boundary) carry.push(...c.members);
      else done.push(c);
    }
    const candidates = done.filter((c) => c.members.length >= MIN_MEMBERS);
    totalClusters += candidates.length;
    for (const c of candidates) {
      const s = statsOf(c);
      if (!isNotable(s)) continue;
      totalNotable++;
      try {
        const naming = await nameCluster(c, s);
        stageRow(buildStitchedRow(c, s, naming));
        named++;
        console.log(`  ★ ${naming.name} (${s.n} members, ${s.states.join(",")})`);
      } catch (err) {
        nameFailed++;
        console.error(`  naming failed for ${fmtCluster(c, s)}: ${String(err).slice(0, 200)}`);
        // Never drop a notable cluster — stage under a mechanical name tagged
        // needs-naming so the rows survive to --commit; re-name pass finds them by tag.
        const row = buildStitchedRow(c, s, fallbackNaming(c, s));
        row.tags.push("needs-naming");
        stageRow(row);
      }
      await sleep(300);
    }
    console.log(`${gte.slice(0, 7)}: ${rows.length} rows → ${candidates.length} candidates (running: ${totalClusters} clusters, ${totalNotable} notable, ${named} named)`);
  }
  console.log(`\nFULL PASS DONE: ${totalRows} rows, ${totalClusters} candidate clusters, ${totalNotable} notable, ${named} named, ${nameFailed} failed`);
  if (namingCostUsd > 0) console.log(`total naming cost: $${namingCostUsd.toFixed(2)}`);
  console.log(`staged: ${STAGE_FILE} — run --commit when the write pipe is free.`);
  if (nameFailed > 0) process.exitCode = 1;
}

// ─── Stage 4: COMMIT (embed + insert) — the ONLY stage that writes ──────────
async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetchWithRetry(
    "https://api.voyageai.com/v1/embeddings",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
    },
    "Voyage"
  );
  const data = await res.json();
  if (!Array.isArray(data.data)) throw new Error("Voyage returned no data array");
  return data.data.map((d: any) => d.embedding);
}

async function existingStitchedTitles(): Promise<Set<string>> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const titles = new Set<string>();
  let offset = 0;
  for (;;) {
    const url =
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.${CONTENT_TYPE_OUT}` +
      `&select=title,effective_date&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } }, "existing");
    const rows = await res.json();
    for (const r of rows) titles.add(`${r.title}|${r.effective_date}`);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return titles;
}

async function runCommit() {
  bootstrapVoyageKey();
  if (!existsSync(STAGE_FILE)) {
    console.error(`No staged file at ${STAGE_FILE} — run --probe/--full first.`);
    process.exit(1);
  }
  const rows = readFileSync(STAGE_FILE, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const already = await existingStitchedTitles();
  const seen = new Set<string>(already);
  const deduped = rows.filter((r) => {
    const k = `${r.title}|${r.effective_date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Season-blob gate: an event is not a season. Wide+long clusters are the
  // clusterer gluing a whole convective summer together (e.g. 23k-member
  // "May–Aug 2001 thunderstorm wind", 48 states) — real multi-week events
  // (Blizzard of '96: 5 days; a months-long 9-state flood) pass. Drop only
  // when BOTH long (>21 days) and near-national (≥15 states), and log every
  // drop — no silent caps.
  const spanDays = (r: { metadata: { date_span: string } }) => {
    const [a, b] = r.metadata.date_span.split(" to ");
    return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
  };
  const isBlob = (r: { metadata: { date_span: string; states: string[] } }) =>
    spanDays(r) > 21 && r.metadata.states.length >= 15;
  const blobs = deduped.filter(isBlob);
  const pending = deduped.filter((r) => !isBlob(r));
  for (const r of blobs) {
    console.log(`  DROPPED season-blob: ${r.title} (${r.metadata.n_members} members, ${spanDays(r)} days, ${r.metadata.states.length} states)`);
  }
  console.log(`=== COMMIT === ${rows.length} staged, ${rows.length - deduped.length} already present/dupe, ${blobs.length} season-blobs dropped, ${pending.length} to insert`);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  let inserted = 0;
  for (let b = 0; b * EMBED_BATCH < pending.length; b++) {
    const batch = pending.slice(b * EMBED_BATCH, (b + 1) * EMBED_BATCH);
    const embeddings = await embed(batch.map((r) => `${r.effective_date} | stitched event | ${r.title} | ${r.content}`));
    if (embeddings.length !== batch.length) throw new Error(`Voyage returned ${embeddings.length} for ${batch.length}`);
    const payload = batch.map((r, i) => ({ ...r, embedding: JSON.stringify(embeddings[i]) }));
    await fetchWithRetry(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      },
      "insert"
    );
    inserted += batch.length;
    writeFileSync(COMMIT_CHECKPOINT, JSON.stringify({ inserted, at: new Date().toISOString() }) + "\n");
    console.log(`  batch ${b + 1}: +${batch.length} (total ${inserted})`);
    await sleep(200);
  }
  console.log(`COMMIT COMPLETE: ${inserted} stitched-event rows embedded and inserted.`);
}

function status() {
  const staged = existsSync(STAGE_FILE)
    ? readFileSync(STAGE_FILE, "utf-8").split("\n").filter((l) => l.trim()).length
    : 0;
  console.log(`Staged stitched events: ${staged} (${STAGE_FILE})`);
  if (existsSync(COMMIT_CHECKPOINT)) console.log(`Last commit checkpoint: ${readFileSync(COMMIT_CHECKPOINT, "utf-8").trim()}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  if (args.includes("--status")) return status();

  console.log("EVENT STITCHER — storm-event rows → named stitched-event stories");
  bootstrapServiceKey();

  if (args.includes("--commit")) return runCommit();

  const probe = get("--probe");
  if (probe) {
    const states = get("--states")?.split(",").map((s) => s.trim().toUpperCase()) || null;
    return runProbe(probe, states, args.includes("--name"));
  }

  if (args.includes("--full")) {
    return runFull(get("--start") || "1990-01", get("--end") || "2026-07");
  }

  console.log(
    "\nUsage:\n" +
      "  --probe YYYY-MM-DD..YYYY-MM-DD [--states MN,WI,...] [--name]   read-only cluster probe\n" +
      "  --full [--start 1990-01] [--end 2026-07]                        stream cluster+name+stage\n" +
      "  --commit                                                        embed + insert staged JSONL (WRITE stage)\n" +
      "  --status"
  );
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

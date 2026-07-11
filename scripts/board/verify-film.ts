/**
 * verify-film.ts — the board's contract warden.
 *
 * A baked film (public/board/*.json) is only as good as its agreement with the
 * player (src/lib/boardPlayer.ts). Tonight a `kind` mismatch slipped past a
 * green build and a passing render — the JSON said "temp", the player wanted
 * "state-temp", and tap-cards quietly fell back to generic phrasing. Nothing
 * threw. This warden makes that class of drift LOUD: it reads a baked film and
 * checks it against the same contract the player enforces, exiting non-zero on
 * any hard violation so a bad bake can never be called "done".
 *
 * This is the test harness the film engine loops against as it generalizes past
 * Uri — every new film must pass this before it's a film.
 *
 * Usage:  npx tsx scripts/board/verify-film.ts [public/board/uri-2021.json ...]
 *         (no args → verifies every public/board/*.json)
 * READ-ONLY. No network, no database. Pure contract check over the JSON.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..", "..");
const BOARD_DIR = join(REPO_ROOT, "public", "board");

// The player's dot-kind contract (src/lib/boardPlayer.ts + readingFor()). Any
// kind outside this set renders but loses its tuned tap-card phrasing.
const ALLOWED_KINDS = new Set(["needle", "state-temp", "buoy-pressure", "tide-setdown"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Report {
  file: string;
  errors: string[];
  warnings: string[];
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
function isPct(x: unknown): boolean {
  return isFiniteNum(x) && x >= 0 && x <= 1;
}

function verifyFilm(path: string): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const E = (m: string) => errors.push(m);
  const W = (m: string) => warnings.push(m);

  let film: any;
  try {
    film = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err: any) {
    return { file: path, errors: [`unreadable / invalid JSON: ${err.message}`], warnings: [] };
  }

  // ── Top level ───────────────────────────────────────────────────────────────
  for (const k of ["story", "title", "subtitle"]) {
    if (typeof film[k] !== "string" || !film[k].trim()) E(`${k}: missing or empty string`);
  }
  const win = film.window;
  let winStart = "", winEnd = "";
  if (!Array.isArray(win) || win.length !== 2 || !ISO.test(win[0]) || !ISO.test(win[1])) {
    E(`window: must be [ISO, ISO]`);
  } else {
    [winStart, winEnd] = win;
    if (winStart > winEnd) E(`window: start ${winStart} is after end ${winEnd}`);
  }
  const proj = film.projection;
  let pw = 0, ph = 0;
  if (!proj || !isFiniteNum(proj.width) || !isFiniteNum(proj.height) || proj.width <= 0 || proj.height <= 0) {
    E(`projection: must be { width>0, height>0 }`);
  } else {
    pw = proj.width; ph = proj.height;
  }
  for (const arr of ["dots", "strings", "blooms", "beats"]) {
    if (!Array.isArray(film[arr])) E(`${arr}: must be an array`);
  }
  if (errors.length) return { file: path, errors, warnings }; // shape is broken; deeper checks would just noise

  const inWindow = (d: string) => !winStart || (d >= winStart && d <= winEnd);

  // ── Dots ──────────────────────────────────────────────────────────────────
  const ids = new Set<string>();
  let needleCount = 0;
  for (let i = 0; i < film.dots.length; i++) {
    const dot = film.dots[i];
    const tag = `dots[${i}]${dot?.id ? ` (${dot.id})` : ""}`;
    if (typeof dot?.id !== "string" || !dot.id.trim()) { E(`${tag}: missing id`); continue; }
    if (ids.has(dot.id)) E(`${tag}: duplicate id`);
    ids.add(dot.id);
    if (typeof dot.label !== "string" || !dot.label.trim()) E(`${tag}: missing label`);
    if (!ALLOWED_KINDS.has(dot.kind)) E(`${tag}: kind "${dot.kind}" not in player contract {${[...ALLOWED_KINDS].join(", ")}}`);
    if (dot.kind === "needle") needleCount++;
    if (!isFiniteNum(dot.x) || !isFiniteNum(dot.y)) E(`${tag}: x/y must be finite numbers`);
    else if (pw && (dot.x < 0 || dot.x > pw || dot.y < 0 || dot.y > ph)) W(`${tag}: x/y (${dot.x},${dot.y}) outside projection ${pw}x${ph}`);
    if (!dot.series || typeof dot.series !== "object") { E(`${tag}: missing series`); continue; }

    let coverage = 0, outOfWindow = 0;
    for (const [d, datum] of Object.entries<any>(dot.series)) {
      if (!ISO.test(d)) E(`${tag}: series key "${d}" is not ISO`);
      else if (!inWindow(d)) outOfWindow++;
      const hasV = datum && "v" in datum, hasPct = datum && "pct" in datum;
      if (!hasV || !hasPct) { E(`${tag}[${d}]: datum must carry {v, pct}`); continue; }
      if (datum.v !== null && !isFiniteNum(datum.v)) E(`${tag}[${d}]: v must be number|null`);
      if (datum.pct !== null && !isPct(datum.pct)) E(`${tag}[${d}]: pct must be 0..1|null (got ${datum.pct})`);
      if (datum.pct !== null && datum.v !== null) coverage++;
    }
    if (coverage === 0) W(`${tag}: dead dot — zero days with both v and pct (never lights)`);
    if (outOfWindow) W(`${tag}: ${outOfWindow} series day(s) outside the film window`);
  }
  if (needleCount === 0) W(`no "needle" dot — the sky has no anchor`);

  // ── Strings ─────────────────────────────────────────────────────────────────
  for (let i = 0; i < film.strings.length; i++) {
    const s = film.strings[i];
    const tag = `strings[${i}]`;
    if (!ids.has(s?.from)) E(`${tag}: from "${s?.from}" references no dot`);
    if (!ids.has(s?.to)) E(`${tag}: to "${s?.to}" references no dot`);
    if (typeof s?.receipt !== "string" || !s.receipt.trim()) E(`${tag}: missing receipt`);
    if (!s?.activation || typeof s.activation !== "object") { E(`${tag}: missing activation`); continue; }
    let peak = 0;
    for (const [d, a] of Object.entries<any>(s.activation)) {
      if (!ISO.test(d)) E(`${tag}: activation key "${d}" is not ISO`);
      if (!isPct(a)) E(`${tag}[${d}]: activation must be 0..1 (got ${a})`);
      else peak = Math.max(peak, a);
    }
    // The player only etches a string whose running-peak activation reaches 0.9.
    if (peak < 0.9) W(`${tag}: peak activation ${peak.toFixed(3)} < 0.9 — never etches (stays a live string, never brass)`);
  }

  // ── Blooms ──────────────────────────────────────────────────────────────────
  for (let i = 0; i < film.blooms.length; i++) {
    const b = film.blooms[i];
    const tag = `blooms[${i}]`;
    if (!ISO.test(b?.date)) E(`${tag}: date is not ISO`);
    else if (!inWindow(b.date)) W(`${tag}: date ${b.date} outside the film window`);
    if (typeof b?.label !== "string" || !b.label.trim()) E(`${tag}: missing label`);
    const hasXY = isFiniteNum(b?.x) && isFiniteNum(b?.y);
    if (!hasXY && !b?.anchor) E(`${tag}: needs either x/y or an anchor dot`);
    if (b?.anchor && !ids.has(b.anchor)) E(`${tag}: anchor "${b.anchor}" references no dot`);
    if (hasXY && pw && (b.x < 0 || b.x > pw || b.y < 0 || b.y > ph)) W(`${tag}: x/y outside projection`);
  }
  if (film.blooms.length === 0) W(`no blooms — the film has no gut punch`);

  // ── Beats ─────────────────────────────────────────────────────────────────
  for (let i = 0; i < film.beats.length; i++) {
    const bt = film.beats[i];
    const tag = `beats[${i}]`;
    if (!ISO.test(bt?.date)) E(`${tag}: date is not ISO`);
    else if (!inWindow(bt.date)) W(`${tag}: date ${bt.date} outside the film window`);
    if (typeof bt?.line !== "string" || !bt.line.trim()) E(`${tag}: missing line`);
  }
  if (film.beats.length === 0) W(`no beats — the porch voice is silent`);

  return { file: path, errors, warnings };
}

// ── Runner ───────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  let files: string[];
  if (args.length) {
    files = args.map((a) => (a.startsWith("/") ? a : join(REPO_ROOT, a)));
  } else if (existsSync(BOARD_DIR)) {
    files = readdirSync(BOARD_DIR).filter((f) => f.endsWith(".json")).map((f) => join(BOARD_DIR, f));
  } else {
    console.error("no public/board/ directory and no file args");
    process.exit(1);
  }
  if (files.length === 0) {
    console.error("no film JSON files to verify");
    process.exit(1);
  }

  let hardFails = 0, warnTotal = 0;
  for (const f of files) {
    const r = verifyFilm(f);
    const name = basename(r.file);
    if (r.errors.length === 0 && r.warnings.length === 0) {
      console.log(`✓ ${name} — clean`);
    } else if (r.errors.length === 0) {
      console.log(`✓ ${name} — passes contract (${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"})`);
      for (const w of r.warnings) console.log(`    ⚠ ${w}`);
    } else {
      console.log(`✗ ${name} — ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}`);
      for (const e of r.errors) console.log(`    ✗ ${e}`);
      for (const w of r.warnings) console.log(`    ⚠ ${w}`);
      hardFails++;
    }
    warnTotal += r.warnings.length;
  }

  console.log(
    `\n${hardFails ? "✗" : "✓"} ${files.length} film(s) checked · ${hardFails} failing · ${warnTotal} warning(s)`,
  );
  process.exit(hardFails ? 1 : 0);
}

main();

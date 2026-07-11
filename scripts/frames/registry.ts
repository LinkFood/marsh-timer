/**
 * registry.ts — THE BOARD's v1 instrument registry + slot layout, shared by the
 * seed (writes it to board_instruments/board_layout) and the backfill (computes
 * frames against it). ONE definition so the layout_version can never drift between
 * writer and packer — the sharpest footgun in the spine (§7.2) closed by sharing code.
 *
 * See seed-instruments.ts for the ~71-instrument composition + the flagged spine
 * deviations (buoy count, AO daily source, direct avg_high_f field).
 */

import { project, PROJ_VERSION } from "../board/projection.ts";
import { STATE_CENTROIDS } from "../../supabase/functions/_shared/states.ts";

export type MetricDef = { field: string; direction: "low" | "high" | "two-sided"; n_days: number; min_years: number; label: string };

export const STATE_METRICS: MetricDef[] = [
  { field: "avg_high_f", direction: "two-sided", n_days: 10, min_years: 10, label: "air temperature" },
];
export const TIDE_METRICS: MetricDef[] = [
  { field: "residual_max_ft", direction: "high", n_days: 15, min_years: 10, label: "surge" },
  { field: "residual_min_ft", direction: "low", n_days: 15, min_years: 10, label: "setdown" },
];
export const BUOY_METRICS: MetricDef[] = [
  { field: "min_pressure_mb", direction: "low", n_days: 15, min_years: 10, label: "storm low" },
  { field: "pressure_mb", direction: "high", n_days: 15, min_years: 10, label: "ridge" },
];
export const NEEDLE_METRICS: MetricDef[] = [
  { field: "value", direction: "two-sided", n_days: 15, min_years: 10, label: "the index" },
];

// 11 tide gauges — tide-roster-backfill.ts ROSTER.
export const TIDE_ROSTER: { id: string; name: string; state: string; lat: number; lng: number }[] = [
  { id: "8518750", name: "The Battery", state: "NY", lat: 40.7006, lng: -74.0142 },
  { id: "8531680", name: "Sandy Hook", state: "NJ", lat: 40.4669, lng: -74.0094 },
  { id: "8516945", name: "Kings Point", state: "NY", lat: 40.8103, lng: -73.7649 },
  { id: "8461490", name: "New London", state: "CT", lat: 41.3717, lng: -72.0956 },
  { id: "8761724", name: "Grand Isle", state: "LA", lat: 29.2633, lng: -89.9567 },
  { id: "8747437", name: "Bay Waveland", state: "MS", lat: 30.3264, lng: -89.3258 },
  { id: "8735180", name: "Dauphin Island", state: "AL", lat: 30.25, lng: -88.075 },
  { id: "8574680", name: "Baltimore", state: "MD", lat: 39.2669, lng: -76.5786 },
  { id: "8575512", name: "Annapolis", state: "MD", lat: 38.9833, lng: -76.4816 },
  { id: "8571892", name: "Cambridge", state: "MD", lat: 38.5725, lng: -76.0617 },
  { id: "8577330", name: "Solomons Island", state: "MD", lat: 38.3172, lng: -76.4512 },
];
// 6 buoys — ndbc-pressure ALL_STATIONS ∪ bake-uri BUOYS (Uri's 3 must be present).
export const BUOY_ROSTER: { id: string; name: string; state: string; lat: number; lng: number }[] = [
  { id: "42040", name: "Luke Island", state: "MS", lat: 29.2, lng: -88.2 },
  { id: "42001", name: "Mid Gulf", state: "LA", lat: 25.9, lng: -89.7 },
  { id: "44025", name: "Long Island", state: "NY", lat: 40.3, lng: -73.2 },
  { id: "42002", name: "West Gulf", state: "TX", lat: 26.0, lng: -93.6 },
  { id: "42035", name: "Galveston", state: "TX", lat: 29.2, lng: -94.4 },
  { id: "42019", name: "Freeport", state: "TX", lat: 29.0, lng: -95.4 },
];
// 4 needles — fixed chrome positions (AO pinned at 487,28 per §1.3). AO reads the
// daily CPC file; the rest read monthly climate-index.
export const NEEDLE_ROSTER: { index_id: string; label: string; sublabel: string; source_ct: string; x: number; y: number }[] = [
  { index_id: "AO", label: "Arctic Oscillation", sublabel: "the pole's grip", source_ct: "cpc-daily-ao", x: 487, y: 28 },
  { index_id: "NAO", label: "North Atlantic Oscillation", sublabel: "the Atlantic's mood", source_ct: "climate-index", x: 607, y: 28 },
  { index_id: "PDO", label: "Pacific Decadal Oscillation", sublabel: "the Pacific's long tide", source_ct: "climate-index", x: 727, y: 28 },
  { index_id: "ENSO", label: "ENSO Niño 3.4", sublabel: "the equatorial signal", source_ct: "climate-index", x: 847, y: 28 },
];

export type Instrument = {
  id: string; kind: string; label: string; sublabel: string | null; lane: string;
  lat: number | null; lng: number | null; albers_x: number | null; albers_y: number | null;
  proj_version: number; source_ct: string; source_key: Record<string, string>; metrics: MetricDef[];
};

export function buildInstruments(): Instrument[] {
  const out: Instrument[] = [];
  for (const abbr of Object.keys(STATE_CENTROIDS)) {
    const c = STATE_CENTROIDS[abbr];
    const p = project(c.lat, c.lng);
    out.push({ id: `ghcn-${abbr.toLowerCase()}`, kind: "state-temp", label: c.name, sublabel: "air temperature", lane: "air", lat: c.lat, lng: c.lng, albers_x: p.x, albers_y: p.y, proj_version: PROJ_VERSION, source_ct: "ghcn-daily", source_key: { state_abbr: abbr }, metrics: STATE_METRICS });
  }
  for (const t of TIDE_ROSTER) {
    const p = project(t.lat, t.lng);
    out.push({ id: `tide-${t.id}`, kind: "tide", label: t.name, sublabel: `tide setdown & surge (${t.state})`, lane: "water-level", lat: t.lat, lng: t.lng, albers_x: p.x, albers_y: p.y, proj_version: PROJ_VERSION, source_ct: "tide-gauge", source_key: { station_id: t.id }, metrics: TIDE_METRICS });
  }
  for (const b of BUOY_ROSTER) {
    const p = project(b.lat, b.lng);
    out.push({ id: `buoy-${b.id}`, kind: "buoy", label: `Buoy ${b.name}`, sublabel: `Gulf/coastal pressure (${b.state})`, lane: "ocean-pressure", lat: b.lat, lng: b.lng, albers_x: p.x, albers_y: p.y, proj_version: PROJ_VERSION, source_ct: "ocean-buoy-historical", source_key: { station_id: b.id }, metrics: BUOY_METRICS });
  }
  for (const n of NEEDLE_ROSTER) {
    out.push({ id: `needle-${n.index_id.toLowerCase()}`, kind: "needle", label: n.label, sublabel: n.sublabel, lane: "climate", lat: null, lng: null, albers_x: n.x, albers_y: n.y, proj_version: PROJ_VERSION, source_ct: n.source_ct, source_key: { index_id: n.index_id }, metrics: NEEDLE_METRICS });
  }
  return out;
}

const KIND_ORDER: Record<string, number> = { needle: 0, "state-temp": 1, tide: 2, buoy: 3 };
export function canonicalOrder(insts: Instrument[]): Instrument[] {
  return [...insts].sort((a, b) => {
    const k = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
    return k !== 0 ? k : a.id.localeCompare(b.id);
  });
}
// A metric expands to its one-sided storage slots (§2.3): two-sided → [low, high];
// a directional metric → its one side. Each byte is one-sided (no sign byte).
export function metricSides(m: MetricDef): ("low" | "high")[] {
  return m.direction === "two-sided" ? ["low", "high"] : [m.direction];
}
export function slotCountFor(inst: Instrument): number {
  return inst.metrics.reduce((n, m) => n + metricSides(m).length, 0);
}
export type SlotManifestEntry = { inst_id: string; metric: string; side: "low" | "high"; offset: number };
export function buildLayout(ordered: Instrument[]): { version: number; manifest: SlotManifestEntry[]; slotCount: number } {
  const manifest: SlotManifestEntry[] = [];
  let offset = 0;
  for (const inst of ordered) {
    for (const m of inst.metrics) {
      for (const side of metricSides(m)) {
        manifest.push({ inst_id: inst.id, metric: m.field, side, offset });
        offset++;
      }
    }
  }
  const sig = manifest.map((e) => `${e.inst_id}:${e.metric}:${e.side}`).join("|");
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h * 33) ^ sig.charCodeAt(i)) >>> 0;
  return { version: h % 2147483647, manifest, slotCount: offset };
}
export function withSlots(ordered: Instrument[]): (Instrument & { slot_offset: number; slot_count: number })[] {
  let offset = 0;
  return ordered.map((inst) => {
    const slot_count = slotCountFor(inst);
    const row = { ...inst, slot_offset: offset, slot_count };
    offset += slot_count;
    return row;
  });
}

/** The full v1 layout in one call: ordered instruments (with slot offsets), the
 *  per-side manifest, and the layout_version. Seed and backfill both start here. */
export function buildRegistry() {
  const insts = buildInstruments();
  const ordered = canonicalOrder(insts);
  const rows = withSlots(ordered);
  const layout = buildLayout(ordered);
  return { insts, ordered, rows, layout };
}

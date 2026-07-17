import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { InnerHeader, InnerFooter } from "@/components/InnerNav";
import { STATE_SHAPES, ATLAS_PROJECTION } from "@/data/atlas/stateShapesAlbers";
import { fetchStateAnomalyResponse } from "@/lib/atlas/stateChoropleth";
import { STATE_CENTROIDS } from "@/data/atlas/stateCentroids";
import { STATE_NAMES } from "@/data/atlas/stateBBoxes";
import SpotDossier, { type SpotData } from "@/components/atlas/SpotDossier";
import { toSpotData } from "@/lib/atlas/spotDossierAdapter";
import { SUPABASE_FUNCTIONS_URL } from "@/lib/supabase";
import { useYourGround } from "@/hooks/useYourGround";
import { consumeBornDoor, trackDateLookup } from "@/lib/analytics";

/**
 * ATLAS — the ground you stand on (docs/THE-VISION-AND-ROADMAP.md).
 *
 * ONE grammar with the front door: the same 975x610 Albers USA ground the
 * board films use (src/data/atlas/stateShapesAlbers.ts registers exactly with
 * conusBorders), each state tinted by what it's doing NOW — amber running
 * hot, ice running cold, near-invisible when normal. Same hue discipline as
 * boardPlayer's ember tints.
 *
 * THE DESCENT: tapping a state moves a CAMERA — the SVG viewBox rAF-tweens
 * (ease-out cubic) into the state's real geography while the other states dim.
 * Neighbors stay visible as map geography, not letter tiles. The reading lands
 * as a composed sentence under the map ("Maryland is about normal today —
 * +0.3σ against its own 76 Julys"), speaking the porch-clause vocabulary
 * (pinned / deep / leaning / about normal) so the two surfaces sound the same.
 * One recorded storm surfaces as a quiet caption with its denominator; the
 * dossier lands as a consequence. Esc or tapping outside surfaces back out.
 * prefers-reduced-motion: instant cut.
 *
 * Reliable SVG (no WebGL). Read-only. The hunter operates it; the kid marvels.
 */
const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

const VIEW_W = ATLAS_PROJECTION.width;
const VIEW_H = ATLAS_PROJECTION.height;

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } });
  return res.json();
}

// ---------------------------------------------------------------------------
// Ground geometry — per-state paths, bboxes, centers (module-level, computed once)
// ---------------------------------------------------------------------------
interface StateGeo {
  abbr: string;
  d: string; // SVG path
  rings: readonly (readonly number[])[];
  bbox: [number, number, number, number]; // minX, minY, maxX, maxY
  cx: number;
  cy: number;
}

const STATE_GEO: Record<string, StateGeo> = {};
for (const [abbr, rings] of Object.entries(STATE_SHAPES)) {
  let d = "";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    d += `M${ring[0]} ${ring[1]}`;
    for (let i = 2; i < ring.length; i += 2) d += `L${ring[i]} ${ring[i + 1]}`;
    d += "Z";
    for (let i = 0; i < ring.length; i += 2) {
      if (ring[i] < minX) minX = ring[i];
      if (ring[i] > maxX) maxX = ring[i];
      if (ring[i + 1] < minY) minY = ring[i + 1];
      if (ring[i + 1] > maxY) maxY = ring[i + 1];
    }
  }
  STATE_GEO[abbr] = {
    abbr,
    d,
    rings,
    bbox: [minX, minY, maxX, maxY],
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/** Even-odd point-in-polygon across all of a state's rings. */
function pointInState(geo: StateGeo, x: number, y: number): boolean {
  const [minX, minY, maxX, maxY] = geo.bbox;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  let inside = false;
  for (const ring of geo.rings) {
    const n = ring.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = ring[i], yi = ring[i + 1];
      const xj = ring[j], yj = ring[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Which state a projection-space point lands in; falls back to the nearest
 *  state center within `near` projection px (small-state tap forgiveness). */
function hitState(x: number, y: number, near: number): string | null {
  for (const geo of Object.values(STATE_GEO)) {
    if (pointInState(geo, x, y)) return geo.abbr;
  }
  let best: string | null = null;
  let bestD = near;
  for (const geo of Object.values(STATE_GEO)) {
    const d = Math.hypot(geo.cx - x, geo.cy - y);
    if (d < bestD) {
      bestD = d;
      best = geo.abbr;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The ember tint — same hue discipline as boardPlayer (amber hot, ice cold),
// near-invisible when normal so the quiet ground stays quiet.
// ---------------------------------------------------------------------------
const Z_FLOOR = 0.35; // below this a state shows nothing
const Z_CEIL = 3;
const QUIET_FILL = "rgba(255,255,255,0.015)";

function fillForZ(z: number | undefined): string {
  if (z === undefined) return QUIET_FILL;
  const mag = Math.min(Z_CEIL, Math.abs(z));
  if (mag < Z_FLOOR) return QUIET_FILL;
  const t = (mag - Z_FLOOR) / (Z_CEIL - Z_FLOOR);
  const a = 0.07 + t * 0.48;
  return z > 0 ? `rgba(255,176,96,${a.toFixed(3)})` : `rgba(148,196,255,${a.toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// The porch-clause vocabulary — the atlas speaks like the front door.
// ---------------------------------------------------------------------------
const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function sigmaStr(z: number): string {
  return `${z >= 0 ? "+" : "−"}${Math.abs(z).toFixed(1)}σ`;
}

/** "is pinned hot today" / "sits deep in its cold tail today" / ... */
function magnitudeClause(z: number): string {
  const warm = z >= 0;
  const mag = Math.abs(z);
  if (mag >= 2.5) return `is pinned ${warm ? "hot" : "cold"} today`;
  if (mag >= 1.5) return `sits deep in its ${warm ? "warm" : "cold"} tail today`;
  if (mag >= 0.75) return `is leaning ${warm ? "warm" : "cool"} today`;
  return "is about normal today";
}

/** Short form for the hover readout. */
function magnitudeWord(z: number | undefined): string {
  if (z === undefined) return "no reading today";
  const warm = z >= 0;
  const mag = Math.abs(z);
  if (mag >= 2.5) return `pinned ${warm ? "hot" : "cold"}`;
  if (mag >= 1.5) return `deep in its ${warm ? "warm" : "cold"} tail`;
  if (mag >= 0.75) return `leaning ${warm ? "warm" : "cool"}`;
  return "about normal";
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
interface ViewBox { x: number; y: number; w: number; h: number }

const FULL_VIEW: ViewBox = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
const DESCEND_MS = 650;
const SURFACE_MS = 500;

/** Landing frame: the state's bbox padded so neighbors stay visible, matched
 *  to the map's aspect (no distortion), never tighter than 240 units wide. */
function frameForState(abbr: string): ViewBox {
  const geo = STATE_GEO[abbr];
  if (!geo) return FULL_VIEW;
  const [minX, minY, maxX, maxY] = geo.bbox;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const aspect = VIEW_H / VIEW_W;
  let w = Math.max(bw * 1.7, 240);
  let h = w * aspect;
  if (h < bh * 1.7) {
    h = bh * 1.7;
    w = h / aspect;
  }
  return { x: geo.cx - w / 2, y: geo.cy - h / 2, w, h };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------
// Recorded-storm caption data (hunt-atlas-storms)
// ---------------------------------------------------------------------------
interface StormEvent {
  date: string;
  event_type: string;
  county: string | null;
  deaths: number;
  injuries: number;
  kind: "today-in-history" | "notable";
}

interface StormInfo {
  total: number;
  earliest_year: number | null;
  event: StormEvent | null;
}

function parseStorms(raw: Record<string, unknown>): StormInfo | null {
  if (typeof raw?.total !== "number") return null;
  const e = raw.event as Record<string, unknown> | null;
  return {
    total: raw.total,
    earliest_year: typeof raw.earliest_year === "number" ? raw.earliest_year : null,
    event:
      e && typeof e.date === "string"
        ? {
            date: e.date,
            event_type: typeof e.event_type === "string" ? e.event_type : "storm",
            county: typeof e.county === "string" ? e.county : null,
            deaths: typeof e.deaths === "number" ? e.deaths : 0,
            injuries: typeof e.injuries === "number" ? e.injuries : 0,
            kind: e.kind === "today-in-history" ? "today-in-history" : "notable",
          }
        : null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatEventDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------

interface StateReading {
  z: number;
  years: number | null;
}

export default function AtlasPage() {
  const [readings, setReadings] = useState<Record<string, StateReading>>({});
  const [readingsLoaded, setReadingsLoaded] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dossier, setDossier] = useState<SpotData | null>(null);
  const [loading, setLoading] = useState(false);
  const [storms, setStorms] = useState<StormInfo | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // /atlas?date=YYYY-MM-DD falls into any recorded day, not just today.
  const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("date") ?? "") ? searchParams.get("date") : null;
  // /atlas?state=XX auto-descends into that state on load (the Born flow lands
  // the visitor already fallen into their own ground, not on the national view).
  const stateParamRaw = (searchParams.get("state") ?? "").toUpperCase();
  const stateParam = STATE_GEO[stateParamRaw] ? stateParamRaw : null;
  // The shared ground choice (§2e): with no ?state, a visitor who has chosen a
  // ground arrives pre-descended into it — one tap (or Esc) surfaces back to
  // national. The atlas's own param is a camera target, so it is read here but
  // never passed into the hook (it must not clobber the choice).
  const { ground, chosen } = useYourGround();
  const mapCardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const didAutoDescend = useRef(false);
  // Where a tap began, so pointerup can tell a tap from a scroll-drag.
  const tapStart = useRef<{ x: number; y: number } | null>(null);

  // Camera state. `descended` flips the grammar (dim periphery, sentence).
  const [viewBox, setViewBox] = useState<ViewBox>(FULL_VIEW);
  const [descended, setDescended] = useState(false);
  const vbRef = useRef<ViewBox>(FULL_VIEW);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fetchStateAnomalyResponse()
      .then((res) => {
        const out: Record<string, StateReading> = {};
        for (const s of res.states) {
          if (s.z !== null && Number.isFinite(s.z)) {
            out[s.state] = { z: s.z, years: s.n_years > 0 ? s.n_years : null };
          }
        }
        setReadings(out);
        setReadingsLoaded(true);
      })
      .catch(() => setReadingsLoaded(true));
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Auto-descend when arriving with ?state=XX (e.g. the Born flow), or — with
  // no param — into the visitor's chosen ground (§2e: the atlas reads
  // your-ground on arrival). Fires once; the reading fills in when its fetch
  // lands. selectState carries dateParam.
  useEffect(() => {
    if (didAutoDescend.current) return;
    const target = stateParam ?? (chosen && STATE_GEO[ground] ? ground : null);
    if (!target) return;
    didAutoDescend.current = true;
    selectState(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateParam, chosen, ground]);

  const tween = useCallback((target: ViewBox, duration: number, onDone?: () => void) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const apply = (vb: ViewBox) => {
      vbRef.current = vb;
      setViewBox(vb);
    };
    if (prefersReducedMotion()) {
      apply(target);
      onDone?.();
      return;
    }
    const from = { ...vbRef.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = easeOutCubic(t);
      apply({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        onDone?.();
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const surface = useCallback(() => {
    setDescended(false);
    setSelected(null);
    setDossier(null);
    setStorms(null);
    tween(FULL_VIEW, SURFACE_MS);
  }, [tween]);

  // Esc surfaces back out — leaving is a first-class gesture.
  useEffect(() => {
    if (!descended) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") surface();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [descended, surface]);

  async function selectState(abbr: string) {
    if (!STATE_GEO[abbr]) return;
    setSelected(abbr);
    setDossier(null);
    setStorms(null);
    setLoading(true);
    setDescended(true);
    tween(frameForState(abbr), DESCEND_MS);
    // On phones the sentence + dossier stack below the map — keep the map (and
    // the fall) in view, with the sentence landing right under it.
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      requestAnimationFrame(() => mapCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    const c = STATE_CENTROIDS[abbr]; // [lng, lat]
    getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-storms?state=${abbr}`)
      .then((raw) => setStorms(parseStorms(raw)))
      .catch(() => setStorms(null));
    try {
      const [spot, sol] = await Promise.all([
        getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-spot?state=${abbr}${dateParam ? `&date=${dateParam}` : ""}`),
        c ? getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-solunar?lat=${c[1]}&lng=${c[0]}`) : Promise.resolve({}),
      ]);
      setDossier(toSpotData(spot, sol, abbr));
      // Gate-3 §0: a dated visit (?date=) whose dossier actually landed is a
      // completed date lookup. The Born flow renders here — its handoff
      // marker attributes the completion to door:'born', else 'atlas'.
      if (dateParam) {
        trackDateLookup(consumeBornDoor() ? "born" : "atlas");
      }
    } catch {
      setDossier(null);
    } finally {
      setLoading(false);
    }
  }

  // --- pointer plumbing: the state polygons ARE the targets ---
  const clientToProj = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const vb = vbRef.current;
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  };

  const hitAt = (clientX: number, clientY: number): string | null => {
    const p = clientToProj(clientX, clientY);
    if (!p) return null;
    // tap forgiveness ~2.5% of the visible width (small coastal states)
    return hitState(p.x, p.y, vbRef.current.w * 0.025);
  };

  function activate(abbr: string | null) {
    if (descended) {
      // Tapping anywhere but the state you're in surfaces.
      if (abbr !== selected) surface();
      return;
    }
    if (abbr) selectState(abbr);
  }

  // Activate on pointerup, not click: on touch the synthetic click is generated
  // only after the emulated hover pass and is intermittently swallowed on the
  // FIRST tap. pointerdown/up fire on the very first touch; the movement guard
  // keeps a scroll-drag from counting as a tap.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    tapStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const s = tapStart.current;
    tapStart.current = null;
    if (!s) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) return;
    activate(hitAt(e.clientX, e.clientY));
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    setHovered(hitAt(e.clientX, e.clientY));
  };

  const reduceMotion = prefersReducedMotion();

  // --- the composed sentence (only meaningful while descended) ---
  const stateName = selected ? STATE_NAMES[selected] ?? selected : "";
  const reading = selected ? readings[selected] : undefined;
  const monthName = FULL_MONTHS[new Date().getMonth()];
  let sentenceLead = "";
  let sentenceTail = "";
  if (selected) {
    if (!readingsLoaded) {
      sentenceLead = `${stateName} — reading the ground…`;
    } else if (reading === undefined) {
      sentenceLead = `${stateName} has no temperature reading on file today.`;
    } else {
      sentenceLead = `${stateName} ${magnitudeClause(reading.z)}`;
      sentenceTail = ` — ${sigmaStr(reading.z)} against its own ${
        reading.years ? `${reading.years} ${monthName}s` : "record"
      }.`;
    }
  }

  // --- the recorded-storm caption, denominator mandatory ---
  const event = storms?.event ?? null;
  const nowYear = new Date().getFullYear();
  const fileYears = storms?.earliest_year ? Math.max(1, nowYear - storms.earliest_year) : null;
  const casualtyNote = event
    ? event.deaths > 0
      ? ` — ${event.deaths} dead`
      : event.injuries > 0
        ? ` — ${event.injuries} injured`
        : ""
    : "";
  const stormL1 = event
    ? `On this ground: ${event.event_type}${event.county ? `, ${titleCase(event.county)} County` : ""} — ${formatEventDate(event.date)}${casualtyNote}`
    : "";
  const stormL2 =
    storms && fileYears
      ? `1 of ${storms.total.toLocaleString()} recorded storms in this state's ${fileYears}-year file`
      : "";

  const hoveredName = hovered ? STATE_NAMES[hovered] ?? hovered : null;
  const hoveredReading = hovered ? readings[hovered] : undefined;

  return (
    <div className="min-h-screen w-full bg-gray-950 text-gray-100">
      <style>{`
        @keyframes atlas-stage-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .atlas-stage-in { animation: atlas-stage-in 450ms ease-out both; }
        @keyframes atlas-rise {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .atlas-dossier-enter { animation: atlas-rise 500ms ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .atlas-stage-in, .atlas-dossier-enter { animation: none; }
        }
      `}</style>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:pt-7">
        <InnerHeader
          title="THE ATLAS"
          subtitle="the ground you stand on, state by state · measured against each state's own record"
        />
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-10 lg:py-10">
        {/* The ground — and the camera */}
        <div className="lg:flex-1">
          <h1 className="font-display text-2xl font-medium text-gray-50 sm:text-3xl">The ground you stand on</h1>
          <p className="mt-1.5 max-w-md font-body text-sm leading-relaxed text-gray-400">
            Each state shaded by what it&rsquo;s doing today, measured against its own 76&nbsp;years.
            Tap one to fall in.
          </p>

          <div ref={mapCardRef} className="mt-5 scroll-mt-4 rounded-lg bg-gray-900/40 p-3 ring-1 ring-white/5">
            <div className="overflow-hidden rounded-md" style={{ background: "#0a0f14" }}>
              <svg
                ref={svgRef}
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                className="block w-full cursor-pointer"
                style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
                role="group"
                aria-label={
                  descended
                    ? `${stateName} — press Escape or tap outside to surface`
                    : "US map, states shaded by today's reading — pick a state"
                }
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerMove={onPointerMove}
                onPointerLeave={() => setHovered(null)}
              >
                {Object.values(STATE_GEO).map((geo) => {
                  const z = readings[geo.abbr]?.z;
                  const isSel = selected === geo.abbr;
                  const isHov = hovered === geo.abbr && !descended;
                  const dimmed = descended && !isSel;
                  // The state you fell into always reads as present ground —
                  // a whisper of fill even when its reading is dead normal.
                  const tint = fillForZ(z);
                  const fill =
                    isSel && descended && tint === QUIET_FILL ? "rgba(255,255,255,0.045)" : tint;
                  return (
                    <path
                      key={geo.abbr}
                      d={geo.d}
                      fill={fill}
                      fillRule="evenodd"
                      stroke={
                        isSel && descended
                          ? "rgba(103,232,249,0.45)"
                          : isHov
                            ? "rgba(255,255,255,0.35)"
                            : "rgba(255,255,255,0.08)"
                      }
                      strokeWidth={isSel && descended ? 1.4 : 1.1}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                      tabIndex={0}
                      role="button"
                      aria-label={
                        dimmed
                          ? "surface back to the full map"
                          : `${STATE_NAMES[geo.abbr] ?? geo.abbr} — ${magnitudeWord(z)}`
                      }
                      style={{
                        opacity: dimmed ? 0.28 : 1,
                        transition: reduceMotion ? undefined : "opacity 600ms ease",
                        outline: "none",
                      }}
                      onFocus={() => setHovered(geo.abbr)}
                      onBlur={() => setHovered(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          activate(geo.abbr);
                        }
                      }}
                    />
                  );
                })}
              </svg>
            </div>

            {descended && selected ? (
              /* THE LANDING — the reading as a sentence, then one located memory */
              <div className="atlas-stage-in mt-3 px-1 pb-1">
                <p className="font-display text-lg leading-snug text-gray-50 sm:text-xl">
                  {sentenceLead}
                  {sentenceTail && <span className="text-gray-400">{sentenceTail}</span>}
                </p>
                {event && stormL1 && (
                  <button
                    type="button"
                    className="mt-2.5 block w-full cursor-pointer rounded-md py-0.5 text-left hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-cyan-300/50"
                    aria-label={`${stormL1} — open ${event.date}`}
                    onClick={() => navigate(`/date/${event.date}?state=${selected}`)}
                  >
                    <span className="block font-body text-[13px] leading-snug text-gray-300">{stormL1}.</span>
                    {stormL2 && (
                      <span className="mt-0.5 block font-mono text-[11px] leading-snug text-gray-500">
                        {stormL2}
                      </span>
                    )}
                  </button>
                )}
                <p className="mt-2 font-mono text-[10px] text-gray-600">esc or tap outside to surface</p>
              </div>
            ) : (
              <div className="mt-2 px-1">
                <p className="font-mono text-[10px] leading-relaxed text-gray-600">
                  <span className="text-amber-300/80">amber</span> running hot &middot;{" "}
                  <span className="text-sky-300/80">ice</span> running cold &middot; measured against each
                  state&rsquo;s own 76 years
                </p>
                <div className="mt-1 min-h-[1rem] font-mono text-[11px] text-gray-400">
                  {hoveredName ? (
                    <span>
                      <span className="text-gray-200">{hoveredName}</span> &middot;{" "}
                      {magnitudeWord(hoveredReading?.z)}
                      {hoveredReading !== undefined && (
                        <span className="text-gray-600"> &middot; {sigmaStr(hoveredReading.z)}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-600">hover a state &middot; tap to fall in</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* The spot dossier — lands as a consequence of the descent */}
        <div className="scroll-mt-4 lg:w-[380px] lg:flex-none">
          {!selected && (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg bg-gray-900/40 p-6 text-center text-sm text-gray-500 ring-1 ring-white/5">
              Pick a state to fall into it &mdash; what it&rsquo;s doing now, and the last time it looked like this.
            </div>
          )}
          {selected && loading && (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg bg-gray-900/40 p-6 font-mono text-xs text-gray-500 ring-1 ring-white/5">
              descending into {stateName || selected}&hellip;
            </div>
          )}
          {selected && !loading && dossier && (
            <div className="atlas-dossier-enter">
              <SpotDossier
                placeLabel={selected}
                data={dossier}
                datedVisit={!!dateParam}
                onRhymeClick={(day) => navigate(`/date/${day.date}?state=${selected}`)}
              />
            </div>
          )}
          {selected && !loading && !dossier && (
            <div className="rounded-lg bg-gray-900/40 p-6 text-sm text-gray-500 ring-1 ring-white/5">
              Couldn&rsquo;t read {selected} right now.
            </div>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-8">
        <InnerFooter current="atlas" />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TILE_GRID, CELL, PITCH, VIEW_W, VIEW_H } from "@/components/EventMap";
import { fetchStateAnomaly, colorForZ, QUIET_COLOR } from "@/lib/atlas/stateChoropleth";
import { STATE_CENTROIDS } from "@/data/atlas/stateCentroids";
import { STATE_NAMES, projectToTile } from "@/data/atlas/stateBBoxes";
import SpotDossier, { type SpotData } from "@/components/atlas/SpotDossier";
import { toSpotData } from "@/lib/atlas/spotDossierAdapter";
import { SUPABASE_FUNCTIONS_URL } from "@/lib/supabase";

/**
 * ATLAS — the ground you stand on (docs/THE-VISION-AND-ROADMAP.md).
 * NESTED BOXES, not a dot-scatter: the US as a calm grid of state boxes, each
 * shaded by what it's doing NOW (anomaly vs its own history).
 *
 * THE DESCENT (Double Fall plan, item 2): tapping a state no longer mounts a
 * card — it moves a CAMERA. The SVG viewBox rAF-tweens (ease-out cubic) into
 * the tapped tile while the other 49 states dim to 15%. The landing stage
 * carries the full state name in Playfair with its anomaly z engraved
 * quietly; the dossier lands as a consequence. Esc or tapping the dimmed
 * periphery surfaces back out. prefers-reduced-motion: instant cut.
 *
 * THE SONAR RING: when the camera lands, one silent pulse blooms at a real
 * historical storm event inside the state (hunt-atlas-storms — read-only over
 * the 1.5M-row storm-event archive), anchored by a dashed leader to one dated
 * sentence with the denominator. The tile is an abbreviation box, so the
 * event's lat/lng is placed PROPORTIONALLY via the state's bbox — a located
 * memory at state altitude, and labeled as such.
 *
 * Reliable SVG (no WebGL). Read-only. The hunter operates it; the kid
 * marvels at it.
 */
const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } });
  return res.json();
}

function anomalyPhrase(z: number | undefined): string {
  if (z === undefined) return "no reading here today";
  if (z >= 2) return `much warmer than normal (z +${z.toFixed(1)})`;
  if (z >= 1) return `warmer than normal (z +${z.toFixed(1)})`;
  if (z <= -2) return `much colder than normal (z ${z.toFixed(1)})`;
  if (z <= -1) return `colder than normal (z ${z.toFixed(1)})`;
  return `about normal (z ${z >= 0 ? "+" : ""}${z.toFixed(1)})`;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
interface ViewBox { x: number; y: number; w: number; h: number }

const FULL_VIEW: ViewBox = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
const DESCEND_MS = 700;
const SURFACE_MS = 550;
/** Landing frame: ~4 tiles wide, same aspect as the full view (no distortion). */
const FRAME_W = CELL * 4.2;
const FRAME_H = FRAME_W * (VIEW_H / VIEW_W);

function frameForTile(col: number, row: number): ViewBox {
  const cx = col * PITCH + CELL / 2;
  const cy = row * PITCH + CELL / 2;
  // Tile rides the upper-center of the frame; the sonar sentence lives below.
  return { x: cx - FRAME_W / 2, y: cy - FRAME_H * 0.42, w: FRAME_W, h: FRAME_H };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------
// Sonar ring data (hunt-atlas-storms)
// ---------------------------------------------------------------------------
interface StormEvent {
  date: string;
  event_type: string;
  county: string | null;
  deaths: number;
  injuries: number;
  lat: number | null;
  lng: number | null;
  located: "point" | "county";
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
            lat: typeof e.lat === "number" ? e.lat : null,
            lng: typeof e.lng === "number" ? e.lng : null,
            located: e.located === "point" ? "point" : "county",
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

export default function AtlasPage() {
  const [zByState, setZByState] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dossier, setDossier] = useState<SpotData | null>(null);
  const [loading, setLoading] = useState(false);
  const [storms, setStorms] = useState<StormInfo | null>(null);
  const navigate = useNavigate();
  const dossierRef = useRef<HTMLDivElement>(null);

  // Camera state. `descended` flips the grammar (dim periphery, stage text);
  // `landed` gates the sonar ring so the pulse blooms as the camera arrives.
  const [viewBox, setViewBox] = useState<ViewBox>(FULL_VIEW);
  const [descended, setDescended] = useState(false);
  const [landed, setLanded] = useState(false);
  const vbRef = useRef<ViewBox>(FULL_VIEW);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fetchStateAnomaly().then(setZByState).catch(() => setZByState({}));
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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

  const descend = useCallback(
    (abbr: string) => {
      const cell = TILE_GRID[abbr];
      if (!cell) return;
      setDescended(true);
      setLanded(false);
      tween(frameForTile(cell[0], cell[1]), DESCEND_MS, () => setLanded(true));
    },
    [tween],
  );

  const surface = useCallback(() => {
    setDescended(false);
    setLanded(false);
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
    setSelected(abbr);
    setDossier(null);
    setStorms(null);
    setLoading(true);
    descend(abbr);
    // On phones the dossier stacks below the grid — bring it into view on tap.
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      requestAnimationFrame(() => dossierRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    const c = STATE_CENTROIDS[abbr]; // [lng, lat]
    getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-storms?state=${abbr}`)
      .then((raw) => setStorms(parseStorms(raw)))
      .catch(() => setStorms(null));
    try {
      const [spot, sol] = await Promise.all([
        getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-spot?state=${abbr}`),
        c ? getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-solunar?lat=${c[1]}&lng=${c[0]}`) : Promise.resolve({}),
      ]);
      setDossier(toSpotData(spot, sol, abbr));
    } catch {
      setDossier(null);
    } finally {
      setLoading(false);
    }
  }

  function onTileActivate(abbr: string) {
    if (descended) {
      // Tapping the dimmed periphery (any tile but the one you're in) surfaces.
      if (abbr !== selected) surface();
      return;
    }
    selectState(abbr);
  }

  const readout = hovered ?? selected;
  const readoutZ = readout ? zByState[readout] : undefined;
  const reduceMotion = prefersReducedMotion();

  // --- stage geometry (only meaningful while descended) ---
  const selCell = selected ? TILE_GRID[selected] : undefined;
  const tileX = selCell ? selCell[0] * PITCH : 0;
  const tileY = selCell ? selCell[1] * PITCH : 0;
  const tileCx = tileX + CELL / 2;
  const stateName = selected ? STATE_NAMES[selected] ?? selected : "";
  const selectedZ = selected ? zByState[selected] : undefined;

  // --- sonar ring placement + sentence ---
  const event = storms?.event ?? null;
  let ringX: number | null = null;
  let ringY: number | null = null;
  if (selected && event) {
    if (event.lat !== null && event.lng !== null) {
      const pt = projectToTile(selected, event.lat, event.lng, tileX, tileY, CELL);
      if (pt) {
        ringX = pt.x;
        ringY = pt.y;
      }
    }
    if (ringX === null || ringY === null) {
      // County-scale record with no coordinate: the ring rests at box center.
      ringX = tileCx;
      ringY = tileY + CELL / 2;
    }
  }

  const nowYear = new Date().getFullYear();
  const fileYears = storms?.earliest_year ? Math.max(1, nowYear - storms.earliest_year) : null;
  const casualtyNote = event
    ? event.deaths > 0
      ? ` — ${event.deaths} dead`
      : event.injuries > 0
        ? ` — ${event.injuries} injured`
        : ""
    : "";
  const sentenceL1 = event
    ? `${formatEventDate(event.date)} — ${event.event_type}${event.county ? `, ${titleCase(event.county)} County` : ""}${casualtyNote}`
    : "";
  const sentenceL2 =
    storms && fileYears
      ? `1 of ${storms.total.toLocaleString()} recorded storms in this state's ${fileYears}-year file`
      : "";
  const sentenceL3 = event
    ? event.located === "point"
      ? "ring placed by recorded coordinate — approximate at this altitude"
      : "located to county — ring rests at box center"
    : "";
  const sentenceY = tileY + CELL + 3.4;

  return (
    <div className="min-h-screen w-full bg-gray-950 text-gray-100">
      {/* The sonar pulse + dossier landing. Scoped to this page; media query keeps reduced-motion silent. */}
      <style>{`
        @keyframes atlas-sonar {
          0% { transform: scale(0.1); opacity: 0.85; }
          55% { transform: scale(1); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        .atlas-sonar-ring {
          transform-box: fill-box;
          transform-origin: center;
          animation: atlas-sonar 6s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
        }
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
          .atlas-sonar-ring { animation: none; opacity: 0.45; transform: scale(0.55); }
          .atlas-stage-in, .atlas-dossier-enter { animation: none; }
        }
      `}</style>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-10 lg:py-10">
        {/* The map of boxes — and the camera */}
        <div className="lg:flex-1">
          <div className="mb-1 font-mono text-[11px] tracking-[0.24em] text-cyan-300/90">DUCK COUNTDOWN</div>
          <h1 className="text-2xl font-semibold text-gray-100">The ground you stand on</h1>
          <p className="mt-1 max-w-md text-sm text-gray-400">
            Each state shaded by what it&rsquo;s doing today, measured against its own 76&nbsp;years.
            Tap one to fall in.
          </p>

          <div className="mt-5 rounded-lg bg-gray-900/40 p-3 ring-1 ring-white/5">
            <svg
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
              className="w-full"
              role="group"
              aria-label={
                descended
                  ? `${stateName} — press Escape or tap outside to surface`
                  : "US states shaded by today's anomaly — pick a state"
              }
            >
              {/* Dimmed-periphery catcher: tapping empty space while descended surfaces. */}
              {descended && (
                <rect
                  x={viewBox.x - VIEW_W}
                  y={viewBox.y - VIEW_H}
                  width={VIEW_W * 3}
                  height={VIEW_H * 3}
                  fill="transparent"
                  onClick={surface}
                />
              )}
              {Object.entries(TILE_GRID).map(([abbr, [col, row]]) => {
                const z = zByState[abbr];
                const fill = z !== undefined ? colorForZ(z, "dark") : QUIET_COLOR.dark;
                const isSel = selected === abbr;
                const isHov = hovered === abbr;
                const dimmed = descended && !isSel;
                return (
                  <g
                    key={abbr}
                    className="cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-label={
                      dimmed ? `surface back to the full map` : `${abbr} — ${anomalyPhrase(z)}`
                    }
                    style={{
                      opacity: dimmed ? 0.15 : 1,
                      transition: reduceMotion ? undefined : "opacity 650ms ease",
                    }}
                    onMouseEnter={() => setHovered(abbr)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => onTileActivate(abbr)}
                    onFocus={() => setHovered(abbr)}
                    onBlur={() => setHovered(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onTileActivate(abbr);
                      }
                    }}
                  >
                    <rect
                      x={col * PITCH}
                      y={row * PITCH}
                      width={CELL}
                      height={CELL}
                      rx={1.4}
                      fill={fill}
                      stroke={
                        isSel
                          ? descended
                            ? "rgba(103,232,249,0.55)"
                            : "#67e8f9"
                          : isHov
                            ? "rgba(255,255,255,0.45)"
                            : "rgba(255,255,255,0.06)"
                      }
                      strokeWidth={isSel ? (descended ? 0.22 : 0.7) : isHov ? 0.5 : 0.3}
                    />
                    {/* The abbreviation yields the stage to the full name while descended. */}
                    {!(isSel && descended) && (
                      <text
                        x={col * PITCH + CELL / 2}
                        y={row * PITCH + CELL / 2 + 1.6}
                        textAnchor="middle"
                        fontSize={3.4}
                        fontFamily="ui-monospace, monospace"
                        fill="rgba(255,255,255,0.75)"
                        pointerEvents="none"
                      >
                        {abbr}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* THE LANDING STAGE — name in Playfair, z engraved, the sonar ring */}
              {descended && selected && selCell && (
                <g className="atlas-stage-in" pointerEvents="none">
                  <text
                    x={tileCx}
                    y={tileY - 2.1}
                    textAnchor="middle"
                    fontSize={3}
                    fontFamily="'Playfair Display', Georgia, serif"
                    fill="#f3f4f6"
                  >
                    {stateName}
                  </text>
                  <text
                    x={tileCx}
                    y={tileY + CELL / 2 + 0.7}
                    textAnchor="middle"
                    fontSize={2}
                    fontFamily="ui-monospace, monospace"
                    fill="rgba(255,255,255,0.30)"
                  >
                    {selectedZ !== undefined
                      ? `z ${selectedZ >= 0 ? "+" : ""}${selectedZ.toFixed(1)}`
                      : "no reading today"}
                  </text>
                </g>
              )}

              {/* THE SONAR RING — one silent pulse at a located memory, then a slow repeat */}
              {landed && selected && event && ringX !== null && ringY !== null && (
                <g className="atlas-stage-in">
                  <g pointerEvents="none">
                    <circle cx={ringX} cy={ringY} r={0.3} fill="#67e8f9" opacity={0.85} />
                    <circle
                      cx={ringX}
                      cy={ringY}
                      r={3.1}
                      fill="none"
                      stroke="#67e8f9"
                      strokeWidth={0.16}
                      className="atlas-sonar-ring"
                    />
                    <line
                      x1={ringX}
                      y1={ringY}
                      x2={tileCx}
                      y2={sentenceY - 1.6}
                      stroke="rgba(103,232,249,0.45)"
                      strokeWidth={0.1}
                      strokeDasharray="0.5 0.45"
                    />
                  </g>
                  {/* One dated sentence, denominator mandatory, click falls into the day. */}
                  <g
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer"
                    aria-label={`${sentenceL1} — open ${event.date}`}
                    onClick={() => navigate(`/date/${event.date}?state=${selected}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigate(`/date/${event.date}?state=${selected}`);
                    }}
                  >
                    <text
                      x={tileCx}
                      y={sentenceY}
                      textAnchor="middle"
                      fontSize={1.35}
                      fontFamily="ui-monospace, monospace"
                      fill="#e5e7eb"
                    >
                      {sentenceL1}
                    </text>
                    <text
                      x={tileCx}
                      y={sentenceY + 2}
                      textAnchor="middle"
                      fontSize={1.05}
                      fontFamily="ui-monospace, monospace"
                      fill="#9ca3af"
                    >
                      {sentenceL2}
                    </text>
                    <text
                      x={tileCx}
                      y={sentenceY + 3.7}
                      textAnchor="middle"
                      fontSize={0.92}
                      fontFamily="ui-monospace, monospace"
                      fill="#6b7280"
                    >
                      {sentenceL3}
                    </text>
                  </g>
                </g>
              )}
            </svg>
            <div className="mt-2 min-h-[1.25rem] font-mono text-[11px] text-gray-400">
              {descended && selected ? (
                <span>
                  <span className="text-gray-200">{stateName}</span> &middot; {anomalyPhrase(selectedZ)}{" "}
                  <span className="text-gray-600">&middot; esc or tap outside to surface</span>
                </span>
              ) : readout ? (
                <span>
                  <span className="text-gray-200">{readout}</span> &middot; {anomalyPhrase(readoutZ)}
                </span>
              ) : (
                <span className="text-gray-600">hover a state &middot; tap to fall in</span>
              )}
            </div>
          </div>
        </div>

        {/* The spot dossier — lands as a consequence of the descent */}
        <div ref={dossierRef} className="scroll-mt-4 lg:w-[380px] lg:flex-none">
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
    </div>
  );
}

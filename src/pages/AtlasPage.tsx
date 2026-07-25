import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { InnerHeader, InnerFooter } from "@/components/InnerNav";
import { STATE_GEO, STATE_GEO_LIST, STATE_VIEW, hitState } from "@/lib/atlas/stateGeo";
import {
  fetchFrames,
  fetchInstruments,
  isoDaysBefore,
  longDate,
  resolveDay,
  todayIso,
} from "@/lib/board/frameStore";
import {
  ABSENT_FILL,
  DEPTH_WITHHELD,
  TAIL_DEPTH_IS_COMPARABLE,
  depthClause,
  depthWord,
  fetchPoolYears,
  fillFor,
  freshnessNote,
  monthPlural,
  rarityClause,
  stateRarities,
  type StateRarity,
} from "@/lib/board/rarity";
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
 * board films use, shaded by the SAME number the front door's map and the
 * frequency card use — the packed tail-depth byte out of board_frames
 * (src/lib/board/rarity.ts). Amber running hot, ice running cold, quiet inside
 * a state's own middle half.
 *
 * WHICH MEANS IT INHERITED THE SAME DEFECT, and loses the same claim. Since
 * 2026-07-25 that byte is a live one-point centroid reading ranked against a
 * multi-station pool — two constructions, disagreeing about the shade band 43%
 * of the time. `TAIL_DEPTH_IS_COMPARABLE` is false and this page's shading, its
 * depth words and its percentile sentence are all withheld through the same
 * flag, with the reason on the page. The descent, the located memory and the
 * dossier — everything that is not a rank — are untouched.
 *
 * THE SOURCE CHANGED (2026-07-25). This page used to shade from
 * hunt-atlas-anomaly's z-scores. That is parametric where the card counts rank,
 * and it is a YEAR STALE — ghcn-daily stops 2025-12-31, so the function answers
 * a 2026-07-25 request with as_of_date 2025-07-25, and it had this page calling
 * New York "+1.7σ hot" on a day the frame store has New York at the very bottom
 * of its July record. One number, one meaning, or the surfaces lie to each other.
 *
 * THE DESCENT: tapping a state moves a CAMERA — the SVG viewBox rAF-tweens
 * (ease-out cubic) into the state's real geography while the other states dim.
 * Neighbors stay visible as map geography, not letter tiles. The reading lands
 * as a composed sentence under the map ("Maryland sits deep in its cold tail —
 * colder than 96% of its 72 Julys"). One recorded storm surfaces as a quiet
 * caption with its denominator; the dossier lands as a consequence. Esc or
 * tapping outside surfaces back out. prefers-reduced-motion: instant cut.
 *
 * Reliable SVG (no WebGL). Read-only. The hunter operates it; the kid marvels.
 */
const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

const VIEW_W = STATE_VIEW.width;
const VIEW_H = STATE_VIEW.height;

// A dossier fetch that cannot hang and cannot render a lie.
//
// Without the timeout, a socket that never settles leaves the panel on
// "descending into <state>…" forever — measured responses run 2–28s, which is
// already indistinguishable from dead. Without the res.ok check the failure is
// worse than a hang: every field of the adapter's response is optional, so a
// 400 or a 5xx with a JSON body parses happily into an all-null SpotData and
// renders an EMPTY card, bypassing the error branch entirely.
const DOSSIER_TIMEOUT_MS = 20000;

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
    signal: AbortSignal.timeout(DOSSIER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
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

/** The shaded day: which frame we actually read, and how fresh it was. */
interface GroundDay {
  day: string;
  day0Source: string | null;
  rarities: Map<string, StateRarity>;
  years: Map<string, number>;
}

export default function AtlasPage() {
  const [groundDay, setGroundDay] = useState<GroundDay | null>(null);
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
  const dossierReq = useRef(0);
  const vbRef = useRef<ViewBox>(FULL_VIEW);
  const rafRef = useRef<number | null>(null);

  // The shading, from the frame store — the SAME packed tail-depth byte the
  // front door's rarity map and the frequency card read. With ?date= we read
  // that exact day; without it we take the newest frame in the last four days,
  // and whatever day that turns out to be is the day this page names. It never
  // claims a currency the store does not have.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const target = dateParam ?? todayIso();
        const from = dateParam ?? isoDaysBefore(target, 3);
        const [instruments, frames] = await Promise.all([fetchInstruments(), fetchFrames(from, target)]);
        if (cancelled) return;
        const frame = frames[0]; // fetchFrames returns newest-first
        if (!frame || !instruments.length) {
          setReadingsLoaded(true);
          return;
        }
        const rarities = stateRarities(resolveDay(frame, instruments));
        setGroundDay({ day: frame.day, day0Source: frame.day0_source, rarities, years: new Map() });
        setReadingsLoaded(true);
        // The denominator rides in behind the shading; an empty map degrades
        // every clause to "its Julys on file", never to an invented year count.
        const years = await fetchPoolYears(frame.day);
        if (!cancelled) setGroundDay((g) => (g && g.day === frame.day ? { ...g, years } : g));
      } catch {
        if (!cancelled) setReadingsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [dateParam]);

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
    // Every state selection gets a token. Descents run 2–28s and a user can
    // click a second state while the first is still in flight — without this a
    // slow earlier response lands last and overwrites the newer state's dossier.
    const myReq = ++dossierReq.current;
    const isCurrent = () => dossierReq.current === myReq;

    const c = STATE_CENTROIDS[abbr]; // [lng, lat]
    getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-storms?state=${abbr}`)
      .then((raw) => { if (isCurrent()) setStorms(parseStorms(raw)); })
      .catch(() => { if (isCurrent()) setStorms(null); });
    try {
      // Solunar is pure math and returns in ~0.2s; the spot dossier is the slow
      // one. Start both together but never let solunar's failure sink the
      // dossier — it degrades to {} and SpotDossier renders every field nullable.
      const solP = c
        ? getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-solunar?lat=${c[1]}&lng=${c[0]}`).catch(() => ({}))
        : Promise.resolve({});
      const spot = await getJson(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-spot?state=${abbr}${dateParam ? `&date=${dateParam}` : ""}`);
      const sol = await solP;
      if (!isCurrent()) return;
      setDossier(toSpotData(spot, sol, abbr));
      // Gate-3 §0: a dated visit (?date=) whose dossier actually landed is a
      // completed date lookup. The Born flow renders here — its handoff
      // marker attributes the completion to door:'born', else 'atlas'.
      if (dateParam) {
        trackDateLookup(consumeBornDoor() ? "born" : "atlas");
      }
    } catch {
      // A timeout, a non-2xx, or a dead socket all land here and clear the
      // banner into the existing "Couldn't read {state} right now." card.
      if (isCurrent()) setDossier(null);
    } finally {
      // Only the newest selection may stop the spinner; a superseded one
      // clearing it would strand the current descent with no banner.
      if (isCurrent()) setLoading(false);
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
  const reading = selected ? groundDay?.rarities.get(selected) : undefined;
  const readDay = groundDay?.day ?? null;
  let sentenceLead = "";
  let sentenceTail = "";
  if (selected) {
    if (!readingsLoaded) {
      sentenceLead = `${stateName} — reading the ground…`;
    } else if (!readDay || reading === undefined || reading.depth === null) {
      sentenceLead = `${stateName} has no temperature reading on file${readDay ? ` for ${longDate(readDay)}` : ""}.`;
    } else if (!TAIL_DEPTH_IS_COMPARABLE) {
      // One sentence, not two halves of the same withholding.
      sentenceLead = `${stateName} has a reading on file for ${longDate(readDay)}.`;
      sentenceTail = ` Its place in that record is withheld until the day and the record are measured the same way.`;
    } else {
      sentenceLead = `${stateName} ${depthClause(reading)}`;
      sentenceTail = ` — ${rarityClause(reading, readDay, groundDay?.years.get(selected) ?? null)}.`;
    }
  }

  // The pool span, MEASURED. This page used to claim "76 years" for every
  // state; the pools are 72 deep for 49 of them and 76 only for Texas.
  const yearSpan = (() => {
    const vals = [...(groundDay?.years.values() ?? [])];
    if (!vals.length) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  })();
  const freshNote = freshnessNote(groundDay?.day0Source ?? null);

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
  const hoveredReading = hovered ? groundDay?.rarities.get(hovered) : undefined;

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
          subtitle={
            TAIL_DEPTH_IS_COMPARABLE
              ? "the ground you stand on, state by state · measured against each state's own record"
              : "the ground you stand on, state by state · what the record holds, and what it does not"
          }
        />
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-10 lg:py-10">
        {/* The ground — and the camera */}
        <div className="lg:flex-1">
          <h1 className="font-display text-2xl font-medium text-gray-50 sm:text-3xl">The ground you stand on</h1>
          <p className="mt-1.5 max-w-md font-body text-sm leading-relaxed text-gray-400">
            {TAIL_DEPTH_IS_COMPARABLE ? (
              <>
                Each state shaded by how far into its own record{" "}
                {dateParam ? "that day’s" : "today’s"} reading sits
                {yearSpan ? ` — against its own ${yearSpan} ${readDay ? monthPlural(readDay) : "years"}` : ""}.
                Tap one to fall in.
              </>
            ) : (
              <>
                Every state has a reading on file
                {yearSpan ? ` and a record ${yearSpan} ${readDay ? monthPlural(readDay) : "years"} deep` : ""}.
                Where the one sits in the other is withheld — the two are not measured the same way.
                Tap a state to fall in; what it holds is still there.
              </>
            )}
          </p>
          {readDay && (
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-gray-600">
              reading of {longDate(readDay)}
              {freshNote && <span> &middot; {freshNote}</span>}
            </p>
          )}

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
                    : TAIL_DEPTH_IS_COMPARABLE
                      ? "US map, states shaded by today's reading — pick a state"
                      : "US map — pick a state. The shading is withheld: today's reading and the record it would be ranked against are not the same measurement."
                }
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerMove={onPointerMove}
                onPointerLeave={() => setHovered(null)}
              >
                <defs>
                  {/* Absence is a hatch, never a colour on the ramp — a state
                      the archive is silent about must not read as "normal". */}
                  <pattern
                    id="atlas-absent"
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="8" height="8" fill={ABSENT_FILL} />
                    <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
                  </pattern>
                </defs>
                {STATE_GEO_LIST.map((geo) => {
                  const r = groundDay?.rarities.get(geo.abbr);
                  const isSel = selected === geo.abbr;
                  const isHov = hovered === geo.abbr && !descended;
                  const dimmed = descended && !isSel;
                  const tint = fillFor(r);
                  return (
                    <path
                      key={geo.abbr}
                      d={geo.d}
                      fill={tint ?? "url(#atlas-absent)"}
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
                          : `${STATE_NAMES[geo.abbr] ?? geo.abbr} — ${depthWord(r)}`
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
                {TAIL_DEPTH_IS_COMPARABLE ? (
                  <p className="font-mono text-[10px] leading-relaxed text-gray-600">
                    <span className="text-amber-300/80">amber</span> running hot &middot;{" "}
                    <span className="text-sky-300/80">ice</span> running cold &middot; deeper shade =
                    further into that state&rsquo;s own tail &middot; hatched = no reading on file
                  </p>
                ) : (
                  /* THE GATE (src/lib/board/tailDepthGate.ts). This page shades
                     from the SAME byte the front door did, so it inherited the
                     same defect and loses the same claim. Flat = a reading is on
                     file and we are not ranking it; hatched = no reading at all.
                     The two are different facts and must not look alike. */
                  <p className="font-mono text-[10px] leading-relaxed text-gray-600">
                    flat = a reading is on file, unranked &middot; hatched = no reading on file
                    &middot; the shade is withheld until the day and the record are measured the same
                    way
                  </p>
                )}
                <div className="mt-1 min-h-[1rem] font-mono text-[11px] text-gray-400">
                  {hoveredName ? (
                    <span>
                      <span className="text-gray-200">{hoveredName}</span> &middot;{" "}
                      {depthWord(hoveredReading)}
                      {readDay && hoveredReading?.depth != null && (
                        <span className="text-gray-600">
                          {" "}
                          &middot;{" "}
                          {rarityClause(hoveredReading, readDay, groundDay?.years.get(hovered) ?? null)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-600">hover a state &middot; tap to fall in</span>
                  )}
                </div>
              </div>
            )}

            {/* WHY THE SHADE IS GONE — the same copy deck the front door reads
                from, so the two pages cannot drift into different reasons. */}
            {!TAIL_DEPTH_IS_COMPARABLE && (
              <details className="mt-3 rounded-md border border-white/10 bg-gray-900/40 px-3 py-2 open:bg-gray-900/60">
                <summary className="cursor-pointer list-none font-mono text-[10px] tracking-wide text-gray-400 transition-colors hover:text-cyan-200">
                  {DEPTH_WITHHELD.summary} <span className="text-cyan-400/70">&rarr;</span>
                </summary>
                <div className="mt-2 space-y-2 font-body text-[12px] leading-relaxed text-gray-400">
                  {DEPTH_WITHHELD.body.map((p) => (
                    <p key={p.slice(0, 24)}>{p}</p>
                  ))}
                </div>
              </details>
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

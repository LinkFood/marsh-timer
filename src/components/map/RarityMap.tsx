import { useEffect, useMemo, useRef, useState } from "react";
import { STATE_GEO_LIST, STATE_VIEW, hitState } from "@/lib/atlas/stateGeo";
import { isGroundState } from "@/hooks/useYourGround";
// stateFullName, not stateBBoxes' STATE_NAMES: that module derives its lookup
// from the 60 KB usStates.geojson, and `/` is the one EAGER route — a name map
// must not drag the source GeoJSON into the front door's first paint.
import {
  longDate,
  stateFullName,
  type FormationWatch,
  type ResolvedInstrument,
  type StateAlert,
} from "@/lib/board/frameStore";
import {
  ABSENT_FILL,
  DEPTH_WITHHELD,
  RARITY_LEGEND,
  TAIL_DEPTH_IS_COMPARABLE,
  bandOf,
  depthWord,
  fetchPoolYears,
  fillFor,
  freshnessNote,
  monthPlural,
  rarityClause,
  stateRarities,
  type StateRarity,
} from "@/lib/board/rarity";
import {
  LIVE_LEGEND,
  busiestFirst,
  liveClause,
  liveFill,
  liveStates,
  liveWord,
  type LiveState,
} from "@/lib/board/liveGround";

/**
 * THE COUNTRY MAP — the front door's index.
 *
 * Its job never changes and is not up for negotiation: it is the country, it is
 * tappable, and a state is a door to its card at /season?state=XX. Touch, mouse
 * and keyboard all reach every state, including the ones that render at 5x6 px
 * on a phone.
 *
 * WHAT IT SHADES BY IS GATED. `TAIL_DEPTH_IS_COMPARABLE` (see
 * src/lib/board/tailDepthGate.ts) decides between two constructions:
 *
 *   TRUE  — the original: each state by its own tail depth, the packed byte out
 *           of board_frames, direction by hue and depth by intensity. This is
 *           the map we want and the code for it is intact below.
 *   FALSE — today: each state by what is LIVE on it, out of hunt_nws_alerts and
 *           formation_watches. Not a comparison, so nothing has to match a 1954
 *           measurement for it to be true.
 *
 * It stays a CHOROPLETH under either. That join is by state abbreviation, which
 * is why the dot-registration defect in board_instruments.albers_x/y cannot bite
 * here: a shade filling a polygon never places a point.
 *
 * Absence is drawn, never implied. Under the depth construction a state with no
 * byte hatches. Under the live construction a state with nothing on it gets its
 * own flat fill and the words "nothing live" — that is a fact about the state,
 * not a gap in the data — and the hatch is reserved for the one real gap, which
 * is the live lanes failing to answer at all.
 */

const VIEW_W = STATE_VIEW.width;
const VIEW_H = STATE_VIEW.height;

/** How many states get a tappable chip under the map. */
const LEADER_COUNT = 6;

interface RarityMapProps {
  /** One resolved frame — the same array the porch and the board already hold. */
  resolved: ResolvedInstrument[];
  /** The frame's OWN day. Rendered verbatim; never swapped for "today". */
  day: string;
  /** hunt-frame-daily's freshness label for that frame. */
  day0Source: string | null;
  /** Live severe/extreme NWS products by state. `null` = the lane did not answer. */
  alerts: Map<string, StateAlert> | null;
  /** Open formation watches. `null` = the lane did not answer. */
  watches: FormationWatch[] | null;
  /** Where a state goes. The card is another agent's component — we link, never inline. */
  onPick: (abbr: string) => void;
}

export default function RarityMap({ resolved, day, day0Source, alerts, watches, onPick }: RarityMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tapStart = useRef<{ x: number; y: number } | null>(null);

  // Both constructions are computed cheaply; only one of them speaks.
  const rarities = useMemo(() => stateRarities(resolved), [resolved]);
  const live = useMemo(
    () => liveStates(alerts ?? new Map(), watches ?? []),
    [alerts, watches],
  );
  /** The live lanes could not be read — not the same as "nothing is standing". */
  const lanesDark = alerts === null && watches === null;

  // --- pointer plumbing: the state polygons ARE the targets (lifted from /atlas) ---
  const hitAt = (clientX: number, clientY: number): string | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((clientY - rect.top) / rect.height) * VIEW_H;
    // tap forgiveness ~2.5% of the width — small coastal states at 375px
    return hitState(x, y, VIEW_W * 0.025);
  };

  /** A state with no ground of its own (DC) reads, but is not a door. */
  const activate = (abbr: string | null) => {
    if (!abbr) return;
    setHovered(abbr);
    if (isGroundState(abbr)) onPick(abbr);
  };

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

  const readName = (abbr: string) => stateFullName(abbr);

  return TAIL_DEPTH_IS_COMPARABLE ? (
    <DepthMap
      rarities={rarities}
      day={day}
      day0Source={day0Source}
      hovered={hovered}
      setHovered={setHovered}
      svgRef={svgRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      activate={activate}
      onPick={onPick}
      readName={readName}
    />
  ) : (
    <LiveMap
      live={live}
      lanesDark={lanesDark}
      hovered={hovered}
      setHovered={setHovered}
      svgRef={svgRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      activate={activate}
      onPick={onPick}
      readName={readName}
    />
  );
}

// ── shared chrome ─────────────────────────────────────────────────────────────

interface StageProps {
  hovered: string | null;
  setHovered: (a: string | null) => void;
  svgRef: React.RefObject<SVGSVGElement>;
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  activate: (abbr: string | null) => void;
  onPick: (abbr: string) => void;
  readName: (abbr: string) => string;
}

/**
 * The ground itself. Every state path is focusable with a real aria-label and
 * Enter/Space, the same idiom /atlas uses — a choropleth whose only handle is a
 * pointer is unusable to a keyboard and unreliable on a 5 px Rhode Island.
 */
function Ground({
  fillOf,
  labelOf,
  patternId,
  hovered,
  setHovered,
  svgRef,
  onPointerDown,
  onPointerUp,
  onPointerMove,
  activate,
  ariaLabel,
}: StageProps & {
  fillOf: (abbr: string) => string | null;
  labelOf: (abbr: string) => string;
  patternId: string;
  ariaLabel: string;
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl" style={{ background: "#0a0f14" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block w-full cursor-pointer touch-none select-none"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        role="group"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
      >
        <defs>
          {/* Absence is a hatch, never a colour on the ramp. */}
          <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill={ABSENT_FILL} />
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
          </pattern>
        </defs>
        {STATE_GEO_LIST.map((geo) => {
          const isHov = hovered === geo.abbr;
          return (
            <path
              key={geo.abbr}
              d={geo.d}
              fill={fillOf(geo.abbr) ?? `url(#${patternId})`}
              fillRule="evenodd"
              stroke={isHov ? "rgba(103,232,249,0.85)" : "rgba(255,255,255,0.16)"}
              strokeWidth={isHov ? 1.8 : 0.9}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
              tabIndex={0}
              role="button"
              aria-label={labelOf(geo.abbr)}
              style={{ outline: "none" }}
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
  );
}

/** The tappable chips: the only touch and keyboard path a 5 px state has. */
function Chips({
  title,
  items,
  onPick,
  readName,
  setHovered,
}: {
  title: string;
  items: { abbr: string; word: string; fill: string | undefined }[];
  onPick: (abbr: string) => void;
  readName: (abbr: string) => string;
  setHovered: (a: string | null) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <p className="font-mono text-[10px] tracking-[0.22em] text-gray-500">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((it) => (
          <button
            key={it.abbr}
            type="button"
            onClick={() => onPick(it.abbr)}
            onMouseEnter={() => setHovered(it.abbr)}
            onMouseLeave={() => setHovered(null)}
            className="rounded-full border border-white/10 bg-gray-900/50 px-3 py-1.5 text-left font-mono text-[11px] text-gray-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-100"
          >
            <span className="text-gray-100">{readName(it.abbr)}</span>
            <span className="text-gray-500"> &middot; </span>
            <span style={{ color: it.fill }}>{it.word}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── the live construction (what ships while the gate is closed) ───────────────

function LiveMap(
  props: StageProps & { live: Map<string, LiveState>; lanesDark: boolean },
) {
  const { live, lanesDark, hovered, setHovered, onPick, readName } = props;

  const leaders = useMemo(() => busiestFirst(live, LEADER_COUNT), [live]);
  const standing = useMemo(() => [...live.values()].filter((s) => s.band > 0).length, [live]);

  const fillOf = (abbr: string): string | null => (lanesDark ? null : liveFill(live.get(abbr)));
  const labelOf = (abbr: string) =>
    lanesDark
      ? `${readName(abbr)} — the live lanes could not be read`
      : `${readName(abbr)} — ${liveWord(live.get(abbr))}. Open its card.`;

  const hoveredState = hovered ? live.get(hovered) : undefined;

  return (
    <div>
      <Ground
        {...props}
        fillOf={fillOf}
        labelOf={labelOf}
        patternId="live-absent"
        ariaLabel="What is standing on each state right now — live NWS products and open formation watches. Pick a state for its card."
      />

      {/* THE LABEL — what the shade means and where it came from. */}
      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-gray-500">
        {lanesDark ? (
          <>the live lanes did not answer &middot; nothing here is a reading of the country</>
        ) : (
          <>
            live NWS products at Severe or Extreme, unexpired &middot; open formation watches
            {standing > 0 && (
              <span className="text-gray-600">
                {" "}
                &middot; {standing} {standing === 1 ? "state has" : "states have"} something standing
              </span>
            )}
          </>
        )}
      </p>

      {/* THE READOUT — hover on a mouse, focus on a keyboard, last tap on a phone. */}
      <div className="mt-1.5 min-h-[2.5rem] font-body text-[13px] leading-snug text-gray-400">
        {hovered ? (
          <span>
            <span className="font-medium text-gray-100">{readName(hovered)}</span>{" "}
            <span className="text-gray-300">
              {lanesDark ? "— the live lanes could not be read" : liveClause(hoveredState)}
            </span>
          </span>
        ) : (
          <span className="text-gray-600">
            Tap a state to read its card &mdash; how often a day like this has happened there.
          </span>
        )}
      </div>

      {/* THE LEGEND — intensity is how much is standing; hue is the only
          direction a live product can honestly be read to point. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] text-gray-500">
        <span className="flex overflow-hidden rounded-sm ring-1 ring-white/10">
          {LIVE_LEGEND.map((s) => (
            <span key={s.label} title={s.label} className="block h-3 w-5" style={{ background: s.fill }} />
          ))}
        </span>
        <span className="text-gray-600">nothing live &rarr; an Extreme product</span>
        <span>
          <span className="text-amber-300/80">amber</span> heat &amp; fire products &middot;{" "}
          <span className="text-sky-300/80">ice</span> cold products &middot; slate says nothing about
          temperature
        </span>
      </div>

      <Chips
        title="WHAT IS STANDING NOW"
        items={leaders.map((s) => ({ abbr: s.abbr, word: liveWord(s), fill: liveFill(s) }))}
        onPick={onPick}
        readName={readName}
        setHovered={setHovered}
      />

      <WithheldNote />
    </div>
  );
}

/**
 * THE WITHHOLDING, on the page, in the product's voice. Absence is content: a
 * reader should leave knowing something he did not know, not find a hole where
 * a colour used to be. Collapsed by default so it costs one line on a phone and
 * opens to the whole argument on a tap.
 */
function WithheldNote() {
  return (
    <details className="mt-5 rounded-xl border border-white/10 bg-gray-900/30 px-4 py-3 open:bg-gray-900/50">
      <summary className="cursor-pointer list-none font-mono text-[11px] tracking-wide text-gray-400 transition-colors hover:text-cyan-200">
        {DEPTH_WITHHELD.summary} <span className="text-cyan-400/70">&rarr;</span>
      </summary>
      <div className="mt-3 space-y-3 font-body text-[13px] leading-relaxed text-gray-400">
        {DEPTH_WITHHELD.body.map((p) => (
          <p key={p.slice(0, 24)}>{p}</p>
        ))}
        <p className="border-t border-white/5 pt-3 text-gray-500">{DEPTH_WITHHELD.instead}</p>
      </div>
    </details>
  );
}

// ── the depth construction (intact; returns when the gate opens) ──────────────

function DepthMap(
  props: StageProps & { rarities: Map<string, StateRarity>; day: string; day0Source: string | null },
) {
  const { rarities, day, day0Source, hovered, setHovered, onPick, readName } = props;
  const [years, setYears] = useState<Map<string, number>>(new Map());

  // The denominator, measured per state — one bounded read with its own
  // cancelled flag and an honest-absence branch (the PlantPage idiom). A failure
  // leaves `years` empty and every clause degrades to "its Julys on file".
  useEffect(() => {
    let cancelled = false;
    setYears(new Map());
    fetchPoolYears(day).then((m) => {
      if (!cancelled) setYears(m);
    });
    return () => {
      cancelled = true;
    };
  }, [day]);

  // "its own 72 Julys" / "its own 72–76 Julys" — the real spread of the pools,
  // because they are NOT the same depth in every state.
  const yearSpan = useMemo(() => {
    const vals = [...years.values()];
    if (!vals.length) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  }, [years]);

  const leaders = useMemo(
    () =>
      [...rarities.values()]
        .filter((r): r is StateRarity & { depth: number } => r.depth !== null && (bandOf(r.depth) ?? 0) >= 2)
        .sort((a, b) => b.depth - a.depth)
        .slice(0, LEADER_COUNT),
    [rarities],
  );

  const fresh = freshnessNote(day0Source);
  const hoveredRarity = hovered ? rarities.get(hovered) : undefined;

  return (
    <div>
      <Ground
        {...props}
        fillOf={(abbr) => fillFor(rarities.get(abbr))}
        labelOf={(abbr) => `${readName(abbr)} — ${depthWord(rarities.get(abbr))}. Open its card.`}
        patternId="rarity-absent"
        ariaLabel={`How unusual each state is today against its own record — reading of ${longDate(day)}. Pick a state for its card.`}
      />

      {/* THE LABEL — what the shade means, over what record, as of what day. */}
      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-gray-500">
        each state against its own {yearSpan ? `${yearSpan} ` : ""}
        {monthPlural(day)} &middot; reading of {longDate(day)}
        {fresh && <span className="text-gray-600"> &middot; {fresh}</span>}
      </p>

      {/* THE READOUT — hover on a mouse, last tap on a phone. */}
      <div className="mt-1.5 min-h-[2.5rem] font-body text-[13px] leading-snug text-gray-400">
        {hovered ? (
          <span>
            <span className="font-medium text-gray-100">{readName(hovered)}</span>{" "}
            <span className="text-gray-300">
              {rarityClause(rarities.get(hovered), day, years.get(hovered) ?? null)}
            </span>
            {hoveredRarity?.depth !== null && hoveredRarity !== undefined && (
              <span className="block font-mono text-[11px] text-gray-600">{depthWord(hoveredRarity)}</span>
            )}
          </span>
        ) : (
          <span className="text-gray-600">
            Tap a state to read its card &mdash; how often a day like this has happened there.
          </span>
        )}
      </div>

      {/* THE LEGEND — direction is a hue, depth is an intensity, absence is a hatch. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] text-gray-500">
        <span className="text-sky-300/80">colder</span>
        <span className="flex overflow-hidden rounded-sm ring-1 ring-white/10">
          {RARITY_LEGEND.map((s) => (
            <span key={s.label} title={s.label} className="block h-3 w-5" style={{ background: s.fill }} />
          ))}
        </span>
        <span className="text-amber-300/80">hotter</span>
        <span className="text-gray-600">&middot; deeper shade = further into its own tail</span>
        <span className="flex items-center gap-1.5">
          <svg width="14" height="12" aria-hidden="true" className="block">
            <rect width="14" height="12" fill={ABSENT_FILL} />
            <path d="M-2 4 L6 -4 M-2 12 L10 0 M2 14 L14 2 M10 14 L18 6" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
          </svg>
          no reading on file
        </span>
      </div>

      <Chips
        title="DEEPEST GROUND TODAY"
        items={leaders.map((r) => ({ abbr: r.abbr, word: depthWord(r), fill: fillFor(r) ?? undefined }))}
        onPick={onPick}
        readName={readName}
        setHovered={setHovered}
      />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { STATE_GEO_LIST, STATE_VIEW, hitState } from "@/lib/atlas/stateGeo";
import { isGroundState } from "@/hooks/useYourGround";
// stateFullName, not stateBBoxes' STATE_NAMES: that module derives its lookup
// from the 60 KB usStates.geojson, and `/` is the one EAGER route — a name map
// must not drag the source GeoJSON into the front door's first paint.
import { longDate, stateFullName, type ResolvedInstrument } from "@/lib/board/frameStore";
import {
  ABSENT_FILL,
  RARITY_LEGEND,
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

/**
 * THE RARITY MAP — the front door's index.
 *
 * Every weather map on the internet answers WHAT IS HAPPENING. This one answers
 * HOW UNUSUAL IS THIS, HERE, against this state's own record — the same question
 * the frequency card answers, drawn nationally. The map is the index; the card
 * is the product, so a state is a door: tap it and you land on its card.
 *
 * It is a CHOROPLETH, joined to the archive by state abbreviation. That join is
 * why it can exist today: the dots in board_instruments.albers_x/y and these
 * border rings were baked with different Albers fits and do not register, but a
 * shade filling a polygon never places a point, so the defect cannot bite here.
 *
 * The shade is one number with one meaning — the packed tail-depth byte out of
 * board_frames, direction by hue (ice cold / amber hot), depth by intensity. A
 * state with no byte on file is drawn as an explicit hatch, never as "normal".
 */

const VIEW_W = STATE_VIEW.width;
const VIEW_H = STATE_VIEW.height;

/** How many of the deepest states get a tappable chip under the map. */
const LEADER_COUNT = 5;

interface RarityMapProps {
  /** One resolved frame — the same array the porch and the board already hold. */
  resolved: ResolvedInstrument[];
  /** The frame's OWN day. Rendered verbatim; never swapped for "today". */
  day: string;
  /** hunt-frame-daily's freshness label for that frame. */
  day0Source: string | null;
  /** Where a state goes. The card is another agent's component — we link, never inline. */
  onPick: (abbr: string) => void;
}

export default function RarityMap({ resolved, day, day0Source, onPick }: RarityMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [years, setYears] = useState<Map<string, number>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);
  const tapStart = useRef<{ x: number; y: number } | null>(null);

  const rarities = useMemo(() => stateRarities(resolved), [resolved]);

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
  const readClause = (abbr: string) => rarityClause(rarities.get(abbr), day, years.get(abbr) ?? null);

  const hoveredRarity = hovered ? rarities.get(hovered) : undefined;
  const fresh = freshnessNote(day0Source);

  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-2xl" style={{ background: "#0a0f14" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block w-full cursor-pointer touch-none select-none"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
          role="group"
          aria-label={`How unusual each state is today against its own record — reading of ${longDate(day)}. Pick a state for its card.`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHovered(null)}
        >
          <defs>
            {/* Absence is a hatch, never a colour on the ramp. A state the
                archive is silent about must not be readable as "normal". */}
            <pattern id="rarity-absent" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" fill={ABSENT_FILL} />
              <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
            </pattern>
          </defs>
          {STATE_GEO_LIST.map((geo) => {
            const r = rarities.get(geo.abbr);
            const fill = fillFor(r);
            const isHov = hovered === geo.abbr;
            return (
              <path
                key={geo.abbr}
                d={geo.d}
                fill={fill ?? "url(#rarity-absent)"}
                fillRule="evenodd"
                stroke={isHov ? "rgba(103,232,249,0.85)" : "rgba(255,255,255,0.16)"}
                strokeWidth={isHov ? 1.8 : 0.9}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            );
          })}
        </svg>
      </div>

      {/* THE LABEL — what the shade means, over what record, as of what day.
          The frame's own date is printed verbatim; if the newest frame is not
          today's, this line says the real date rather than implying currency. */}
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
            <span className="text-gray-300">{readClause(hovered)}</span>
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

      {/* THE DEEPEST GROUND — real targets for touch and keyboard, and the one
          list a visitor actually wants: where today is most unusual. */}
      {leaders.length > 0 && (
        <div className="mt-4">
          <p className="font-mono text-[10px] tracking-[0.22em] text-gray-500">DEEPEST GROUND TODAY</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {leaders.map((r) => (
              <button
                key={r.abbr}
                type="button"
                onClick={() => onPick(r.abbr)}
                onMouseEnter={() => setHovered(r.abbr)}
                onMouseLeave={() => setHovered(null)}
                className="rounded-full border border-white/10 bg-gray-900/50 px-3 py-1.5 text-left font-mono text-[11px] text-gray-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-100"
              >
                <span className="text-gray-100">{readName(r.abbr)}</span>
                <span className="text-gray-500"> &middot; </span>
                <span style={{ color: fillFor(r) ?? undefined }}>{depthWord(r)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

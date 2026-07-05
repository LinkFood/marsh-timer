import { useEffect, useState } from "react";
import { TILE_GRID, CELL, PITCH, VIEW_W, VIEW_H } from "@/components/EventMap";
import { fetchStateAnomaly, colorForZ, QUIET_COLOR } from "@/lib/atlas/stateChoropleth";
import { STATE_CENTROIDS } from "@/data/atlas/stateCentroids";
import SpotDossier, { type SpotData } from "@/components/atlas/SpotDossier";
import { toSpotData } from "@/lib/atlas/spotDossierAdapter";
import { SUPABASE_FUNCTIONS_URL } from "@/lib/supabase";

/**
 * ATLAS — the ground you stand on (docs/THE-VISION-AND-ROADMAP.md).
 * NESTED BOXES, not a dot-scatter: the US as a calm grid of state boxes, each
 * shaded by what it's doing NOW (anomaly vs its own history). Click a box -> the
 * SPOT DOSSIER: that place's NOW (weather, moon, tide, solunar, front, shooting
 * light) + PAST (days like today, the rhyme). Reliable SVG (no WebGL). Read-only.
 * The hunter operates it; the kid marvels at it.
 */
const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } });
  return res.json();
}

function anomalyPhrase(z: number | undefined): string {
  if (z === undefined) return "typical — no reading today";
  if (z >= 2) return `much warmer than normal (z +${z.toFixed(1)})`;
  if (z >= 1) return `warmer than normal (z +${z.toFixed(1)})`;
  if (z <= -2) return `much colder than normal (z ${z.toFixed(1)})`;
  if (z <= -1) return `colder than normal (z ${z.toFixed(1)})`;
  return `about normal (z ${z >= 0 ? "+" : ""}${z.toFixed(1)})`;
}

export default function AtlasPage() {
  const [zByState, setZByState] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dossier, setDossier] = useState<SpotData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchStateAnomaly().then(setZByState).catch(() => setZByState({}));
  }, []);

  async function selectState(abbr: string) {
    setSelected(abbr);
    setDossier(null);
    setLoading(true);
    const c = STATE_CENTROIDS[abbr]; // [lng, lat]
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

  const readout = hovered ?? selected;
  const readoutZ = readout ? zByState[readout] : undefined;

  return (
    <div className="min-h-screen w-full bg-gray-950 text-gray-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-10 lg:py-10">
        {/* The map of boxes */}
        <div className="lg:flex-1">
          <div className="mb-1 font-mono text-[11px] tracking-[0.24em] text-cyan-300/90">DUCK COUNTDOWN</div>
          <h1 className="text-2xl font-semibold text-gray-100">The ground you stand on</h1>
          <p className="mt-1 max-w-md text-sm text-gray-400">
            Each state shaded by what it&rsquo;s doing today, measured against its own 76&nbsp;years.
            Tap one to see its now &amp; past.
          </p>

          <div className="mt-5 rounded-lg bg-gray-900/40 p-3 ring-1 ring-white/5">
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full" role="img" aria-label="US states shaded by today's anomaly">
              {Object.entries(TILE_GRID).map(([abbr, [col, row]]) => {
                const z = zByState[abbr];
                const fill = z !== undefined ? colorForZ(z, "dark") : QUIET_COLOR.dark;
                const isSel = selected === abbr;
                return (
                  <g
                    key={abbr}
                    className="cursor-pointer"
                    onMouseEnter={() => setHovered(abbr)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => selectState(abbr)}
                  >
                    <rect
                      x={col * PITCH}
                      y={row * PITCH}
                      width={CELL}
                      height={CELL}
                      rx={1.4}
                      fill={fill}
                      stroke={isSel ? "#67e8f9" : "rgba(255,255,255,0.06)"}
                      strokeWidth={isSel ? 0.7 : 0.3}
                    />
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
                  </g>
                );
              })}
            </svg>
            <div className="mt-2 min-h-[1.25rem] font-mono text-[11px] text-gray-400">
              {readout ? (
                <span>
                  <span className="text-gray-200">{readout}</span> &middot; {anomalyPhrase(readoutZ)}
                </span>
              ) : (
                <span className="text-gray-600">hover a state &middot; tap to open its dossier</span>
              )}
            </div>
          </div>
        </div>

        {/* The spot dossier */}
        <div className="lg:w-[380px] lg:flex-none">
          {!selected && (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg bg-gray-900/40 p-6 text-center text-sm text-gray-500 ring-1 ring-white/5">
              Pick a state to see what it&rsquo;s doing now &mdash; and the last time it looked like this.
            </div>
          )}
          {selected && loading && (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg bg-gray-900/40 p-6 font-mono text-xs text-gray-500 ring-1 ring-white/5">
              reading {selected}&rsquo;s now &amp; past&hellip;
            </div>
          )}
          {selected && !loading && dossier && (
            <SpotDossier placeLabel={selected} data={dossier} />
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

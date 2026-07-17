import { useMemo } from "react";
import { US_STATES } from "@/hooks/useYourGround";
import { fmtClock, fmtSpan, type GroundSky } from "@/lib/almanac";
import type { Instrument, ResolvedInstrument } from "@/lib/board/frameStore";

/**
 * THE FITTED BLOCK — the Left-Hand Page's your-ground panel (blueprint §2a).
 *
 * Every number arrives pre-fitted to the chosen ground (the 1950 key-letter
 * lesson): sun rise/set + day length, moonrise/phase/age + the next full
 * moon's traditional name, today's solunar feed windows, and — where the
 * board's roster holds a gauge — the state's tide reading against its own
 * recorded history. Each line carries its basis inline; where the roster is
 * silent the absence renders honestly (the flank nobody else serves).
 *
 * Compact by law: the block sits between the porch strip and the rhyme, and
 * the board must stay reachable on screen 1–1.5 (dc9ea79).
 */

/** "2:55–4:55a" / "11:20a–12:20p" — meridiem shown once when shared. */
function fmtWindow(startIso: string, endIso: string, tz: string): string {
  const s = fmtClock(startIso, tz);
  const e = fmtClock(endIso, tz);
  return s.slice(-1) === e.slice(-1) ? `${s.slice(0, -1)}–${e}` : `${s}–${e}`;
}

const PHASE_GLYPH: Record<string, string> = {
  "New Moon": "\u{1F311}",
  "Waxing Crescent": "\u{1F312}",
  "First Quarter": "\u{1F313}",
  "Waxing Gibbous": "\u{1F314}",
  "Full Moon": "\u{1F315}",
  "Waning Gibbous": "\u{1F316}",
  "Last Quarter": "\u{1F317}",
  "Waning Crescent": "\u{1F318}",
};

/** The flagship gauge per multi-gauge state (Baltimore holds hourly to 1902). */
const PRIMARY_GAUGE: Record<string, string> = { MD: "Baltimore", NY: "The Battery" };

/** The state a tide instrument stands in — from its "(MD)" sublabel. */
function tideState(inst: Instrument): string | null {
  const m = /\(([A-Z]{2})\)/.exec(inst.sublabel ?? "");
  return m ? m[1] : null;
}

interface TideLine {
  text: string;
  hasGauge: boolean;
}

function tideLineFor(ground: string, groundName: string, resolved: ResolvedInstrument[]): TideLine {
  const tides = resolved.filter((r) => r.inst.kind === "tide");
  const here = tides.filter((r) => tideState(r.inst) === ground);
  if (here.length === 0) {
    const states = [...new Set(tides.map((r) => tideState(r.inst)).filter(Boolean))] as string[];
    return {
      hasGauge: false,
      text: `no tide gauge on the roster for ${groundName} — ${tides.length} gauges stand (${states.join(" ")})`,
    };
  }
  const gauge =
    here.find((r) => r.inst.label === PRIMARY_GAUGE[ground] && r.hasData) ??
    here.find((r) => r.hasData) ??
    here[0];
  if (!gauge.hasData || gauge.pct === null) {
    return { hasGauge: true, text: `${gauge.label ?? gauge.inst.label} gauge — no reading on file today` };
  }
  const p = Math.round(gauge.pct * 100);
  const dir = gauge.side === "high" ? "higher" : "lower";
  return {
    hasGauge: true,
    text: `${gauge.inst.label} gauge running ${dir} than ${p}% of its recorded tides`,
  };
}

function Line({ children, chip }: { children: React.ReactNode; chip: string }) {
  return (
    <p className="font-mono text-[11px] leading-relaxed text-gray-400">
      {children}{" "}
      <span className="whitespace-nowrap text-[9px] text-gray-600">· {chip}</span>
    </p>
  );
}

export default function TodayFitted({
  ground,
  groundName,
  setGround,
  sky,
  resolved,
}: {
  ground: string;
  groundName: string;
  setGround: (abbr: string) => void;
  sky: GroundSky | null;
  resolved: ResolvedInstrument[];
}) {
  const tide = useMemo(() => tideLineFor(ground, groundName, resolved), [ground, groundName, resolved]);

  const glyph = sky?.moonPhase ? (PHASE_GLYPH[sky.moonPhase] ?? "☽") : "☽";

  return (
    <div className="mx-auto mt-5 max-w-xl rounded-lg border border-white/[0.07] bg-gray-900/25 px-4 py-3 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor="ground-select"
          className="font-mono text-[10px] tracking-[0.22em] text-gray-500"
        >
          YOUR GROUND
        </label>
        <select
          id="ground-select"
          value={ground}
          onChange={(e) => setGround(e.target.value)}
          className="max-w-[60%] cursor-pointer rounded border border-white/10 bg-gray-900 px-2 py-0.5 font-mono text-[11px] text-cyan-300/90 outline-none focus:border-cyan-300/40"
        >
          {US_STATES.map((s) => (
            <option key={s.abbr} value={s.abbr}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2.5 space-y-1">
        {sky?.sunrise && sky?.sunset && (
          <Line chip="computed · NOAA equations · state centroid">
            <span className="text-amber-200/80">☉</span>{" "}
            <span className="text-gray-200">
              {fmtClock(sky.sunrise, sky.tz)} &rarr; {fmtClock(sky.sunset, sky.tz)}
            </span>{" "}
            · {fmtSpan(sky.sunrise, sky.sunset)} of light
          </Line>
        )}
        {sky?.moonPhase && (
          <Line chip="computed · lunar theory">
            <span className="text-sky-200/80">{glyph}</span>{" "}
            {sky.moonrise && (
              <>
                rises <span className="text-gray-200">{fmtClock(sky.moonrise, sky.tz)}</span> ·{" "}
              </>
            )}
            {sky.moonPhase.toLowerCase()}
            {sky.moonIllum !== null && <>, {Math.round(sky.moonIllum)}% lit</>}
            {sky.moonAge !== null && <> · {sky.moonAge.toFixed(1)} days old</>}
            {sky.fullMoon && sky.fullMoon.days > 1 && (
              <>
                {" "}
                · full in {sky.fullMoon.days} days — the {sky.fullMoon.name}
              </>
            )}
            {sky.fullMoon && sky.fullMoon.days <= 1 && (
              <> · the {sky.fullMoon.name}, full {sky.fullMoon.days === 0 ? "tonight" : "tomorrow"}</>
            )}
          </Line>
        )}
        {sky && (sky.majors.length > 0 || sky.minors.length > 0) && (
          <Line chip="solunar model · moon transit at centroid">
            feed windows{" "}
            {sky.majors.length > 0 && (
              <>
                · majors{" "}
                <span className="text-gray-200">
                  {sky.majors.map((w) => fmtWindow(w.start, w.end, sky.tz)).join(" · ")}
                </span>
              </>
            )}
            {sky.minors.length > 0 && (
              <> · minors {sky.minors.map((w) => fmtWindow(w.start, w.end, sky.tz)).join(" · ")}</>
            )}
          </Line>
        )}
        {resolved.length > 0 && (
          <Line chip={tide.hasGauge ? "NOAA water-level · today's frame" : "honest absence"}>
            <span className="text-teal-200/80">≈</span> tide ·{" "}
            {tide.hasGauge ? <span className="text-gray-300">{tide.text}</span> : tide.text}
          </Line>
        )}
      </div>
    </div>
  );
}

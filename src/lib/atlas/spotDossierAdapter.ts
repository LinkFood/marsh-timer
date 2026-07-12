/**
 * spotDossierAdapter — maps the two read-only Atlas functions
 * (hunt-atlas-spot + hunt-atlas-solunar) onto the SpotDossier card's `SpotData`
 * prop. Pure data-shaping, no I/O. Honest about the archive's jagged resolution:
 * weather is state-level, tide is the nearest gauge, times are longitude-local.
 *
 * Times: the sun/solunar functions return ISO-8601 UTC. Solar events are inherently
 * longitude-based, so we render local clock time from the spot's longitude
 * (offset ≈ lng/15 h). This is honest for sunrise/sunset/feed windows; it does not
 * apply civil DST, so it can differ from wall-clock by up to an hour — acceptable
 * for a "shooting light is around X" readout, and labeled as solar-local.
 */
import type { SpotData } from "@/components/atlas/SpotDossier";

interface SolunarResp {
  moon?: { phase?: string; illum?: number; age?: number; days_to_full?: number } | null;
  sun?: {
    sunrise?: string; sunset?: string;
    shooting_light_start?: string; shooting_light_end?: string;
  } | null;
  solunar?: {
    major?: { start: string; end: string }[];
    minor?: { start: string; end: string }[];
    rating?: string; score?: number;
  } | null;
}

interface OnFileResp {
  type?: string;
  line?: string;
  scope?: string;
}

interface ThatDayResp {
  high?: number | null;
  anomaly_f?: number | null;
  tide_residual_ft?: number | null;
  tide_station?: string | null;
  moon_phase?: string | null;
}

interface LineupMatchResp {
  date?: string;
  that_day?: ThatDayResp | null;
  outcome?: string | null;
  on_file?: OnFileResp[] | null;
}

interface ThatDayResp2 {
  date?: string;
  weather?: {
    avg_high_f?: number; avg_low_f?: number; precip_in?: number;
    stations?: number; max_f?: number; min_f?: number; narrative?: string;
  } | null;
  events?: {
    title?: string; narrative?: string; deaths?: number; injuries?: number;
    damage_usd?: number; county?: string; began?: string; span_note?: string;
    provenance_url?: string;
  }[] | null;
  tide?: {
    station_name?: string; residual_max_ft?: number;
    residual_max_time_utc?: string; daily_max_ft?: number;
    residual_mean_ft?: number; daily_mean_ft?: number;
    basis?: string; provenance_url?: string;
  }[] | null;
  quakes?: {
    magnitude?: number; place?: string; event_time_utc?: string;
    depth_km?: number; felt?: number; provenance_url?: string;
  }[] | null;
  world?: { title?: string; content?: string }[] | null;
  era_note?: string | null;
  honest_note?: string | null;
}

interface SpotResp {
  spot?: { lat?: number; lng?: number; state?: string } | null;
  target_date?: string | null;
  /** WHAT THIS DAY WAS — recorded truth of the target date (may be absent). */
  that_day?: ThatDayResp2 | null;
  lineup?: {
    mode?: string;
    components?: string[];
    last_date?: string | null;
    n_matches?: number;
    n_years?: number;
    matches?: LineupMatchResp[] | null;
    today?: { tide_station?: string | null } | null;
    honest_note?: string | null;
  } | null;
  control?: {
    outcome?: string | null;
    matched_n?: number | null;
    matched_outcome_n?: number | null;
    all_n?: number | null;
    all_outcome_n?: number | null;
    reason?: string | null;
    note?: string | null;
  } | null;
  now?: {
    weather?: { avg_high_f?: number; avg_low_f?: number; precip_in?: number; label?: string } | null;
    front?: { signal?: string; temp_change_f?: number; drop_from_peak_f?: number; as_of?: string | null; note?: string } | null;
    tide?: { station_name?: string; state?: string; daily_mean_ft?: number; residual_ft?: number; is_local?: boolean; note?: string } | null;
    /** Recorded alerts on file for the ACTUAL today — never a forecast. */
    live?: { type?: string; title?: string; count?: number }[] | null;
    live_as_of?: string | null;
  } | null;
  past?: {
    anomaly?: { metric?: string; value?: number; baseline_mean?: number; z?: number | null; n_years?: number } | null;
    rhyme?: {
      date: string;
      high?: number;
      delta_f?: number;
      note?: string;
      outcome?: string | null;
      also_recorded?: string[] | null;
      on_file?: OnFileResp[] | null;
    }[] | null;
    /** "days that READ like today" — matched by meaning (voyage-512 cosine). */
    semantic_rhyme?: {
      matches?: {
        date?: string;
        similarity?: number | null;
        note?: string | null;
        outcome?: string | null;
      }[] | null;
      novel?: boolean;
      note?: string | null;
      n_searched?: number | null;
      method?: string | null;
      unavailable?: boolean;
      reason?: string | null;
    } | null;
  } | null;
}

/** Server on_file items + leftover also_recorded types → provenance chips (max 3). */
function toChips(onFile: OnFileResp[] | null | undefined, alsoRecorded?: string[] | null): { type: string; line: string; scope: string }[] {
  const chips = (onFile ?? [])
    .filter((f) => f.line)
    .map((f) => ({ type: f.type ?? "record", line: f.line as string, scope: f.scope ?? "here" }));
  const seenTypes = new Set(chips.map((c) => c.type));
  for (const t of alsoRecorded ?? []) {
    if (chips.length >= 3) break;
    if (seenTypes.has(t)) continue;
    chips.push({ type: t, line: t, scope: "here" });
    seenTypes.add(t);
  }
  return chips.slice(0, 3);
}

/** ISO-8601 UTC -> local "HH:MM" using a longitude-based solar offset. */
function utcToLocalHHMM(iso: string | undefined | null, lng: number | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Longitude gives standard-time offset from UTC; add US daylight saving in season
  // so sun/feed times read as wall clock (what a hunter checks).
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const isDST = (mo > 3 && mo < 11) || (mo === 3 && day >= 8) || (mo === 11 && day < 7);
  const offsetH = Math.round((lng ?? 0) / 15) + (isDST ? 1 : 0);
  const shifted = new Date(d.getTime() + offsetH * 3600_000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function toSpotData(spot: SpotResp, solunar: SolunarResp, placeLabel?: string): SpotData {
  const lng = spot.spot?.lng ?? null;
  const lat = spot.spot?.lat ?? null;
  const now = spot.now ?? {};
  const past = spot.past ?? {};

  const w = now.weather ?? null;
  const fr = now.front ?? null;
  const td = now.tide ?? null;
  const an = past.anomaly ?? null;
  const rh = Array.isArray(past.rhyme) ? past.rhyme : [];

  const lu = spot.lineup ?? null;

  const m = solunar.moon ?? null;
  const s = solunar.sun ?? null;
  const sl = solunar.solunar ?? null;

  const windows = [
    ...(sl?.major ?? []).map((v) => ({ kind: "major" as const, start: utcToLocalHHMM(v.start, lng) ?? "", end: utcToLocalHHMM(v.end, lng) ?? "" })),
    ...(sl?.minor ?? []).map((v) => ({ kind: "minor" as const, start: utcToLocalHHMM(v.start, lng) ?? "", end: utcToLocalHHMM(v.end, lng) ?? "" })),
  ];

  return {
    resolution: "state",
    place: placeLabel ?? spot.spot?.state ?? null,
    as_of: spot.target_date ?? null,
    coords: lat != null && lng != null ? { lat, lng } : null,

    // WHAT THIS DAY WAS — recorded truth of the target date, rendered first.
    // Absent until the backend ships the block; null → the card omits it.
    thatDay: spot.that_day
      ? {
          date: spot.that_day.date ?? spot.target_date ?? "",
          weather: spot.that_day.weather ?? null,
          events: (Array.isArray(spot.that_day.events) ? spot.that_day.events : [])
            .filter((e) => e && e.title)
            .map((e) => ({
              title: e.title as string,
              narrative: e.narrative ?? null,
              deaths: e.deaths ?? null,
              injuries: e.injuries ?? null,
              damage_usd: e.damage_usd ?? null,
              county: e.county ?? null,
              began: e.began ?? null,
              span_note: e.span_note ?? null,
              provenance_url: e.provenance_url ?? null,
            })),
          tide: (Array.isArray(spot.that_day.tide) ? spot.that_day.tide : []).map((t) => ({
            station_name: t.station_name ?? null,
            residual_max_ft: t.residual_max_ft ?? null,
            residual_max_time_utc: t.residual_max_time_utc ?? null,
            daily_max_ft: t.daily_max_ft ?? null,
            residual_mean_ft: t.residual_mean_ft ?? null,
            daily_mean_ft: t.daily_mean_ft ?? null,
            basis: t.basis ?? null,
            provenance_url: t.provenance_url ?? null,
          })),
          quakes: (Array.isArray(spot.that_day.quakes) ? spot.that_day.quakes : []).map((q) => ({
            magnitude: q.magnitude ?? null,
            place: q.place ?? null,
            event_time_utc: q.event_time_utc ?? null,
            depth_km: q.depth_km ?? null,
            felt: q.felt ?? null,
            provenance_url: q.provenance_url ?? null,
          })),
          world: (Array.isArray(spot.that_day.world) ? spot.that_day.world : [])
            .filter((w) => w && w.title)
            .map((w) => ({ title: w.title as string, content: w.content ?? null })),
          era_note: spot.that_day.era_note ?? null,
          honest_note: spot.that_day.honest_note ?? null,
        }
      : null,

    // The LEAD — the dated lineup sentence. Only rendered when the archive
    // actually searched something (n_years > 0); "never in N years" is a
    // valid lead, so zero matches still flows through.
    lineup:
      lu && Array.isArray(lu.components) && lu.components.length > 0 && (lu.n_years ?? 0) > 0
        ? (() => {
            // matches[] is sorted newest-first — matches[0] IS the named last_date.
            const last = (lu.matches ?? []).find((m) => m.date === lu.last_date) ?? null;
            return {
              last_date: lu.last_date ?? null,
              n_matches: lu.n_matches ?? 0,
              n_years: lu.n_years ?? null,
              components: lu.components!,
              tide_station: lu.today?.tide_station ?? null,
              note: lu.honest_note ?? null,
              that_day: last?.that_day
                ? {
                    high: last.that_day.high ?? null,
                    anomaly_f: last.that_day.anomaly_f ?? null,
                    tide_residual_ft: last.that_day.tide_residual_ft ?? null,
                    moon_phase: last.that_day.moon_phase ?? null,
                  }
                : null,
              followed: last?.outcome ?? null,
              on_file: last ? toChips(last.on_file) : [],
            };
          })()
        : null,

    weather: w
      ? {
          temp_f: w.avg_high_f ?? 0,
          sky: w.label ?? "state-level (GHCN-daily)",
          wind_mph: 0, // state-level daily aggregate carries no wind — honest null-ish
          wind_dir: null,
        }
      : null,

    front: fr
      ? {
          moving: (fr.signal ?? "steady") !== "steady" && (fr.signal ?? "") !== "unknown",
          kind: (fr.temp_change_f ?? 0) < -3 ? "cold" : (fr.temp_change_f ?? 0) > 3 ? "warm" : "stationary",
          detail: fr.note ?? null,
          // The GHCN basis date (~a year behind the wall clock) — shown small so
          // "No front" can never read as a statement about the actual today.
          as_of: fr.as_of ?? null,
        }
      : null,

    // The LIVE layer — recorded alerts on file for the ACTUAL today. When these
    // exist and the front chip would say "No front", the card leads with these.
    live: (now.live ?? [])
      .filter((a) => a.title)
      .map((a) => ({ type: a.type ?? "alert", title: a.title as string, count: a.count ?? 1 })),
    live_as_of: now.live_as_of ?? null,

    moon: m
      ? { phase: m.phase ?? "", illumination: (m.illum ?? 0) / 100, age_days: m.age ?? null }
      : null,

    sun: s
      ? {
          sunrise: utcToLocalHHMM(s.sunrise, lng) ?? "",
          sunset: utcToLocalHHMM(s.sunset, lng) ?? "",
          shooting_light_start: utcToLocalHHMM(s.shooting_light_start, lng),
          shooting_light_end: utcToLocalHHMM(s.shooting_light_end, lng),
        }
      : null,

    tide: td
      ? {
          station: td.station_name ?? null,
          state: td.is_local ? "reading" : "nearest gauge",
          height_ft: td.daily_mean_ft ?? null,
        }
      : null,

    solunar: sl
      ? { day_rating: sl.score ?? 0, rating_label: sl.rating ?? null, windows }
      : null,

    anomaly: an
      ? { z: an.z ?? null, value: an.value ?? null, baseline_mean: an.baseline_mean ?? null, n_years: an.n_years ?? null, metric: an.metric ?? null }
      : null,

    rhyme: rh.length
      ? {
          // Carry the spot's coords onto each rhyme day so the card treats the
          // row as actionable (the parent wires the click to /date/:date).
          matches: rh.map((r) => ({
            date: r.date,
            summary: r.note ?? null,
            outcome: r.outcome ? `then ${r.outcome}` : null,
            on_file: toChips(r.on_file, r.also_recorded),
            lat,
            lng,
          })),
          n_candidates: rh.length,
        }
      : null,

    // SEMANTIC RHYME — "days that read like today." Unavailable (RPC failure)
    // maps to null so the card simply omits the block: failures isolate, never
    // clutter. The novel state flows through — it's a hero line, not an error.
    semantic: (() => {
      const sr = past.semantic_rhyme ?? null;
      if (!sr || sr.unavailable) return null;
      const matches = (Array.isArray(sr.matches) ? sr.matches : [])
        .filter((m): m is typeof m & { date: string } => !!m.date)
        .map((m) => ({
          date: m.date,
          similarity: m.similarity ?? null,
          summary: m.note ?? null,
          outcome: m.outcome ? `then ${m.outcome}` : null,
          lat,
          lng,
        }));
      if (!sr.novel && matches.length === 0) return null;
      return {
        matches,
        novel: sr.novel ?? false,
        note: sr.note ?? null,
        n_searched: sr.n_searched ?? null,
        method: sr.method ?? null,
      };
    })(),

    // THE CONTROL LINE — the all-years base rate the lineup claim is judged
    // against. Rendered once under the rhyme list; without it the feature is
    // a horoscope, so it rides in the same payload. A reason-only control
    // (all_n null — no recorded day to count) has no sentence to render.
    control: spot.control && spot.control.all_n != null
      ? {
          outcome: spot.control.outcome ?? null,
          matched_n: spot.control.matched_n ?? 0,
          matched_outcome_n: spot.control.matched_outcome_n ?? 0,
          all_n: spot.control.all_n ?? 0,
          all_outcome_n: spot.control.all_outcome_n ?? 0,
        }
      : null,
  };
}

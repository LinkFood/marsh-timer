/**
 * THE SPOT — the one place the hunter is standing, resolved once and frozen.
 *
 * THE WHOLE POINT: there is no signal in the marsh. Every identifier this app
 * needs in the field — county FIPS, state, the NOAA CO-OPS tide station — is
 * resolved ONCE, at save time, on the couch, with bars. After that it is a
 * frozen record in `localStorage` and NOTHING re-resolves it. A field screen
 * that has to ask the network what county it is in is a field screen that shows
 * a spinner at 05:15 and nothing at 05:40.
 *
 * Read that as a hard rule: `resolve*` functions in this file touch the network
 * and are only ever called from a save flow. `loadSpot()` touches nothing but
 * `localStorage` and is the only thing the field path is allowed to call.
 *
 * DELIBERATELY NOT `useYourGround`. That hook has a dozen importers, carries
 * state-level board semantics, and answers a different question ("which state's
 * archive am I browsing"). This answers "where is my blind". Merging them would
 * couple the offline field path to the board stack, which is exactly the
 * coupling this module exists to avoid. Two hooks, on purpose.
 *
 * NUMERIC DISCIPLINE: every parsed number goes through `Number.isFinite`, and
 * there is not a single `?? 0` in this file. A missing latitude is not the
 * equator. A missing station distance is not "zero miles away". Absent means
 * absent, and absent means the save is refused with a reason.
 */

import { useCallback, useEffect, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  THE RECORD                                                                */
/* -------------------------------------------------------------------------- */

export interface Spot {
  /** What the hunter calls it. Free text, theirs. */
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  /** 5-digit county FIPS, as a string — leading zeros are real. */
  readonly county_fips: string | null;
  readonly county_name: string | null;
  /** Two-letter state abbreviation, uppercase. */
  readonly state: string | null;
  /** NOAA CO-OPS tide-prediction station id, e.g. "8571807". */
  readonly coops_station_id: string | null;
  /** Great-circle distance from the spot to that station, in statute miles. */
  readonly station_miles: number | null;
  /** ISO timestamp of the save. This is when the record was frozen. */
  readonly saved_at: string;
}

const STORAGE_KEY = "dcd.hunt.spot.v1";

/**
 * Envelope version. Bumping this is how a future shape change REFUSES to read
 * an old record rather than misreading it. A half-understood spot is worse than
 * no spot — it puts a confident wrong county on the screen.
 */
const SPOT_SCHEMA_VERSION = 1;

/* -------------------------------------------------------------------------- */
/*  GUARDED PARSING                                                           */
/* -------------------------------------------------------------------------- */

/** Coerce to a finite number or `null`. Never zero-by-default. */
export function finiteOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const la = finiteOrNull(lat);
  const lo = finiteOrNull(lng);
  return la !== null && lo !== null && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

/* -------------------------------------------------------------------------- */
/*  DISTANCE                                                                  */
/* -------------------------------------------------------------------------- */

const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.609344;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in kilometres. Returns `null` if either point is not a
 * real coordinate — a bad input does not become a zero-kilometre answer, which
 * would sort to the top of a nearest-station search and pick garbage.
 */
export function haversineKm(
  aLat: unknown,
  aLng: unknown,
  bLat: unknown,
  bLng: unknown,
): number | null {
  const la1 = finiteOrNull(aLat);
  const lo1 = finiteOrNull(aLng);
  const la2 = finiteOrNull(bLat);
  const lo2 = finiteOrNull(bLng);
  if (la1 === null || lo1 === null || la2 === null || lo2 === null) return null;

  const dLat = toRad(la2 - la1);
  const dLon = toRad(lo2 - lo1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
  const km = 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
  return Number.isFinite(km) ? km : null;
}

export function kmToMiles(km: number | null): number | null {
  if (km === null || !Number.isFinite(km)) return null;
  const miles = km / KM_PER_MILE;
  return Number.isFinite(miles) ? miles : null;
}

/* -------------------------------------------------------------------------- */
/*  NOAA CO-OPS TIDE STATIONS  (SAVE-TIME ONLY — NEVER IN THE FIELD)          */
/* -------------------------------------------------------------------------- */

/**
 * Free, keyless, no auth. ~3,500 tide-prediction stations, ~2 MB of JSON.
 * Fetched once at save time; the ID it yields is what the field path uses.
 */
export const COOPS_STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";

export interface CoopsStation {
  readonly id: string;
  readonly name: string;
  readonly state: string | null;
  readonly lat: number;
  readonly lng: number;
}

export interface NearestStation {
  readonly station: CoopsStation;
  readonly km: number;
  readonly miles: number;
}

/**
 * Normalise the CO-OPS payload, dropping any station whose coordinates do not
 * parse. A station with a missing lat is not a station at 0°N — it is skipped.
 */
export function parseCoopsStations(payload: unknown): CoopsStation[] {
  const raw = (payload as { stations?: unknown })?.stations;
  if (!Array.isArray(raw)) return [];

  const out: CoopsStation[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const id = nonEmptyStringOrNull(rec.id);
    const lat = finiteOrNull(rec.lat);
    const lng = finiteOrNull(rec.lng);
    if (id === null || lat === null || lng === null) continue;
    out.push({
      id,
      name: nonEmptyStringOrNull(rec.name) ?? id,
      state: nonEmptyStringOrNull(rec.state),
      lat,
      lng,
    });
  }
  return out;
}

/**
 * Nearest tide-prediction station to a point, by great-circle distance.
 *
 * Verified against the reference case on 2026-08-01: Blackwater NWR
 * (38.4436, -76.0722) → station 8571807, "Woolford, Church Creek", MD,
 * 11.26 km / 7.00 mi. That is the nearest of 3,499 prediction stations.
 *
 * Returns `null` — not a fabricated "closest" — when the point is invalid or
 * the station list is empty.
 */
export function nearestStation(
  lat: unknown,
  lng: unknown,
  stations: readonly CoopsStation[],
): NearestStation | null {
  if (!isValidLatLng(lat, lng) || stations.length === 0) return null;

  let best: NearestStation | null = null;
  for (const station of stations) {
    const km = haversineKm(lat, lng, station.lat, station.lng);
    if (km === null) continue;
    if (best === null || km < best.km) {
      const miles = kmToMiles(km);
      if (miles === null) continue;
      best = { station, km, miles };
    }
  }
  return best;
}

/**
 * SAVE-TIME network call. Fetches the CO-OPS station list and picks the nearest.
 *
 * Do not call this from the field path. It exists so the ID can be frozen into
 * the record while the hunter still has signal.
 */
export async function resolveNearestStation(
  lat: number,
  lng: number,
  opts: { signal?: AbortSignal } = {},
): Promise<NearestStation | null> {
  if (!isValidLatLng(lat, lng)) return null;
  const res = await fetch(COOPS_STATIONS_URL, { signal: opts.signal });
  if (!res.ok) return null;
  const stations = parseCoopsStations(await res.json());
  return nearestStation(lat, lng, stations);
}

/* -------------------------------------------------------------------------- */
/*  PERSISTENCE                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Rebuild a `Spot` from whatever came out of `localStorage`, field by field.
 *
 * Returns `null` if the record is not usable. "Usable" means: right schema
 * version, real coordinates, real saved_at. Everything else is allowed to be
 * `null`, because a spot with no bound tide station is still a spot — it just
 * cannot show tides.
 */
export function parseStoredSpot(raw: unknown): Spot | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;

  if (finiteOrNull(rec.v) !== SPOT_SCHEMA_VERSION) return null;

  const lat = finiteOrNull(rec.lat);
  const lng = finiteOrNull(rec.lng);
  if (!isValidLatLng(lat, lng)) return null;

  const savedAt = nonEmptyStringOrNull(rec.saved_at);
  if (savedAt === null) return null;

  const state = nonEmptyStringOrNull(rec.state);

  return {
    name: nonEmptyStringOrNull(rec.name) ?? "My spot",
    lat: lat as number,
    lng: lng as number,
    county_fips: nonEmptyStringOrNull(rec.county_fips),
    county_name: nonEmptyStringOrNull(rec.county_name),
    state: state === null ? null : state.toUpperCase(),
    coops_station_id: nonEmptyStringOrNull(rec.coops_station_id),
    station_miles: finiteOrNull(rec.station_miles),
    saved_at: savedAt,
  };
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Safari private mode throws on access. No spot is a valid answer.
    return null;
  }
}

/** Read the frozen spot. Touches nothing but `localStorage`. Field-safe. */
export function loadSpot(): Spot | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseStoredSpot(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Freeze the spot. Returns whether the write actually landed. */
export function saveSpot(spot: Spot): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ v: SPOT_SCHEMA_VERSION, ...spot }));
    return true;
  } catch {
    return false;
  }
}

export function clearSpot(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  THE SAVE FLOW                                                             */
/* -------------------------------------------------------------------------- */

export interface SpotDraft {
  name: string;
  lat: unknown;
  lng: unknown;
  county_fips?: unknown;
  county_name?: unknown;
  state?: unknown;
  /** Set to override the auto-resolved station. The hunter always wins. */
  coops_station_id?: unknown;
  station_miles?: unknown;
}

export type SpotSaveResult =
  | { readonly status: "saved"; readonly spot: Spot }
  | { readonly status: "refused"; readonly message: string };

/**
 * Build and freeze a spot from a draft.
 *
 * Station binding: if the draft already carries a `coops_station_id`, that is
 * the hunter's override and it is taken as-is. Otherwise the nearest station is
 * resolved from the network HERE, at save time, and written into the record.
 * Either way the ID ends up frozen, and the field path never asks again.
 *
 * A failed station lookup does NOT fail the save — it saves the spot with a
 * null station, honestly, so the hunter can see that tides are unavailable
 * rather than seeing a wrong station's tides.
 */
export async function createSpot(
  draft: SpotDraft,
  opts: { signal?: AbortSignal; now?: () => Date } = {},
): Promise<SpotSaveResult> {
  const lat = finiteOrNull(draft.lat);
  const lng = finiteOrNull(draft.lng);
  if (!isValidLatLng(lat, lng)) {
    return {
      status: "refused",
      message:
        "That is not a real coordinate. A spot is not saved without one — a missing " +
        "latitude is not 0, and 0,0 is in the Atlantic Ocean.",
    };
  }

  const name = nonEmptyStringOrNull(draft.name);
  if (name === null) {
    return { status: "refused", message: "Give the spot a name so you can find it in the dark." };
  }

  let stationId = nonEmptyStringOrNull(draft.coops_station_id);
  let stationMiles = finiteOrNull(draft.station_miles);

  if (stationId === null) {
    try {
      const near = await resolveNearestStation(lat as number, lng as number, opts);
      if (near) {
        stationId = near.station.id;
        stationMiles = near.miles;
      }
    } catch {
      // Offline at save time, or NOAA down. Save without a station, honestly.
      stationId = null;
      stationMiles = null;
    }
  }

  const stateRaw = nonEmptyStringOrNull(draft.state);
  const now = opts.now ? opts.now() : new Date();

  const spot: Spot = {
    name,
    lat: lat as number,
    lng: lng as number,
    county_fips: nonEmptyStringOrNull(draft.county_fips),
    county_name: nonEmptyStringOrNull(draft.county_name),
    state: stateRaw === null ? null : stateRaw.toUpperCase(),
    coops_station_id: stationId,
    station_miles: stationMiles,
    saved_at: now.toISOString(),
  };

  if (!saveSpot(spot)) {
    return {
      status: "refused",
      message:
        "Could not write to this browser's storage, so the spot was not frozen. " +
        "Private browsing blocks this.",
    };
  }

  return { status: "saved", spot };
}

/* -------------------------------------------------------------------------- */
/*  useSpot()                                                                 */
/* -------------------------------------------------------------------------- */

export interface UseSpot {
  /** The frozen spot, or `null` if none is saved. */
  spot: Spot | null;
  /** True only for the first synchronous `localStorage` read. */
  loading: boolean;
  /** Last refusal message, or `null`. */
  error: string | null;
  /** Resolve-and-freeze. The only thing in this hook that touches the network. */
  save: (draft: SpotDraft) => Promise<SpotSaveResult>;
  /** Rebind the tide station without re-resolving anything else. */
  setStation: (stationId: string, miles?: number | null) => boolean;
  clear: () => void;
}

/**
 * The hook. Reads once on mount and then holds the record in memory.
 *
 * There is no polling, no refetch-on-focus, no re-resolution. That absence is
 * the feature.
 */
export function useSpot(): UseSpot {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSpot(loadSpot());
    setLoading(false);
  }, []);

  const save = useCallback(async (draft: SpotDraft): Promise<SpotSaveResult> => {
    const result = await createSpot(draft);
    if (result.status === "saved") {
      setSpot(result.spot);
      setError(null);
    } else {
      setError(result.message);
    }
    return result;
  }, []);

  // Written against `spot` rather than via a state updater on purpose: the
  // updater form would run the `saveSpot` side effect twice under StrictMode.
  const setStation = useCallback(
    (stationId: string, miles?: number | null): boolean => {
      const id = nonEmptyStringOrNull(stationId);
      if (id === null || !spot) return false;
      const next: Spot = { ...spot, coops_station_id: id, station_miles: finiteOrNull(miles) };
      if (!saveSpot(next)) return false;
      setSpot(next);
      return true;
    },
    [spot],
  );

  const clear = useCallback(() => {
    clearSpot();
    setSpot(null);
    setError(null);
  }, []);

  return { spot, loading, error, save, setStation, clear };
}

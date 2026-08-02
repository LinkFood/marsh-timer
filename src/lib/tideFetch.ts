/**
 * tideFetch.ts — the wire half of the water gate.
 *
 * This file talks to NOAA CO-OPS. Its companion, `src/lib/tide.ts`, does not and
 * cannot. That division is the whole point, and it is a FILE boundary rather
 * than a comment inside one file for one reason: a rule that cannot be violated
 * beats a rule that must be remembered.
 *
 * `eslint.config.js` names `src/lib/tide.ts` in the offline `files:` glob and
 * bans bare `fetch`, `window.fetch` and `globalThis.fetch` there. That tripwire
 * can only protect the pure half if the pure half is its own file. As long as
 * both halves shared a module, the offline guarantee was an in-file convention —
 * enforced by whoever happened to read the header — and eslint had nothing to
 * bite on. Now the guarantee is enforced by tooling: you cannot add a fetch to
 * the pure module without eslint failing.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DEPENDENCY DIRECTION IS ONE-WAY AND MUST STAY THAT WAY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *      tideFetch.ts  ──imports──▶  tide.ts
 *      tide.ts       ──imports──▶  (nothing from here. ever.)
 *
 * `tide.ts` owns the vocabulary — the types, the refusal, the pure readers. This
 * file owns exactly one thing on top of that: how those values are obtained over
 * a network. If an import ever points the other way, the coupling the split
 * exists to remove has been reintroduced and the tripwire can be routed around
 * again through a re-export.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHERE THIS CODE RUNS, AND WHERE IT MUST NOT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * At the truck. On wifi. The night before. Tide predictions are harmonic and
 * deterministic, so a whole season computes months ahead and never goes stale —
 * a pack fetched in August is still exact in January. Nothing in this file is
 * ever called from a blind. Everything a hunter reads standing in water lives in
 * `tide.ts` and runs on data already in his pocket.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE HONESTY RULES THAT LIVE ON THIS SIDE OF THE LINE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * A. NO `?? 0`. NOT ONCE. `parseHeight` below is the law. A missing tide reading
 *    is not a 0.0 ft tide; at MLLW, 0.0 ft is a real and ordinary water level,
 *    which is exactly what makes the fabrication invisible on screen. Note that
 *    `Number(null)` is `0` and `Number("")` is `0` — the two shapes a JSON field
 *    most often takes when it is absent. This project has already fabricated
 *    1,095 high-severity weather events from precisely this bug.
 *
 * B. REFUSE OUT LOUD. Every entry point returns `TideResult<T>` from `tide.ts` —
 *    a closed union with NO `value` property on the refusal branch, so a caller
 *    cannot read a height without narrowing on `status === "ok"` first.
 *
 * C. NEVER RETRY 4xx. Project law. Only 5xx, network failures and timeouts are
 *    retried. A CO-OPS 200 carrying an `{"error": …}` body is a DATA ANSWER, not
 *    a transport failure, and is likewise never retried.
 *
 * D. EVERY FETCH HAS AN `AbortController` AND A TIMEOUT, and checks `res.ok`.
 *    (`AtlasPage`'s `getJson` in this repo has none of the three. Do not copy
 *    it.)
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT CO-OPS ACTUALLY DOES, MEASURED 2026-08-01. Read before changing a param.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 1. SUBORDINATE STATIONS HAVE NO CURVE. Woolford / Church Creek (8571807), one
 *    of the two stations nearest Blackwater NWR, is `type: "S"` in the CO-OPS
 *    metadata API — a subordinate station, published as time-and-height offsets
 *    against a reference station (8574680), not as its own harmonic
 *    constituents. It returns hi/lo predictions happily and returns an ERROR for
 *    `interval=60`, `interval=6` and for no interval at all. Bishops Head
 *    (8571421) is a harmonic station and returns both.
 *
 *    So `TideDay.curve` is a `TideResult<TideCurve>`, not a `TideCurve | null`.
 *    A whole real station can only ever give you the headline, and the type says
 *    that out loud instead of leaving a null for a chart to plot as zero. We do
 *    NOT synthesize a curve from the hi/lo pairs — a rule-of-twelfths curve is
 *    an invented reading wearing three decimal places.
 *
 * 2. WE REQUEST `time_zone=gmt`, NOT `lst_ldt`, AND THAT IS LOAD-BEARING.
 *    `lst_ldt` returns bare local wall-clock strings with no offset, which are
 *    ambiguous or missing across a DST transition:
 *      • 2026-03-08 (spring forward) returns 23 hourly rows — `02:00` is absent.
 *      • 2026-11-01 (fall back — INSIDE DUCK SEASON) returns 24 hourly rows for
 *        a 25-hour local day. One real hour is simply not there, and the single
 *        `01:00` row is ambiguous between EDT and EST.
 *    There is no honest way to turn those strings into instants. `gmt` gives a
 *    uniform, unambiguous 24 rows on both days. This also puts tide in the exact
 *    frame `sky.ts` already publishes — "all returned instants are honest UTC
 *    instants… localizing to the spot's timezone is the caller's job" — so a
 *    tide curve and a sunrise can be compared without a conversion in between,
 *    which is the entire point of the shaded shooting window.
 *    `tideFetch.test.ts` asserts the built URL still says `gmt`. Do not change it.
 *
 * 3. A DAY HERE IS A UTC DAY, same as `sky.ts`. For the Chesapeake (UTC−4/−5)
 *    that covers the whole of legal light — a hunter's 05:40 EDT is 09:40Z and
 *    sunset is around 21:00Z. Local evening past 19:00 EST rolls into the next
 *    UTC day; a caller who needs that asks `fetchTideRange` for two days.
 *
 * 4. HTTP 200 DOES NOT MEAN DATA. An unknown station returns **200** with
 *    `{"error": {"message": "No Predictions data was found. …"}}`. A reversed
 *    date range returns 400 with the same envelope. So `res.ok` alone is not a
 *    success check and never was; the body is inspected either way.
 *
 * 5. A WRONG DATUM IS ACCEPTED SILENTLY. `datum=NAVD` returns a full, plausible,
 *    well-formed prediction set — at a different vertical reference. Bishops
 *    Head's 2026-09-01 high reads 2.351 ft at MLLW and 1.137 ft at NAVD; its low
 *    reads 0.279 ft at MLLW and −0.935 ft at NAVD. Nothing in the response
 *    announces which one you asked for. That is why `TideDatum` is a closed
 *    union rather than a string, why the datum is echoed into every
 *    `TideProvenance`, and why a surface must print it. The error message CO-OPS
 *    returns for missing data — "Please make sure the Datum input is valid" — is
 *    a red herring: it fires for a bad station and for a subordinate station's
 *    curve, neither of which has anything to do with the datum.
 */

import {
  PREDICTION_DISCLAIMER,
  packTideEvents,
  refuse,
  resultOk,
  type TideCurve,
  type TideDatum,
  type TideDay,
  type TideEvent,
  type TideEventKind,
  type TidePack,
  type TideProvenance,
  type TideResult,
  type TideUnits,
} from "./tide";

/* ───────────────────────────── constants ───────────────────────────── */

const COOPS_ENDPOINT = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

/**
 * Default request deadline. Generous enough for CO-OPS on a truck-stop LTE bar,
 * short enough that a hunter packing at 21:00 knows it failed.
 */
const DEFAULT_TIMEOUT_MS = 12_000;

/** Retries for 5xx / network / timeout ONLY. Never for 4xx. See rule C. */
const DEFAULT_RETRIES = 2;

/** Backoff between those retries, milliseconds, indexed by attempt. */
const RETRY_BACKOFF_MS = [400, 1_200] as const;

/** Sampling step of the hourly curve, minutes. */
const CURVE_STEP_MIN = 60;

/* ═══════════════════════════════ PARSING ═══════════════════════════════ */

/**
 * Read a CO-OPS height field.
 *
 * THIS FUNCTION IS THE `?? 0` LAW. Read the order of the guards:
 *
 *   `typeof raw !== "string"` fires FIRST, and it is what kills `null`. If it
 *   did not, `Number(null)` would return `0` — a finite number that sails
 *   through `Number.isFinite` and lands on screen as a 0.0 ft tide, which at
 *   MLLW is a completely ordinary reading and therefore invisible. `undefined`,
 *   `[]` (`Number([])` is also `0`) and `false` die here too.
 *
 *   The empty/whitespace check kills `""`, for the same reason: `Number("")` is
 *   `0`.
 *
 *   `Number.isFinite` then kills `"abc"` (NaN) and `"Infinity"`.
 *
 * Returns `null` for anything it does not fully understand. A caller that sees
 * `null` must refuse — never substitute.
 */
function parseHeight(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a CO-OPS `"YYYY-MM-DD HH:MM"` timestamp as a UTC instant.
 *
 * Built from components through `Date.UTC`, NEVER `new Date(str)`. A bare
 * space-separated datetime string is not ISO-8601, so its interpretation is
 * implementation-defined; V8 parses it as LOCAL time, which silently shifts
 * every tide in the pack by the machine's offset and produces a chart that is
 * plausible, self-consistent and four hours wrong.
 *
 * Requesting `time_zone=gmt` is what makes reading these components as UTC
 * correct in the first place — see finding 2 in the header.
 */
function parseCoopsInstant(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  // Round-trip guard: rejects 2026-02-31 and friends, which Date.UTC rolls over
  // silently into March rather than failing.
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date;
}

function parseEventKind(raw: unknown): TideEventKind | null {
  if (raw === "H") return "high";
  if (raw === "L") return "low";
  return null;
}

/** The `{"error": {"message": …}}` envelope CO-OPS uses at 200 AND at 4xx. */
function coopsErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const err = (body as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return null;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" ? msg.trim() : "";
}

interface ParsedRow {
  readonly at: Date;
  readonly height: number;
  readonly kind: TideEventKind | null;
}

/**
 * Validate and read a whole `predictions` array.
 *
 * ONE BAD ROW REFUSES THE WHOLE RESPONSE. It does not skip the row. A curve with
 * a silently dropped sample still renders — it just draws a straight line across
 * the missing water, which is the same fabrication as `?? 0` wearing better
 * clothes. If CO-OPS handed us something we cannot read, we do not know what
 * else is wrong with it, and the honest answer is no chart.
 */
function parsePredictions(
  body: unknown,
  expectKind: boolean,
): TideResult<readonly ParsedRow[]> {
  if (typeof body !== "object" || body === null) {
    return refuse("malformed-response", "The tide service returned something unreadable.");
  }

  const rows = (body as { predictions?: unknown }).predictions;
  if (!Array.isArray(rows)) {
    return refuse(
      "malformed-response",
      "The tide service response had no predictions in it.",
    );
  }
  if (rows.length === 0) {
    return refuse("no-data", "The tide service returned no predictions for this request.");
  }

  const out: ParsedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (typeof row !== "object" || row === null) {
      return refuse("malformed-response", "A tide prediction row was unreadable.", `row ${i}`);
    }
    const r = row as { t?: unknown; v?: unknown; type?: unknown };

    const at = parseCoopsInstant(r.t);
    if (at === null) {
      return refuse(
        "unparsable-value",
        "A tide prediction carried a time we could not read, so this tide is not shown.",
        `row ${i}: t=${JSON.stringify(r.t)}`,
      );
    }

    const height = parseHeight(r.v);
    if (height === null) {
      // THE LAW. A missing height is not a 0.0 ft tide.
      return refuse(
        "unparsable-value",
        "A tide prediction came back without a height, so no tide is shown. " +
          "A missing reading is not a low tide.",
        `row ${i}: v=${JSON.stringify(r.v)}`,
      );
    }

    let kind: TideEventKind | null = null;
    if (expectKind) {
      kind = parseEventKind(r.type);
      if (kind === null) {
        return refuse(
          "unparsable-value",
          "A tide prediction did not say whether it was a high or a low.",
          `row ${i}: type=${JSON.stringify(r.type)}`,
        );
      }
    }

    if (out.length > 0 && at.getTime() < out[out.length - 1].at.getTime()) {
      return refuse(
        "malformed-response",
        "Tide predictions came back out of order.",
        `row ${i}`,
      );
    }

    out.push({ at, height, kind });
  }

  return resultOk(out);
}

/* ═════════════════════════════ THE WIRE ═════════════════════════════ */

export interface TideFetchOptions {
  /** Request deadline. Default 12 s. */
  readonly timeoutMs?: number;
  /** Attempts after the first, for 5xx / network / timeout ONLY. Default 2. */
  readonly retries?: number;
  /** Caller cancellation. Composed with the internal timeout, not replaced by it. */
  readonly signal?: AbortSignal;
  /** Injection seam for tests. Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Vertical reference. Closed union — see finding 5. Default MLLW. */
  readonly datum?: TideDatum;
  /** Default `"english"` (feet). */
  readonly units?: TideUnits;
}

/** `YYYYMMDD` in UTC, which is the frame CO-OPS is being asked to answer in. */
function coopsDate(date: Date): string | null {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y.toString().padStart(4, "0")}${m.toString().padStart(2, "0")}${d
    .toString()
    .padStart(2, "0")}`;
}

/** CO-OPS station ids are seven digits. Anything else never leaves the device. */
function isStationId(value: unknown): value is string {
  return typeof value === "string" && /^\d{7}$/.test(value);
}

/**
 * Build the request URL.
 *
 * THIS LIVES HERE, NOT IN `tide.ts`, EVEN THOUGH IT IS A PURE FUNCTION. It only
 * builds a string and touches nothing — but the only reason the string exists is
 * to be fetched with, and keeping it on this side means `tide.ts` does not
 * contain a single character of the CO-OPS endpoint. `grep tidesandcurrents
 * src/lib/tide.ts` returns nothing, which is a boundary a reviewer can check in
 * one command rather than by reading two files. Purity was never the criterion
 * for which half a thing belongs in; "does this exist to talk to the network"
 * is.
 *
 * Exported because `tideFetch.test.ts` asserts on it: specifically that
 * `time_zone` still reads `gmt` and that the datum is the one that was asked
 * for. Both of those are silent-corruption failures — see findings 2 and 5 — and
 * neither shows up in any downstream number as anything but a plausible wrong
 * answer.
 */
export function buildCoopsUrl(params: {
  stationId: string;
  beginDate: string;
  endDate: string;
  interval: "hilo" | "60";
  datum: TideDatum;
  units: TideUnits;
}): string {
  const q = new URLSearchParams({
    begin_date: params.beginDate,
    end_date: params.endDate,
    station: params.stationId,
    product: "predictions",
    datum: params.datum,
    units: params.units,
    time_zone: "gmt",
    format: "json",
    interval: params.interval,
  });
  return `${COOPS_ENDPOINT}?${q.toString()}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * One CO-OPS call: abort controller, timeout, `res.ok`, retry policy, JSON parse.
 *
 * The retry ladder implements project law C exactly:
 *   • 4xx  → return immediately. Never retried. Our request is wrong; asking
 *            again with the same request cannot make it right, and CO-OPS is a
 *            free public service we do not get to hammer.
 *   • 5xx  → retried.
 *   • network failure / timeout → retried.
 *   • caller abort → returned immediately, never retried. The caller meant it.
 *   • 200 with an `{"error": …}` body → returned immediately. That is CO-OPS
 *            answering "there is nothing here", which is data, not a fault.
 */
async function coopsRequest(
  url: string,
  opts: TideFetchOptions,
): Promise<TideResult<unknown>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;

  if (typeof doFetch !== "function") {
    return refuse("network", "No network client is available to reach the tide service.");
  }

  let last: TideResult<unknown> = refuse(
    "network",
    "The tide service could not be reached.",
  );

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) {
      return refuse("network", "The tide request was cancelled.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuterAbort);

    try {
      const res = await doFetch(url, { signal: controller.signal });

      // 4xx — our fault, and project law says never retry it.
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => "");
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const msg = coopsErrorMessage(parsed);
        return refuse(
          "bad-request",
          "The tide service rejected this request, so no tide is shown.",
          msg !== null && msg !== "" ? msg : `HTTP ${res.status}`,
        );
      }

      if (!res.ok) {
        // 5xx (or anything else non-ok) — retryable.
        last = refuse(
          "upstream-error",
          "The tide service is having trouble right now, so no tide is shown.",
          `HTTP ${res.status}`,
        );
      } else {
        const text = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return refuse(
            "malformed-response",
            "The tide service returned something that was not readable data.",
            text.slice(0, 200),
          );
        }

        // FINDING 4: a 200 does not mean data. An unknown station comes back
        // 200 with this envelope. It is an answer, so it is not retried.
        const errMsg = coopsErrorMessage(body);
        if (errMsg !== null) {
          return refuse(
            "no-data",
            "The tide service has no predictions for this station and date.",
            errMsg,
          );
        }

        return resultOk(body);
      }
    } catch (e) {
      if (opts.signal?.aborted) {
        return refuse("network", "The tide request was cancelled.");
      }
      const aborted = controller.signal.aborted;
      last = aborted
        ? refuse(
            "timeout",
            "The tide service did not answer in time, so no tide is shown.",
            `${timeoutMs} ms`,
          )
        : refuse(
            "network",
            "The tide service could not be reached, so no tide is shown.",
            e instanceof Error ? e.message : String(e),
          );
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }

    if (attempt < retries) {
      await sleep(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
    }
  }

  return last;
}

function provenanceFor(
  stationId: string,
  datum: TideDatum,
  units: TideUnits,
): TideProvenance {
  return {
    kind: "prediction",
    source: "NOAA CO-OPS",
    stationId,
    datum,
    units,
    timeFrame: "utc",
    fetchedAt: new Date().toISOString(),
    disclaimer: PREDICTION_DISCLAIMER,
  };
}

/**
 * FETCH. The day's highs and lows AND its hourly curve, in one call.
 *
 * `date` is read in UTC and the day returned is the UTC day — same frame as
 * `sky.ts`, see finding 3.
 *
 * The two requests go out together, then the curve's failure is CLASSIFIED
 * against the hi/lo's success: if hi/lo came back and the curve did not, this is
 * a subordinate station rather than a bad station or a bad date, and the refusal
 * says `"no-curve"` with a sentence a hunter can act on. That classification is
 * only available because both answers are in hand at the same moment, which is
 * why they are not two separate public functions.
 */
export async function fetchTideDay(
  stationId: string,
  date: Date,
  opts: TideFetchOptions = {},
): Promise<TideResult<TideDay>> {
  if (!isStationId(stationId)) {
    return refuse(
      "bad-request",
      "No tide station was given, so no tide is shown. Tide stations are seven-digit " +
        "NOAA CO-OPS ids.",
      String(stationId),
    );
  }
  const day = coopsDate(date);
  if (day === null) {
    return refuse("bad-request", "No valid date was given, so no tide is shown.");
  }

  const datum: TideDatum = opts.datum ?? "MLLW";
  const units: TideUnits = opts.units ?? "english";
  const provenance = provenanceFor(stationId, datum, units);

  const [hiloRes, curveRes] = await Promise.all([
    coopsRequest(
      buildCoopsUrl({ stationId, beginDate: day, endDate: day, interval: "hilo", datum, units }),
      opts,
    ),
    coopsRequest(
      buildCoopsUrl({ stationId, beginDate: day, endDate: day, interval: "60", datum, units }),
      opts,
    ),
  ]);

  if (hiloRes.status !== "ok") return hiloRes;

  const parsedHilo = parsePredictions(hiloRes.value, true);
  if (parsedHilo.status !== "ok") return parsedHilo;

  const events: TideEvent[] = parsedHilo.value.map((r) => ({
    at: r.at,
    height: r.height,
    // `expectKind` was true, so `kind` is non-null on every row; the assertion
    // is narrowing, not trust.
    kind: r.kind as TideEventKind,
  }));

  const curve: TideResult<TideCurve> = (() => {
    if (curveRes.status !== "ok") {
      // FINDING 1. hi/lo answered and the curve did not — subordinate station.
      if (curveRes.reason === "no-data") {
        return refuse<TideCurve>(
          "no-curve",
          "This station publishes only high and low tide times, not a continuous " +
            "water curve. The highs and lows below are real; there is no chart to draw.",
          curveRes.detail,
        );
      }
      return curveRes;
    }
    const parsedCurve = parsePredictions(curveRes.value, false);
    if (parsedCurve.status !== "ok") return parsedCurve;
    return resultOk<TideCurve>({
      provenance,
      stepMinutes: CURVE_STEP_MIN,
      samples: parsedCurve.value.map((r) => ({ at: r.at, height: r.height })),
    });
  })();

  return resultOk({
    provenance,
    dayStartUTC: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    ),
    events,
    curve,
  });
}

/**
 * FETCH. A date range of highs and lows, packed for the pocket.
 *
 * HI/LO ONLY, DELIBERATELY. The hourly curve for the same range would be 2,952
 * rows against 475 — six times the bytes for a chart nobody scrolls four months
 * of. The headline pre-caches; the curve is fetched for the day you are actually
 * hunting, by `fetchTideDay`. Tide predictions are harmonic and deterministic,
 * so a pack computed in August is still exact in January; there is no staleness
 * to manage, only a datum and a station to keep straight.
 *
 * The encoding itself lives in `packTideEvents` over in `tide.ts`, because a
 * hunter re-reads and re-packs cached events offline and that arithmetic must
 * not sit behind the network boundary. This function only obtains the events.
 *
 * `startDate` and `endDate` are read in UTC and the range is inclusive.
 */
export async function fetchTideRange(
  stationId: string,
  startDate: Date,
  endDate: Date,
  opts: TideFetchOptions = {},
): Promise<TideResult<TidePack>> {
  if (!isStationId(stationId)) {
    return refuse(
      "bad-request",
      "No tide station was given, so no tide is shown. Tide stations are seven-digit " +
        "NOAA CO-OPS ids.",
      String(stationId),
    );
  }
  const begin = coopsDate(startDate);
  const end = coopsDate(endDate);
  if (begin === null || end === null) {
    return refuse("bad-request", "No valid date range was given, so no tide is shown.");
  }
  if (startDate.getTime() > endDate.getTime()) {
    return refuse(
      "bad-request",
      "The tide date range ends before it begins, so no tide is shown.",
      `${begin} → ${end}`,
    );
  }

  const datum: TideDatum = opts.datum ?? "MLLW";
  const units: TideUnits = opts.units ?? "english";

  const res = await coopsRequest(
    buildCoopsUrl({ stationId, beginDate: begin, endDate: end, interval: "hilo", datum, units }),
    opts,
  );
  if (res.status !== "ok") return res;

  const parsed = parsePredictions(res.value, true);
  if (parsed.status !== "ok") return parsed;

  const events: TideEvent[] = parsed.value.map((r) => ({
    at: r.at,
    height: r.height,
    kind: r.kind as TideEventKind,
  }));

  return packTideEvents(events, {
    stationId,
    datum,
    units,
    fetchedAt: new Date().toISOString(),
  });
}

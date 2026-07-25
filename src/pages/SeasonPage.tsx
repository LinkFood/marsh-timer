import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { InnerHeader, InnerFooter } from "@/components/InnerNav";
import { US_STATES, isGroundState, useYourGround } from "@/hooks/useYourGround";
import { stateFullName } from "@/lib/board/frameStore";
import SeasonBlock from "@/components/season/SeasonBlock";
import ComingLine from "@/components/season/ComingLine";
import FrequencyCard, { type MetricAvailability } from "@/components/season/FrequencyCard";
import { CARD_METRICS, type SeriesColumnRow } from "@/lib/board/frequency";
import {
  COMING_WINDOW_DAYS,
  ComingModel,
  EventRow,
  Load,
  READ_TIMEOUT_MS,
  SeasonModel,
  SeasonRow,
  addDays,
  buildComingModel,
  buildSeasonModel,
  currentSeasonYear,
  todayIso,
} from "@/lib/season";

/**
 * THE SEASON (/season) — v1a, the hunter's state page.
 *
 * Three blocks, in this order, because this is the order a hunter asks them in:
 *
 *   1. THE SEASON        when does it open, how many days out. The promise the
 *                        domain name makes.
 *   2. IS SOMETHING COMING   the forward-dated event lane, rendered for the
 *                        first time on this site.
 *   3. HOW OFTEN THIS HAPPENS HERE   the frequency card, counting the state's
 *                        own temperature record: 76 complete years of GHCN,
 *                        already here. It is labeled as the temperature card and
 *                        never implies it is the pressure card the plan's
 *                        exemplar describes — that one waits on the ERA5
 *                        backfill, and Ruling 3 makes them two separate cards on
 *                        two separate variables from two separate sources.
 *
 * Reads follow `PlantPage.tsx`: independent, bounded, each with its own
 * `cancelled` flag and an explicit honest-absence branch. Two differences from
 * PlantPage, both deliberate: every read carries an AbortController with a
 * timeout (the `AtlasPage` `getJson` defect is a forever-hang plus a silent
 * malformed render, and it is not carried here), and each read reports
 * loading / error / ok as three distinct states rather than folding a failed
 * read into "we hold nothing" — the difference between "the sky is quiet" and
 * "nobody looked" is the whole product.
 *
 * Reads only. The client never writes; anon write grants were revoked on all
 * DCD tables and a write would 401, which is intended.
 */

export default function SeasonPage() {
  const [params, setParams] = useSearchParams();
  const { ground, setGround } = useYourGround(params.get("state"));
  const st = isGroundState(ground) ? ground : "MD";
  const stateName = stateFullName(st);

  // One clock read for the whole page — every branch below agrees on today.
  const today = useMemo(() => todayIso(), []);
  const seasonYear = useMemo(() => currentSeasonYear(today), [today]);
  const horizon = useMemo(() => addDays(today, COMING_WINDOW_DAYS), [today]);

  // The card's anchor. "This time of year" means within ±10 days of THIS day, so
  // it has to be a day the reader can see. Defaults to today; `?on=MM-DD` moves
  // it, which is how you read October's card in July without inventing anything.
  const onParam = params.get("on");
  const cardOn = useMemo(
    () => (onParam && /^\d{2}-\d{2}$/.test(onParam) ? `${today.slice(0, 4)}-${onParam}` : today),
    [onParam, today],
  );

  const [seasons, setSeasons] = useState<Load<SeasonModel>>({ s: "loading" });
  const [coming, setComing] = useState<Load<ComingModel>>({ s: "loading" });
  const [laneLastRun, setLaneLastRun] = useState<Load<string | null>>({ s: "loading" });
  const [column, setColumn] = useState<Load<SeriesColumnRow | null>>({ s: "loading" });
  const [metricMenu, setMetricMenu] = useState<Load<MetricAvailability[]>>({ s: "loading" });

  // Which question the card is answering. `?metric=` so a card is linkable, and
  // the daytime high stays the default because it is the one that shipped.
  const metricParam = params.get("metric");
  const metric = CARD_METRICS.some((m) => m.metric === metricParam)
    ? (metricParam as string)
    : "avg_high_f";

  useEffect(() => {
    document.title = `The season — ${stateName} — Duck Countdown`;
  }, [stateName]);

  // ── READ 1 — the season table. `select("*")` on purpose: Ruling 10.1's
  // `provisional` column does not exist yet, and when the 2026-27 transcription
  // lands it, the label renders with no code change here.
  useEffect(() => {
    if (!supabase) {
      setSeasons({ s: "error" });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS);
    setSeasons({ s: "loading" });

    (async () => {
      try {
        const { data, error } = await supabase
          .from("hunt_seasons")
          .select("*")
          .eq("state_abbr", st)
          .in("species_id", ["duck", "goose"])
          .abortSignal(ctrl.signal);
        if (cancelled) return;
        if (error || !data) {
          setSeasons({ s: "error" });
          return;
        }
        setSeasons({ s: "ok", v: buildSeasonModel(data as SeasonRow[], today, seasonYear) });
      } catch {
        if (!cancelled) setSeasons({ s: "error" });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [st, today, seasonYear]);

  // ── READ 2 — the forward window of the event lane. Ordered newest-first so
  // the deduper keeps the freshest run's word on each (date, type).
  useEffect(() => {
    if (!supabase) {
      setComing({ s: "error" });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS);
    setComing({ s: "loading" });

    (async () => {
      try {
        const { data, error } = await supabase
          .from("hunt_weather_events")
          .select("event_date,event_type,severity,details,created_at")
          .eq("state_abbr", st)
          .gte("event_date", today)
          .lte("event_date", horizon)
          .order("created_at", { ascending: false })
          .limit(500)
          .abortSignal(ctrl.signal);
        if (cancelled) return;
        if (error || !data) {
          setComing({ s: "error" });
          return;
        }
        setComing({ s: "ok", v: buildComingModel(data as EventRow[]) });
      } catch {
        if (!cancelled) setComing({ s: "error" });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [st, today, horizon]);

  // ── READ 3 — the lane's heartbeat, independent of the window. Without it an
  // empty window is unreadable: a quiet sky and a dead cron look identical.
  // This one read is what lets block 2 refuse instead of reassure.
  useEffect(() => {
    if (!supabase) {
      setLaneLastRun({ s: "error" });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS);
    setLaneLastRun({ s: "loading" });

    (async () => {
      try {
        const { data, error } = await supabase
          .from("hunt_weather_events")
          .select("created_at")
          .eq("state_abbr", st)
          .order("created_at", { ascending: false })
          .limit(1)
          .abortSignal(ctrl.signal);
        if (cancelled) return;
        if (error || !data) {
          setLaneLastRun({ s: "error" });
          return;
        }
        const row = data[0] as { created_at: string } | undefined;
        setLaneLastRun({ s: "ok", v: row?.created_at ?? null });
      } catch {
        if (!cancelled) setLaneLastRun({ s: "error" });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [st]);

  // ── READ 4 — WHICH QUESTIONS this state's record can answer. Deliberately
  // WITHOUT `readings`: this is the menu, seven small rows, and it is the read
  // that lets the card name a metric as "not held here" instead of showing a chip
  // that leads nowhere. Pulling every blob to build a menu would be ~750 KB on a
  // phone to render seven labels.
  useEffect(() => {
    if (!supabase) {
      setMetricMenu({ s: "error" });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS);
    setMetricMenu({ s: "loading" });

    (async () => {
      try {
        const { data, error } = await supabase
          .from("board_series_columns")
          .select("metric,n_present,first_year,last_year")
          .eq("instrument_id", `ghcn-${st.toLowerCase()}`)
          .abortSignal(ctrl.signal);
        if (cancelled) return;
        if (error || !data) {
          setMetricMenu({ s: "error" });
          return;
        }
        setMetricMenu({ s: "ok", v: data as MetricAvailability[] });
      } catch {
        if (!cancelled) setMetricMenu({ s: "error" });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [st]);

  // ── READ 5 — the selected metric's whole column, one row (plan §3 option c).
  // ~108 KB of hex for 76 years of daily readings; the counting then happens in
  // the browser over the ~1,600 days inside the doy window. An explicit column
  // list, not `*`: `readings` is the largest thing this page ever pulls and the
  // select is where that stays visible.
  //
  // Keyed on the metric as well as the state, so switching question re-reads ONE
  // column rather than the page pre-loading all seven. Mobile-first means the
  // hunter who only ever asks about the cold pays for the cold.
  //
  // `ok` with a null value is a real answer — this column is not baked for this
  // state — and it is NOT the same as an error. The card renders them apart.
  useEffect(() => {
    if (!supabase) {
      setColumn({ s: "error" });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS);
    setColumn({ s: "loading" });

    (async () => {
      try {
        const { data, error } = await supabase
          .from("board_series_columns")
          .select(
            "instrument_id,metric,first_day,n_days,scale,readings,n_present,first_year,last_year,source",
          )
          .eq("instrument_id", `ghcn-${st.toLowerCase()}`)
          .eq("metric", metric)
          .maybeSingle()
          .abortSignal(ctrl.signal);
        if (cancelled) return;
        if (error) {
          setColumn({ s: "error" });
          return;
        }
        setColumn({ s: "ok", v: (data as SeriesColumnRow | null) ?? null });
      } catch {
        if (!cancelled) setColumn({ s: "error" });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [st, metric]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-950 px-5 py-7 text-gray-100 sm:px-10 sm:py-9">
      <InnerHeader
        title="THE SEASON"
        subtitle={
          <>
            your ground, this season&rsquo;s dates, and what&rsquo;s moving &middot; counting, never
            forecasting
          </>
        }
      />

      {/* the shared ground picker — one choice, followed everywhere */}
      <div className="mt-8 flex items-center gap-3 font-mono text-[11px] text-gray-500">
        <label htmlFor="season-state">your ground</label>
        <select
          id="season-state"
          value={st}
          onChange={(e) => {
            setGround(e.target.value);
            setParams(withParam(params, "state", e.target.value), { replace: true });
          }}
          className="rounded border border-white/10 bg-gray-900 px-2 py-1.5 font-mono text-[12px] text-gray-200 outline-none focus:border-cyan-300/40"
        >
          {US_STATES.map((s) => (
            <option key={s.abbr} value={s.abbr}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <main className="flex-1 space-y-16 py-10 sm:space-y-20">
        <SeasonBlock stateName={stateName} seasonYear={seasonYear} load={seasons} />
        <ComingLine
          stateName={stateName}
          today={today}
          horizon={horizon}
          load={coming}
          laneLastRun={laneLastRun}
        />
        <FrequencyCard
          stateName={stateName}
          on={cardOn}
          menu={metricMenu}
          metric={metric}
          onMetric={(m) => setParams(withParam(params, "metric", m), { replace: true })}
          load={column}
        />
      </main>

      <InnerFooter current="season" />
    </div>
  );
}

/**
 * Change one search param, keep the rest. The picker used to replace the whole
 * query string, which silently dropped `?on=` — and would now also drop the
 * metric, so a hunter switching state would land back on the temperature card
 * having asked about rain.
 */
function withParam(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(key, value);
  return next;
}

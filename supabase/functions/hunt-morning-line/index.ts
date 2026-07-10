// hunt-morning-line — THE MORNING LINE: the product's front door and daily
// heartbeat. One dated lede sentence about American ground, built entirely
// from recorded fact, at a permanent address.
//
// READ-ONLY. Writes nothing, ever (surfaces never write). For a given date
// (default: today in US Eastern), finds the most notable state — the largest |z|
// weather anomaly with a scoreable baseline — via the already-deployed
// hunt-atlas-anomaly, then pulls that state's lineup/rhyme/control via the
// already-deployed hunt-atlas-spot. The line is TEMPLATED from those numbers:
// no LLM, no prose generation, no forecast. Deterministic given the same day;
// the archive is append-only, so past dates recompute to the same line.
//
// Honest by construction (Vision honesty laws):
//   - Almanac framing: the as-of year is IN the sentence. GHCN's archive edge
//     is ~a year behind the wall clock, and the line says so instead of
//     pretending the number is live.
//   - Every clause carries its denominator (n years, days searched, control).
//   - Alerts are RECORDED rows on file for the requested date — queried here
//     directly (not via the spot function's wall-clock "live" layer) so a past
//     date's line stays stable when recomputed later.
//   - Zero lineup matches is a valid line: "never in N recorded years."

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';

const FLOOR_DATE = '1950-01-01';    // GHCN archive floor — no lines before it
const MIN_HEADLINE_YEARS = 10;      // thin baselines can't fake a headline
const LIVE_TYPES = ['nws-alert', 'weather-event', 'compound-risk-alert'];
const LIVE_PRIORITY: Record<string, number> = {
  'nws-alert': 0, 'compound-risk-alert': 1, 'weather-event': 2,
};
const LIVE_LIMIT = 10;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function isoToday(): string {
  // "Today" is an American day, not a UTC one — anchor the dateline to US
  // Eastern, or the page flips to tomorrow at 8pm ET.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function isoPlusDays(iso: string, days: number): string {
  const dt = new Date(iso + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** "2026-07-05" -> "July 5" */
function monthDayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2023-07-08" -> "July 8, 2023" */
function fullDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function validIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const dt = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso;
}

/** Human chip title from a recorded-alert row's title (mirrors hunt-atlas-spot). */
function liveTitle(ct: string, title: string): string {
  const t = String(title ?? '').trim();
  if (ct === 'nws-alert') return t.replace(/\s+-\s+[A-Z]{2}$/, '');
  if (ct === 'weather-event') {
    const m = t.match(/^[A-Z]{2}\s+([a-z_]+)\s+\d{4}-\d{2}-\d{2}$/);
    if (m) { const w = m[1].replace(/_/g, ' '); return w[0].toUpperCase() + w.slice(1); }
  }
  if (ct === 'compound-risk-alert') {
    const m = t.match(/—\s*(.+?)\s*\(\d{4}-\d{2}-\d{2}\)$/);
    if (m) return m[1];
  }
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const jsonHeaders = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };

  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    const todayIso = isoToday();
    const dateIso = dateParam ?? todayIso;

    if (!validIso(dateIso)) {
      return new Response(JSON.stringify({ error: 'Invalid date. Use YYYY-MM-DD.' }),
        { status: 400, headers: jsonHeaders });
    }
    if (dateIso > todayIso) {
      return new Response(JSON.stringify({
        error: `No line for ${dateIso} — the day hasn't happened. The Morning Line is a record, never a forecast.`,
      }), { status: 400, headers: jsonHeaders });
    }
    if (dateIso < FLOOR_DATE) {
      return new Response(JSON.stringify({
        error: `No line before ${FLOOR_DATE} — the GHCN archive floor.`,
      }), { status: 400, headers: jsonHeaders });
    }

    const base = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const fnHeaders = { apikey: key, Authorization: `Bearer ${key}` };

    // ---- 1) The most notable state: largest |z| with a real baseline --------
    // Same data every surface uses — one internal GET to the deployed function.
    const anomRes = await fetch(
      `${base}/functions/v1/hunt-atlas-anomaly?date=${dateIso}`, { headers: fnHeaders });
    if (!anomRes.ok) {
      return new Response(JSON.stringify({ error: `hunt-atlas-anomaly ${anomRes.status}` }),
        { status: 502, headers: jsonHeaders });
    }
    const anom = await anomRes.json();
    const states = Array.isArray(anom?.states) ? anom.states : [];
    const candidates = states.filter((s: Record<string, unknown>) =>
      typeof s.z === 'number' && Number.isFinite(s.z));
    // Deterministic pick: |z| desc, then state abbr asc (stable tie-break).
    candidates.sort((a: Record<string, number>, b: Record<string, number>) =>
      Math.abs(b.z) - Math.abs(a.z) || (a.state < b.state ? -1 : 1));
    const pick = candidates.find((s: Record<string, number>) => s.n_years >= MIN_HEADLINE_YEARS)
      ?? candidates[0] ?? null;

    if (!pick) {
      // Honest empty: no state has a scoreable reading for this day-of-year.
      return new Response(JSON.stringify({
        date: dateIso,
        line: null,
        reason: `No state has a scoreable ${monthDayLabel(dateIso)} reading on file (baseline floor: ${anom?.min_years ?? 5} years).`,
        nav: {
          yesterday: dateIso > FLOOR_DATE ? isoPlusDays(dateIso, -1) : null,
          tomorrow: dateIso < todayIso ? isoPlusDays(dateIso, 1) : null,
        },
        generated_at: new Date().toISOString(),
      }), { status: 200, headers: jsonHeaders });
    }

    // ---- 2 + 3) The dossier AND the alerts-on-file, fetched in parallel ------
    // Both need only pick.state + dateIso and are independent of each other, so
    // the internal spot fetch and the bounded alert read overlap. Alerts are a
    // direct bounded read (never a write) of rows the pipes already wrote with
    // effective_date = the REQUESTED date (not wall-clock today) — that is what
    // keeps a past date's line recomputable.
    const supabase = createClient(base, key);

    const spotPromise = (async (): Promise<Record<string, unknown> | null> => {
      try {
        const spotRes = await fetch(
          `${base}/functions/v1/hunt-atlas-spot?state=${pick.state}&date=${dateIso}`,
          { headers: fnHeaders });
        if (spotRes.ok) return await spotRes.json();
      } catch (_e) { /* the lede stands alone if the dossier read fails */ }
      return null;
    })();

    const alertsPromise = (async (): Promise<Array<{ type: string; title: string; count: number }>> => {
      const { data: liveRows, error: liveErr } = await supabase
        .from('hunt_knowledge')
        .select('content_type, title')
        .in('content_type', LIVE_TYPES)
        .eq('state_abbr', pick.state)
        .eq('effective_date', dateIso)
        .limit(LIVE_LIMIT);
      if (liveErr) console.error('alerts-on-file query failed:', liveErr.message);
      const byTitle = new Map<string, { type: string; title: string; count: number }>();
      for (const r of liveRows ?? []) {
        const ct = String(r.content_type);
        const title = liveTitle(ct, String(r.title ?? ''));
        if (!title) continue;
        const k = `${ct}|${title}`;
        const cur = byTitle.get(k);
        if (cur) cur.count += 1;
        else byTitle.set(k, { type: ct, title, count: 1 });
      }
      return Array.from(byTitle.values())
        .sort((a, b) => (LIVE_PRIORITY[a.type] ?? 9) - (LIVE_PRIORITY[b.type] ?? 9));
    })();

    const spot = await spotPromise;
    const alertsOnFile = await alertsPromise;

    // ---- Compose the line (template from facts — no LLM, no forecast) -------
    const mdLabel = monthDayLabel(dateIso);
    const zAbs = Math.abs(pick.z as number).toFixed(1);
    const dir = (pick.z as number) >= 0 ? 'warm' : 'cold';
    // Per-type phrasing: official NWS alerts read "under a Flood Watch";
    // recorded weather events / compound signals read "with … on file".
    let alertClause = '';
    if (alertsOnFile.length > 0) {
      const a0 = alertsOnFile[0];
      const extra = alertsOnFile.length - 1;
      const more = extra > 0 ? ` (+${extra} more)` : '';
      if (a0.type === 'nws-alert') alertClause = `, under a ${a0.title}${more}`;
      else if (a0.type === 'compound-risk-alert') alertClause = `, with ${a0.title.toLowerCase()} on file${more}`;
      else alertClause = `, with a ${a0.title.toLowerCase()} on file${more}`;
    }

    // Past the GHCN archive edge, day-0 is the live station feed (hunt_weather_history):
    // quote the ACTUAL day's temp with no as-of-(year) almanac framing. The as-of
    // phrasing stays ONLY where the fallback is genuinely in use (no live row on file).
    // Day-0 fallback: today's live row → yesterday's live row (labeled as
    // yesterday, never as today) → the GHCN almanac line. The as-of-(year)
    // framing stays ONLY on the archive fallback.
    const isLive = pick.day0_source === 'live';
    const isLiveYesterday = pick.day0_source === 'live-yesterday';
    const liveish = isLive || isLiveYesterday;
    const whenPhrase = dateIso === todayIso ? 'today' : `on ${fullDateLabel(dateIso)}`;
    let lede: string;
    if (isLiveYesterday) {
      const yLabel = typeof pick.as_of_date === 'string' ? monthDayLabel(pick.as_of_date as string) : 'yesterday';
      lede =
        `${mdLabel} in ${pick.name}: ${Math.round(pick.value as number)}° yesterday (${yLabel}) — ` +
        `${zAbs}σ ${dir} against its own ${pick.n_years} recorded ${mdLabel}s${alertClause}.`;
    } else if (isLive) {
      lede =
        `${mdLabel} in ${pick.name}: ${Math.round(pick.value as number)}° ${whenPhrase} — ` +
        `${zAbs}σ ${dir} against its own ${pick.n_years} recorded ${mdLabel}s${alertClause}.`;
    } else {
      lede =
        `${mdLabel} in ${pick.name}: ${Math.round(pick.value as number)}° on the most recent ` +
        `recorded ${mdLabel} (${pick.as_of_year}) — ${zAbs}σ ${dir} against its own ` +
        `${pick.n_years} years${alertClause}.`;
    }

    // The lineup sentence — "last time the moon, the tide, and the temperature
    // lined up like this" — straight from hunt-atlas-spot, outcome attached.
    const lineup = (spot?.lineup ?? null) as Record<string, unknown> | null;
    let lineupSentence: string | null = null;
    let lastOutcome: string | null = null;
    if (lineup && typeof lineup.mode === 'string') {
      const trio = lineup.mode === 'moon_tide_temp'
        ? 'the moon, the tide, and the temperature'
        : 'the moon and the temperature';
      const nMatches = Number(lineup.n_matches ?? 0);
      if (nMatches > 0 && typeof lineup.last_date === 'string') {
        const matches = (lineup.matches ?? []) as Array<Record<string, unknown>>;
        lastOutcome = typeof matches[0]?.outcome === 'string' ? (matches[0].outcome as string) : null;
        lineupSentence =
          `The last time ${trio} lined up like this here: ${fullDateLabel(lineup.last_date as string)}` +
          (lastOutcome ? ` — it ${lastOutcome}` : '') + '.';
      } else {
        lineupSentence =
          `The moon${lineup.mode === 'moon_tide_temp' ? ', the tide,' : ''} and the temperature ` +
          `have never lined up like this here in ${lineup.n_years ?? '—'} recorded years ` +
          `(${lineup.n_days_searched ?? '—'} days searched).`;
      }
    }

    // The control line — mandatory; without it the lineup is a horoscope.
    const control = (spot?.control ?? null) as Record<string, unknown> | null;
    let controlLine: string | null = null;
    if (control && typeof control.all_n === 'number') {
      const matchedClause = typeof control.matched_n === 'number' && (control.matched_n as number) > 0
        ? `; the ${control.matched_n} lineup-matched day${control.matched_n === 1 ? '' : 's'} with a recorded week after: ${control.matched_outcome_n}`
        : '';
      controlLine =
        `Control: of ${control.all_n} recorded ${mdLabel}s here (every year, matched or not), ` +
        `${control.all_outcome_n} cooled ≥5°F within the following 7 recorded days${matchedClause}. ` +
        `Recorded fact only — never a forecast.`;
    }

    const headline = lineupSentence ? `${lede} ${lineupSentence}` : lede;

    return new Response(JSON.stringify({
      date: dateIso,
      date_label: fullDateLabel(dateIso),
      month_day_label: mdLabel,
      state: pick.state,
      state_name: pick.name,
      headline,
      lede,
      lineup_sentence: lineupSentence,
      control_line: controlLine,
      parts: {
        anomaly: {
          metric: 'avg_high_f',
          value: pick.value,
          z: pick.z,
          as_of_year: pick.as_of_year,
          as_of_date: pick.as_of_date ?? null,
          baseline_mean: pick.baseline_mean,
          baseline_std: pick.baseline_std,
          n_years: pick.n_years,
          resolution: 'state',
          source: 'ghcn-daily',
          day0_source: pick.day0_source ?? 'archive',
          picked_by: `largest |z| across ${anom.count_with_data} states with data (n_years ≥ ${MIN_HEADLINE_YEARS} preferred)`,
        },
        alerts_on_file: alertsOnFile,
        lineup: lineup ? {
          mode: lineup.mode,
          last_date: lineup.last_date ?? null,
          last_outcome: lastOutcome,
          n_matches: lineup.n_matches ?? 0,
          n_years: lineup.n_years ?? null,
          n_days_searched: lineup.n_days_searched ?? null,
          tide_station: (lineup.today as Record<string, unknown> | undefined)?.tide_station ?? null,
        } : null,
        control: control ? {
          matched_n: control.matched_n ?? null,
          matched_outcome_n: control.matched_outcome_n ?? null,
          all_n: control.all_n ?? null,
          all_outcome_n: control.all_outcome_n ?? null,
          outcome: control.outcome ?? null,
        } : null,
      },
      provenance: {
        source: liveish
          ? 'live station feed (day-0, hunt_weather_history) + ghcn-daily baseline (state-level) + tide-gauge (station) + recorded alerts on file'
          : 'ghcn-daily (state-level) + tide-gauge (station) + recorded alerts on file',
        resolution: 'state',
        day0_source: pick.day0_source ?? 'archive',
        day0_basis: isLiveYesterday
          ? `live station feed — yesterday's reading (${pick.as_of_date ?? 'yesterday'}); today's row not posted yet`
          : isLive ? 'live station feed (current through yesterday)' : `as of ${pick.as_of_year}`,
        as_of_year: pick.as_of_year,
        as_of_date: pick.as_of_date ?? null,
        n_years: pick.n_years,
        moon: 'computed astronomy (no data gaps)',
        law: liveish
          ? 'Every number traces to a recorded row. Day-0 is the live station feed; the baseline is the GHCN archive.'
          : 'Every number traces to a recorded row. Almanac framing: the as-of year is in the sentence.',
      },
      nav: {
        yesterday: dateIso > FLOOR_DATE ? isoPlusDays(dateIso, -1) : null,
        tomorrow: dateIso < todayIso ? isoPlusDays(dateIso, 1) : null,
      },
      generated_at: new Date().toISOString(),
    }), { status: 200, headers: jsonHeaders });

  } catch (e) {
    return new Response(JSON.stringify({
      error: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
    }), { status: 500, headers: jsonHeaders });
  }
});

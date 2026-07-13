// hunt-morning-grader — THE MORNING LINE'S AUTO-GRADER.
//
// Product law: the product SHOWS itself being graded, win or lose. The Morning
// Line publishes a daily claim; this cron (13:00 UTC) grades every published
// line at +7 days against hunt_weather_history actuals — the same table the
// day-0 fix made the line's own basis — and writes the verdict back onto the
// morning_lines row, then embeds the grade into hunt_knowledge per the
// embedding law (content_type 'morning-line-grade').
//
// Methodology = the 07-09 14-morning retro-grade (docs/THE-WEEK.md):
//   - The falsifiable content of a line is its lineup precedent ("it cooled
//     12°F within 5 days"). The grade asks: did the ground echo the precedent —
//     same direction, ≥5°F (COOL_OUTCOME_F, the product's own control-line
//     bar), within the precedent's window — over the recorded days that
//     actually followed? The precedent's full magnitude is recorded as
//     evidence (echoed_magnitude), never required: history is not the claim.
//   - "Held steady" precedents grade as: |move| stayed < 5°F through 7 days.
//   - Never-lined-up lines make NO falsifiable claim — verdict NO_CLAIM, and
//     the anomaly's own direction is graded instead (persisted / broke against
//     the quoted baseline), stated plainly.
//   - Missing actuals that SHOULD be recorded (holes ≤ yesterday) make a line
//     UNGRADEABLE — the grade names the missing days. Days not yet written
//     (weather_history lands at 06:00 UTC for yesterday) DEFER the line to a
//     later run instead of faking a verdict.
//
// Verdicts: CONFIRMED | MISSED | NO_CLAIM | UNGRADEABLE.
//
// BACKFILL: rows for days that published before morning_lines existed are
// recomputed through hunt-morning-line's own dated path (?date=) and persisted
// with basis 'recomputed' — documented honestly: pre-day-0-fix lines are not
// byte-reproducible, so a recomputed row is TODAY'S engine reading that day.
// The daily run self-heals the last BACKFILL_DEFAULT_DAYS days (a day nobody
// visited never wrote its 'published' row); POST {"backfill_from":"YYYY-MM-DD"}
// widens the window for the one-time historical backfill.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { buildMorningLineRow, type LineupClaim } from '../_shared/morningLine.ts';

const GRADE_AT_DAYS = 7;        // a line is due once its day is 7+ days old
const AFTERMATH_DAYS = 7;       // recorded days traced after the line's day
const OUTCOME_BAR_F = 5;        // COOL_OUTCOME_F — the control line's own bar
const MAX_GRADES_PER_RUN = 10;
const BACKFILL_DEFAULT_DAYS = 10;
const PUBLISH_ERA_START = '2026-07-05'; // the Morning Line's first published day

type Verdict = 'CONFIRMED' | 'MISSED' | 'NO_CLAIM' | 'UNGRADEABLE';

interface MorningLineDbRow {
  day: string;
  state_abbr: string;
  headline: string;
  lede: string;
  quoted_temp_f: number | null;
  anomaly_sigma: number | null;
  day0_source: string;
  lineup_claim: LineupClaim | null;
  basis: string;
}

function isoTodayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function isoPlusDays(iso: string, days: number): string {
  const dt = new Date(iso + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
function monthDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Grading — pure function over the line row + the recorded days that followed
// ---------------------------------------------------------------------------

interface DayTemp { date: string; temp_high_f: number; }

interface GradeResult {
  verdict: Verdict;
  summary: string;
  evidence: Record<string, unknown>;
  defer: boolean; // trailing days not written yet — try again a later run
}

function gradeLine(
  row: MorningLineDbRow,
  temps: Map<string, number>,  // hunt_weather_history highs, day .. day+7
  yesterdayET: string,
): GradeResult {
  const claim: LineupClaim = row.lineup_claim ?? {
    kind: 'none', verb: null, magnitude_f: null, window_days: null,
    mode: null, last_date: null, last_outcome: null, n_matches: null,
    n_years: null, n_days_searched: null, anomaly_direction: null,
    baseline_mean_f: null, control: null,
  };

  // Day-0 basis: the recorded actual for the line's own day. Fall back to the
  // line's quoted temp only when the line itself was on the live basis (same
  // table, same number); an archive-basis quote is last YEAR's temp and would
  // grade against the wrong ground.
  let day0: number | null = temps.get(row.day) ?? null;
  let day0Basis = 'hunt_weather_history actual';
  if (day0 === null && row.day0_source === 'live' && row.quoted_temp_f !== null) {
    day0 = row.quoted_temp_f;
    day0Basis = 'quoted line temp (live basis; weather_history row since missing)';
  }

  // The recorded trail: day+1 .. day+7, split into recorded / hole / pending.
  const days: Array<{ date: string; days_out: number; temp_high_f: number | null; delta_f: number | null }> = [];
  const holes: string[] = [];
  const pending: string[] = [];
  for (let k = 1; k <= AFTERMATH_DAYS; k++) {
    const d = isoPlusDays(row.day, k);
    const t = temps.get(d) ?? null;
    if (t === null) {
      if (d <= yesterdayET) holes.push(d); else pending.push(d);
    }
    days.push({
      date: d, days_out: k, temp_high_f: t === null ? null : r1(t),
      delta_f: t === null || day0 === null ? null : r1(t - day0),
    });
  }
  const recorded = days.filter((d) => d.temp_high_f !== null) as
    Array<{ date: string; days_out: number; temp_high_f: number; delta_f: number | null }>;

  const evidence: Record<string, unknown> = {
    state: row.state_abbr,
    day0: { date: row.day, temp_high_f: day0 === null ? null : r1(day0), basis: day0Basis },
    days,
    missing_days: holes,
    pending_days: pending,
    outcome_bar_f: OUTCOME_BAR_F,
    claim: {
      kind: claim.kind, verb: claim.verb, magnitude_f: claim.magnitude_f,
      window_days: claim.window_days, last_outcome: claim.last_outcome,
      last_date: claim.last_date, n_matches: claim.n_matches, n_years: claim.n_years,
    },
    source: 'hunt_weather_history (state daily avg-high actuals)',
  };

  if (day0 === null) {
    // No day-0 ground to measure from.
    if (row.day > yesterdayET || pending.length === AFTERMATH_DAYS) {
      return { verdict: 'UNGRADEABLE', summary: '', evidence, defer: true };
    }
    return {
      verdict: 'UNGRADEABLE',
      summary: `no recorded actual for ${monthDay(row.day)} itself in hunt_weather_history — nothing to measure the week against.`,
      evidence, defer: false,
    };
  }

  // Movement over the recorded trail (deltas vs day-0), overall and in-window.
  const maxDropAll = recorded.length ? Math.max(...recorded.map((d) => day0! - d.temp_high_f)) : null;
  const maxRiseAll = recorded.length ? Math.max(...recorded.map((d) => d.temp_high_f - day0!)) : null;
  evidence.max_drop_f = maxDropAll === null ? null : r1(maxDropAll);
  evidence.max_rise_f = maxRiseAll === null ? null : r1(maxRiseAll);
  // The control-line outcome ("cooled ≥5°F within 7 recorded days") for
  // comparability with the base rate the line itself quoted.
  evidence.control_outcome_hit = maxDropAll !== null && maxDropAll >= OUTCOME_BAR_F;

  // ---- NO_CLAIM path: never-lined-up / thin / no lineup -------------------
  if (claim.kind !== 'precedent') {
    const why = claim.kind === 'never_lined_up'
      ? `never lined up in ${claim.n_years ?? '—'} recorded years`
      : claim.kind === 'thin'
        ? 'the precedent’s aftermath was too thin to state an outcome'
        : 'no lineup was computable for this line';
    // Grade the anomaly direction instead: did the quoted σ persist or break
    // against the baseline it was measured on?
    const baseline = claim.baseline_mean_f;
    const dir = claim.anomaly_direction;
    if (baseline === null || dir === null || recorded.length < 3) {
      if (recorded.length < 3 && pending.length > 0) {
        return { verdict: 'NO_CLAIM', summary: '', evidence, defer: true };
      }
      return {
        verdict: 'NO_CLAIM',
        summary: `no falsifiable lineup claim (${why});` +
          (recorded.length < 3
            ? ` only ${recorded.length} of the following ${AFTERMATH_DAYS} days recorded (missing: ${holes.map(monthDay).join(', ') || 'n/a'}) — anomaly follow-up unmeasured.`
            : ' anomaly baseline unavailable — follow-up unmeasured.'),
        evidence, defer: false,
      };
    }
    const crossed = recorded.find((d) =>
      dir === 'warm' ? d.temp_high_f <= baseline : d.temp_high_f >= baseline);
    const followup = crossed ? 'broke' : 'persisted';
    evidence.anomaly_followup = {
      direction: dir, baseline_mean_f: r1(baseline), result: followup,
      broke_on: crossed?.date ?? null,
      n_recorded: recorded.length,
    };
    const sigma = row.anomaly_sigma === null ? '' : `${Math.abs(row.anomaly_sigma).toFixed(1)}σ `;
    return {
      verdict: 'NO_CLAIM',
      summary: `no falsifiable lineup claim (${why}); the ${sigma}${dir} anomaly ${
        crossed
          ? `broke on ${monthDay(crossed.date)} (${r1(crossed.temp_high_f)}° vs ${r1(baseline)}° baseline)`
          : `persisted through all ${recorded.length} recorded days`
      }.`,
      evidence, defer: false,
    };
  }

  // ---- PRECEDENT path: cooled / warmed / held ------------------------------
  const window = claim.window_days ?? AFTERMATH_DAYS;
  const inWindow = recorded.filter((d) => d.days_out <= window);
  const windowHoles = holes.filter((h) => days.find((d) => d.date === h)!.days_out <= window);
  const windowPending = pending.filter((p) => days.find((d) => d.date === p)!.days_out <= window);
  const barLabel = `≥${OUTCOME_BAR_F}°F within ${window} day${window === 1 ? '' : 's'}`;

  if (claim.verb === 'cooled' || claim.verb === 'warmed') {
    const move = (d: { temp_high_f: number }): number =>
      claim.verb === 'cooled' ? day0! - d.temp_high_f : d.temp_high_f - day0!;
    const hit = inWindow.filter((d) => move(d) >= OUTCOME_BAR_F)
      .sort((a, b) => a.days_out - b.days_out)[0] ?? null;
    const best = inWindow.length ? Math.max(...inWindow.map(move)) : null;
    evidence.claim_window_best_move_f = best === null ? null : r1(best);
    evidence.echoed_magnitude = hit !== null && claim.magnitude_f !== null
      && best !== null && best >= claim.magnitude_f;

    if (hit) {
      return {
        verdict: 'CONFIRMED',
        summary: `the ground ${claim.verb} ${r1(move(hit))}°F by ${monthDay(hit.date)} (day ${hit.days_out}) — ` +
          `the precedent’s direction verified at the ${barLabel} bar (precedent: ${claim.last_outcome}).`,
        evidence, defer: false,
      };
    }
    if (windowPending.length > 0) return { verdict: 'MISSED', summary: '', evidence, defer: true };
    if (windowHoles.length > 0) {
      return {
        verdict: 'UNGRADEABLE',
        summary: `actuals missing for ${windowHoles.map(monthDay).join(', ')} — ` +
          `the recorded days never ${claim.verb} ${barLabel}, but the window has holes; no verdict.`,
        evidence, defer: false,
      };
    }
    return {
      verdict: 'MISSED',
      summary: `the following ${inWindow.length} recorded days never ${claim.verb} ${barLabel} ` +
        `(best: ${best === null ? '—' : r1(best)}°F) — the precedent (${claim.last_outcome}) did not repeat.`,
      evidence, defer: false,
    };
  }

  // held: |move| stays under the bar through all 7 days.
  const breach = recorded.find((d) => Math.abs(d.temp_high_f - day0!) >= OUTCOME_BAR_F);
  if (breach) {
    const delta = r1(breach.temp_high_f - day0);
    return {
      verdict: 'MISSED',
      summary: `the precedent said held steady, but the ground moved ${Math.abs(delta)}°F ` +
        `(${delta > 0 ? 'warmer' : 'cooler'}) by ${monthDay(breach.date)} (day ${breach.days_out}).`,
      evidence, defer: false,
    };
  }
  if (pending.length > 0) return { verdict: 'CONFIRMED', summary: '', evidence, defer: true };
  if (holes.length > 0) {
    return {
      verdict: 'UNGRADEABLE',
      summary: `actuals missing for ${holes.map(monthDay).join(', ')} — ` +
        `recorded days all held within ${OUTCOME_BAR_F}°F, but the week has holes; no verdict.`,
      evidence, defer: false,
    };
  }
  return {
    verdict: 'CONFIRMED',
    summary: `held steady as the precedent did — all ${recorded.length} recorded days stayed within ${OUTCOME_BAR_F}°F of day 0.`,
    evidence, defer: false,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const todayET = isoTodayET();
    const yesterdayET = isoPlusDays(todayET, -1);

    let backfillFrom = isoPlusDays(todayET, -BACKFILL_DEFAULT_DAYS);
    try {
      const body = await req.json();
      if (body && typeof body.backfill_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.backfill_from)) {
        backfillFrom = body.backfill_from;
      }
    } catch (_e) { /* empty body — cron default */ }
    if (backfillFrom < PUBLISH_ERA_START) backfillFrom = PUBLISH_ERA_START;

    // ---- 1) ENSURE ROWS — recompute-and-persist days with no published row --
    // Only days strictly before today: today's row belongs to hunt-morning-line
    // (basis 'published', written on the day's first live composition). A
    // recomputed row is honestly flagged: it is today's engine reading that
    // day, not the byte-for-byte line a visitor saw (pre-day-0-fix lines are
    // not byte-reproducible).
    let ensured = 0;
    let ensureSkipped = 0;
    const ensureErrors: string[] = [];
    {
      const { data: existing, error: exErr } = await supabase
        .from('morning_lines')
        .select('day')
        .gte('day', backfillFrom)
        .lt('day', todayET);
      if (exErr) {
        await logCronRun({ functionName: 'hunt-morning-grader', status: 'error', errorMessage: `morning_lines read failed: ${exErr.message}`, durationMs: Date.now() - startTime });
        return cronErrorResponse(`morning_lines read failed: ${exErr.message}`);
      }
      const have = new Set((existing ?? []).map((r: { day: string }) => String(r.day).slice(0, 10)));
      const base = Deno.env.get('SUPABASE_URL')!;
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      for (let d = backfillFrom; d < todayET; d = isoPlusDays(d, 1)) {
        if (have.has(d)) continue;
        try {
          const res = await fetch(`${base}/functions/v1/hunt-morning-line?date=${d}`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } });
          if (!res.ok) { ensureErrors.push(`${d}: hunt-morning-line ${res.status}`); continue; }
          const payload = await res.json();
          const row = buildMorningLineRow(payload, 'recomputed');
          if (!row) { ensureSkipped++; continue; } // honest empty — no line that day
          const { error: insErr } = await supabase
            .from('morning_lines')
            .upsert(row, { onConflict: 'day', ignoreDuplicates: true });
          if (insErr) ensureErrors.push(`${d}: ${insErr.message}`);
          else ensured++;
        } catch (e) {
          ensureErrors.push(`${d}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // ---- 2) GRADE — every ungraded line 7+ days old, oldest first, cap 10 ---
    const dueBefore = isoPlusDays(todayET, -GRADE_AT_DAYS);
    const { data: dueRows, error: dueErr } = await supabase
      .from('morning_lines')
      .select('day, state_abbr, headline, lede, quoted_temp_f, anomaly_sigma, day0_source, lineup_claim, basis')
      .is('grade', null)
      .lte('day', dueBefore)
      .order('day', { ascending: true })
      .limit(MAX_GRADES_PER_RUN);
    if (dueErr) {
      await logCronRun({ functionName: 'hunt-morning-grader', status: 'error', errorMessage: `due-rows read failed: ${dueErr.message}`, durationMs: Date.now() - startTime });
      return cronErrorResponse(`due-rows read failed: ${dueErr.message}`);
    }

    const verdictCounts: Record<Verdict, number> = { CONFIRMED: 0, MISSED: 0, NO_CLAIM: 0, UNGRADEABLE: 0 };
    const graded: Array<{ day: string; state: string; verdict: Verdict }> = [];
    let deferred = 0;
    let errors = 0;

    for (const raw of (dueRows ?? []) as unknown as MorningLineDbRow[]) {
      const row: MorningLineDbRow = { ...raw, day: String(raw.day).slice(0, 10) };
      try {
        const { data: tempRows, error: tErr } = await supabase
          .from('hunt_weather_history')
          .select('date, temp_high_f')
          .eq('state_abbr', row.state_abbr)
          .gte('date', row.day)
          .lte('date', isoPlusDays(row.day, AFTERMATH_DAYS))
          .order('date', { ascending: true });
        if (tErr) { errors++; console.error(`[hunt-morning-grader] actuals read failed for ${row.day}:`, tErr.message); continue; }
        const temps = new Map<string, number>();
        for (const t of (tempRows ?? []) as DayTemp[]) {
          const v = Number(t.temp_high_f);
          if (Number.isFinite(v)) temps.set(String(t.date).slice(0, 10), v);
        }

        const result = gradeLine(row, temps, yesterdayET);
        if (result.defer) { deferred++; continue; } // trail not fully written yet

        const gradeJson = {
          verdict: result.verdict,
          summary: result.summary,
          evidence: result.evidence,
          graded_at: new Date().toISOString(),
          basis: `graded at +${GRADE_AT_DAYS} days against hunt_weather_history actuals; ` +
            `line basis: ${row.basis}` +
            (row.basis === 'recomputed' ? ' (recomputed by the current engine — pre-day-0-fix lines are not byte-reproducible)' : ''),
          method: 'morning-retro-grade v1 (THE-WEEK 07-09 methodology)',
        };

        const { error: upErr } = await supabase
          .from('morning_lines')
          .update({ grade: gradeJson })
          .eq('day', row.day)
          .is('grade', null); // never overwrite a landed grade
        if (upErr) { errors++; console.error(`[hunt-morning-grader] grade write failed for ${row.day}:`, upErr.message); continue; }

        verdictCounts[result.verdict]++;
        graded.push({ day: row.day, state: row.state_abbr, verdict: result.verdict });

        // ---- THE EMBEDDING LAW — the grade goes back into the brain ---------
        // Non-fatal (idiom from hunt-alert-grader): the grade lives on
        // morning_lines; losing the embedded copy must not ungrade the line.
        try {
          const content =
            `Morning Line grade for ${row.day} (${row.state_abbr}): ${result.verdict}.\n` +
            `The line said: "${row.headline}"\n` +
            `Grade: ${result.summary || result.verdict}\n` +
            `Graded at +${GRADE_AT_DAYS} days against hunt_weather_history actuals (${row.state_abbr} avg-high, ` +
            `${row.day} through ${isoPlusDays(row.day, AFTERMATH_DAYS)}). Line basis: ${row.basis}. ` +
            `The product grades its own published claims, win or lose.`;
          const embedding = await generateEmbedding(content, 'document');
          const { error: knErr } = await supabase.from('hunt_knowledge').insert({
            title: `Morning Line Grade: ${result.verdict} — ${row.state_abbr} ${row.day}`,
            content,
            content_type: 'morning-line-grade',
            tags: ['morning-line', result.verdict.toLowerCase(), row.state_abbr],
            state_abbr: row.state_abbr,
            species: null,
            effective_date: row.day,
            embedding,
            metadata: {
              verdict: result.verdict,
              line_day: row.day,
              line_basis: row.basis,
              day0_source: row.day0_source,
              claim_kind: row.lineup_claim?.kind ?? 'none',
              summary: result.summary,
            },
          });
          if (knErr) console.error(`[hunt-morning-grader] knowledge embed failed for ${row.day} (non-fatal):`, knErr.message);
        } catch (embErr) {
          console.error(`[hunt-morning-grader] knowledge embed failed for ${row.day} (non-fatal):`, embErr);
        }
      } catch (rowErr) {
        errors++;
        console.error(`[hunt-morning-grader] error grading ${row.day}:`, rowErr);
      }
    }

    const summary = {
      ensured, ensure_skipped: ensureSkipped, ensure_errors: ensureErrors.slice(0, 5),
      graded: graded.length, verdicts: verdictCounts, grades: graded,
      deferred, errors, backfill_from: backfillFrom,
    };
    await logCronRun({
      functionName: 'hunt-morning-grader',
      status: errors > 0 || ensureErrors.length > 0 ? 'partial' : 'success',
      summary,
      durationMs: Date.now() - startTime,
    });
    return cronResponse(summary);
  } catch (error) {
    console.error('[hunt-morning-grader] Fatal error:', error);
    await logCronRun({
      functionName: 'hunt-morning-grader',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return cronErrorResponse('Internal server error');
  }
});

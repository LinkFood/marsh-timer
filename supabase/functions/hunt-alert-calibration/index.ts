import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

const ALERT_SOURCES = ['convergence-alert', 'anomaly-alert', 'disaster-watch'] as const;
const WINDOWS = [30, 60, 90] as const;

type OutcomeStatus = 'confirmed' | 'partially_confirmed' | 'missed' | 'false_alarm';

interface AggRow {
  total: number;
  confirmed: number;
  partially_confirmed: number;
  missed: number;
  false_alarm: number;
}

function emptyAgg(): AggRow {
  return { total: 0, confirmed: 0, partially_confirmed: 0, missed: 0, false_alarm: 0 };
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 10000) / 100;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const fnName = 'hunt-alert-calibration';

  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);
    let upserted = 0;
    let embedded = 0;

    for (const alertSource of ALERT_SOURCES) {
      for (const windowDays of WINDOWS) {
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
        const cutoffStr = cutoff.toISOString();

        // Query all graded outcomes for this source + window
        const { data: rows, error: qErr } = await supabase
          .from('hunt_alert_outcomes')
          .select('state_abbr, outcome_grade')
          .eq('outcome_checked', true)
          .eq('alert_source', alertSource)
          .gte('graded_at', cutoffStr);

        if (qErr) {
          console.error(`[${fnName}] Query error for ${alertSource}/${windowDays}d:`, qErr);
          continue;
        }

        if (!rows || rows.length === 0) {
          console.log(`[${fnName}] No outcomes for ${alertSource}/${windowDays}d`);
          continue;
        }

        // Aggregate by state + national (null state_abbr row)
        const byState: Record<string, AggRow> = {};
        const national = emptyAgg();

        for (const row of rows) {
          const status = row.outcome_grade as OutcomeStatus;
          const st = row.state_abbr as string | null;

          // National
          national.total++;
          if (status === 'confirmed') national.confirmed++;
          else if (status === 'partially_confirmed') national.partially_confirmed++;
          else if (status === 'missed') national.missed++;
          else if (status === 'false_alarm') national.false_alarm++;

          // Per-state
          if (st) {
            if (!byState[st]) byState[st] = emptyAgg();
            const agg = byState[st];
            agg.total++;
            if (status === 'confirmed') agg.confirmed++;
            else if (status === 'partially_confirmed') agg.partially_confirmed++;
            else if (status === 'missed') agg.missed++;
            else if (status === 'false_alarm') agg.false_alarm++;
          }
        }

        // Build upsert rows: per-state + national (state_abbr = null)
        const upsertRows: Record<string, unknown>[] = [];

        const buildRow = (stateAbbr: string | null, agg: AggRow) => {
          const accuracyRate = agg.total === 0 ? 0 : pct(agg.confirmed + agg.partially_confirmed, agg.total);
          const precisionDenom = agg.confirmed + agg.false_alarm;
          const precisionRate = precisionDenom === 0 ? 0 : pct(agg.confirmed, precisionDenom);

          return {
            alert_source: alertSource,
            state_abbr: stateAbbr,
            window_days: windowDays,
            total_alerts: agg.total,
            confirmed: agg.confirmed,
            partially_confirmed: agg.partially_confirmed,
            missed: agg.missed,
            false_alarm: agg.false_alarm,
            accuracy_rate: accuracyRate,
            precision_rate: precisionRate,
            updated_at: new Date().toISOString(),
          };
        };

        // National row
        upsertRows.push(buildRow(null, national));

        // Per-state rows
        for (const [st, agg] of Object.entries(byState)) {
          upsertRows.push(buildRow(st, agg));
        }

        // Upsert in batches of 50
        const BATCH = 50;
        for (let i = 0; i < upsertRows.length; i += BATCH) {
          const batch = upsertRows.slice(i, i + BATCH);
          const { error: upErr } = await supabase
            .from('hunt_alert_calibration')
            .upsert(batch, { onConflict: 'alert_source,state_abbr,window_days' });
          if (upErr) {
            console.error(`[${fnName}] Upsert error ${alertSource}/${windowDays}d batch ${i / BATCH}:`, upErr);
          } else {
            upserted += batch.length;
          }
        }

        // Embed national summary
        const natRow = buildRow(null, national);
        const embedText = [
          `Alert Calibration: ${alertSource} — ${windowDays}d rolling`,
          `Rolling ${windowDays}-day accuracy for ${alertSource}:`,
          `Total: ${national.total}. Confirmed: ${national.confirmed} (${pct(national.confirmed, national.total)}%). Partial: ${national.partially_confirmed} (${pct(national.partially_confirmed, national.total)}%).`,
          `Missed: ${national.missed} (${pct(national.missed, national.total)}%). False alarm: ${national.false_alarm} (${pct(national.false_alarm, national.total)}%).`,
          `Accuracy: ${natRow.accuracy_rate}%. Precision: ${natRow.precision_rate}%.`,
        ].join('\n');

        try {
          const embedding = await generateEmbedding(embedText, 'document');
          const { error: knErr } = await supabase
            .from('hunt_knowledge')
            .insert({
              title: `Alert Calibration: ${alertSource} — ${windowDays}d rolling`,
              content: embedText,
              content_type: 'alert-calibration',
              tags: ['alert-calibration', alertSource, `${windowDays}d`],
              state_abbr: null,
              species: null,
              effective_date: today,
              metadata: {
                alert_source: alertSource,
                window_days: windowDays,
                total: national.total,
                confirmed: national.confirmed,
                partially_confirmed: national.partially_confirmed,
                missed: national.missed,
                false_alarm: national.false_alarm,
                accuracy_rate: natRow.accuracy_rate,
                precision_rate: natRow.precision_rate,
              },
              embedding,
            });
          if (knErr) {
            console.error(`[${fnName}] Knowledge insert error ${alertSource}/${windowDays}d:`, knErr);
          } else {
            embedded++;
          }
        } catch (embedErr) {
          console.error(`[${fnName}] Embedding error ${alertSource}/${windowDays}d:`, embedErr);
        }
      }
    }

    const summary = {
      upserted,
      embedded,
      sources: ALERT_SOURCES.length,
      windows: WINDOWS.length,
      run_at: new Date().toISOString(),
    };

    console.log(`[${fnName}] Done. Upserted: ${upserted}, Embedded: ${embedded}`);

    await logCronRun({
      functionName: fnName,
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return successResponse(req, summary);
  } catch (error) {
    console.error(`[${fnName}] Fatal error:`, error);
    await logCronRun({
      functionName: fnName,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, 'Internal server error', 500);
  }
});

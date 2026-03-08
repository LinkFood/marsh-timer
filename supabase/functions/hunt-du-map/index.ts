import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DU_API_BASE = "https://webapi.ducks.org/migrationmap";
const DU_HEADERS = {
  'Origin': 'https://www.ducks.org',
  'Referer': 'https://www.ducks.org/migrationmap',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; DuckCountdown/1.0)',
};

const STATE_ABBRS: Record<string, string> = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA",
  "Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO",
  "Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH",
  "Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
  "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DUReport {
  reportID: number;
  country: string;
  city?: string;
  state: string;
  zip?: string;
  latitude: number;
  longitude: number;
  activityLevelID: number;
  activityLevel: string;
  timeOfDay?: string;
  weather?: string;
  temp?: string;
  windSpeed?: string;
  windDirection?: string;
  comments?: string;
  submitDate: string;
  isFieldEditor: boolean;
  flywayId?: number;
  totalVoteUp: number;
  totalVoteDown: number;
  classification?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getStateAbbr(stateName: string): string | null {
  return STATE_ABBRS[stateName] || null;
}

function toDbRow(report: DUReport) {
  return {
    report_id: report.reportID,
    submit_date: report.submitDate,
    country: report.country || 'US',
    state: report.state,
    state_abbr: getStateAbbr(report.state),
    city: report.city || null,
    zip: report.zip || null,
    latitude: report.latitude,
    longitude: report.longitude,
    activity_level: report.activityLevel,
    activity_level_id: report.activityLevelID,
    classification: report.classification || null,
    time_of_day: report.timeOfDay || null,
    weather: report.weather || null,
    temp: report.temp || null,
    wind_speed: report.windSpeed || null,
    wind_direction: report.windDirection || null,
    comments: report.comments || null,
    is_field_editor: report.isFieldEditor || false,
    flyway_id: report.flywayId || null,
    vote_up: report.totalVoteUp || 0,
    vote_down: report.totalVoteDown || 0,
  };
}

function toEmbedText(report: DUReport): string {
  const abbr = getStateAbbr(report.state) || report.state;
  const date = report.submitDate.split('T')[0];
  const parts = [
    `du_report | ${abbr} | ${date}`,
    `activity:${report.activityLevel || 'unknown'}`,
    `weather:${report.weather || 'unknown'} wind:${report.windSpeed || 'unknown'} ${report.windDirection || ''} temp:${report.temp || 'unknown'}`,
  ];
  if (report.comments) {
    parts.push(report.comments.substring(0, 500));
  }
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('[hunt-du-map] Starting weekly DU map report fetch');

    const supabase = createSupabaseClient();

    // Fetch last 7 days
    const now = new Date();
    const end = formatDate(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    const startStr = formatDate(start);

    let allReports: DUReport[] = [];

    // Iterate day by day to stay under 200 cap
    const current = new Date(start);
    while (current <= now) {
      const dateStr = formatDate(current);

      try {
        const url = `${DU_API_BASE}/reports?start=${dateStr}&end=${dateStr}`;
        const res = await fetch(url, { headers: DU_HEADERS });

        if (res.ok) {
          const data = await res.json();
          const reports: DUReport[] = Array.isArray(data) ? data : (data?.reports || []);
          if (reports.length > 0) {
            allReports = allReports.concat(reports);
            console.log(`[hunt-du-map] ${dateStr}: ${reports.length} reports`);
          }
        } else {
          console.warn(`[hunt-du-map] ${dateStr}: HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn(`[hunt-du-map] ${dateStr}: fetch error: ${err}`);
      }

      // Rate limit between requests
      await new Promise(resolve => setTimeout(resolve, 500));
      current.setDate(current.getDate() + 1);
    }

    if (allReports.length === 0) {
      console.log('[hunt-du-map] No reports found in last 7 days');
      return successResponse(req, { reports: 0, embedded: 0, range: `${startStr} to ${end}` });
    }

    console.log(`[hunt-du-map] Total reports fetched: ${allReports.length}`);

    // -----------------------------------------------------------------------
    // Upsert into hunt_du_map_reports (strip personal data)
    // -----------------------------------------------------------------------
    const dbRows = allReports.map(toDbRow);
    const BATCH_SIZE = 50;
    let upserted = 0;

    for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
      const batch = dbRows.slice(i, i + BATCH_SIZE);
      const { error: upsertErr } = await supabase
        .from('hunt_du_map_reports')
        .upsert(batch, { onConflict: 'report_id' });

      if (upsertErr) {
        console.error(`[hunt-du-map] Upsert error (batch ${i / BATCH_SIZE}):`, upsertErr);
      } else {
        upserted += batch.length;
      }
    }

    console.log(`[hunt-du-map] Upserted ${upserted} reports`);

    // -----------------------------------------------------------------------
    // Embed into hunt_knowledge
    // -----------------------------------------------------------------------
    const embedTexts = allReports.map(toEmbedText);
    let embeddingsCreated = 0;

    // Batch embed (batchEmbed handles 20-item chunks internally)
    try {
      const embeddings = await batchEmbed(embedTexts, 'document');

      if (embeddings && embeddings.length === embedTexts.length) {
        for (let i = 0; i < embeddings.length; i += BATCH_SIZE) {
          const batchRows = [];
          for (let j = i; j < Math.min(i + BATCH_SIZE, embeddings.length); j++) {
            const report = allReports[j];
            const abbr = getStateAbbr(report.state) || report.state;
            const date = report.submitDate.split('T')[0];

            batchRows.push({
              title: `DU report ${abbr} ${date} - ${report.activityLevel}`,
              content: embedTexts[j].substring(0, 2000),
              content_type: 'du_report',
              tags: [abbr, 'du_map', 'migration'],
              state_abbr: abbr.length === 2 ? abbr : null,
              metadata: {
                source: 'du_migration_map',
                report_id: report.reportID,
                submit_date: report.submitDate,
                activity_level_id: report.activityLevelID,
              },
              embedding: embeddings[j],
            });
          }

          const { error: knErr } = await supabase
            .from('hunt_knowledge')
            .insert(batchRows);

          if (knErr) {
            console.error(`[hunt-du-map] Knowledge insert error (batch ${i / BATCH_SIZE}):`, knErr);
          } else {
            embeddingsCreated += batchRows.length;
          }
        }
      } else {
        console.error(`[hunt-du-map] Embedding count mismatch: expected ${embedTexts.length}, got ${embeddings?.length ?? 0}`);
      }
    } catch (embedErr) {
      console.error('[hunt-du-map] Embedding error:', embedErr);
    }

    // -----------------------------------------------------------------------
    // Mark embedded
    // -----------------------------------------------------------------------
    if (embeddingsCreated > 0) {
      const embeddedIds = allReports.slice(0, embeddingsCreated).map(r => r.reportID);
      const { error: updateErr } = await supabase
        .from('hunt_du_map_reports')
        .update({ embedded_at: new Date().toISOString() })
        .in('report_id', embeddedIds);

      if (updateErr) {
        console.error('[hunt-du-map] embedded_at update error:', updateErr);
      }
    }

    // -----------------------------------------------------------------------
    // Done
    // -----------------------------------------------------------------------
    const summary = {
      reports: upserted,
      embedded: embeddingsCreated,
      range: `${startStr} to ${end}`,
      run_at: new Date().toISOString(),
    };
    console.log('[hunt-du-map] Complete:', JSON.stringify(summary));

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-du-map] Fatal error:', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});

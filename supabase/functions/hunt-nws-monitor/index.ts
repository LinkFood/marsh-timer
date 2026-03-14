import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';

// NWS API supports filtering by event — fetch only hunting-relevant alerts
// Split into batches to keep URLs under length limits
const EVENT_BATCHES = [
  ['Winter Storm Warning', 'Winter Storm Watch', 'Winter Weather Advisory', 'Cold Weather Advisory', 'Wind Chill Warning', 'Wind Chill Advisory'],
  ['Freeze Warning', 'Freeze Watch', 'Frost Advisory', 'Hard Freeze Warning', 'Wind Advisory', 'High Wind Warning', 'High Wind Watch'],
  ['Dense Fog Advisory', 'Blizzard Warning', 'Blizzard Watch', 'Ice Storm Warning', 'Flood Warning', 'Flood Watch', 'Flash Flood Warning'],
  ['Lake Effect Snow Warning', 'Lake Effect Snow Watch'],
];

interface NWSFeature {
  properties: {
    id: string;
    event: string;
    severity: string;
    headline: string;
    description?: string;
    onset?: string;
    expires?: string;
    areaDesc?: string;
    geocode?: {
      UGC?: string[];
    };
  };
  geometry: unknown;
}

function extractStates(ugcCodes: string[]): string[] {
  const states = new Set<string>();
  for (const ugc of ugcCodes) {
    const stateCode = ugc.substring(0, 2);
    if (stateCode.match(/^[A-Z]{2}$/)) states.add(stateCode);
  }
  return [...states];
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('[hunt-nws-monitor] Starting NWS alert scan');

    // 1. Fetch hunting-relevant NWS alerts using event type filters (avoids 2.8MB full response)
    const nwsHeaders = {
      'User-Agent': 'DuckCountdown/1.0 (duckcountdown.com)',
      'Accept': 'application/geo+json',
    };

    const relevant: NWSFeature[] = [];
    for (const batch of EVENT_BATCHES) {
      const eventParam = batch.map(e => encodeURIComponent(e)).join(',');
      const url = `https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=${eventParam}`;
      try {
        const res = await fetch(url, { headers: nwsHeaders });
        if (res.ok) {
          const data = await res.json();
          const features: NWSFeature[] = data.features || [];
          relevant.push(...features);
        } else {
          console.error(`[hunt-nws-monitor] NWS batch error: ${res.status} for events: ${batch.join(', ')}`);
        }
      } catch (e) {
        console.error(`[hunt-nws-monitor] NWS fetch error for batch:`, e);
      }
    }

    console.log(`[hunt-nws-monitor] ${relevant.length} hunting-relevant alerts`);

    if (relevant.length === 0) {
      // Still clean up expired, then return
      const supabase = createSupabaseClient();
      const { count: expiredCount } = await supabase
        .from('hunt_nws_alerts')
        .delete({ count: 'exact' })
        .lt('expires', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      console.log(`[hunt-nws-monitor] No relevant alerts. Cleaned ${expiredCount ?? 0} expired.`);
      return successResponse(req, {
        new_alerts: 0,
        total_active: 0,
        expired_cleaned: expiredCount ?? 0,
      });
    }

    const supabase = createSupabaseClient();

    // 3. Deduplicate against existing alerts
    const alertIds = relevant.map(f => f.properties.id);
    const { data: existing } = await supabase
      .from('hunt_nws_alerts')
      .select('alert_id')
      .in('alert_id', alertIds);

    const existingIds = new Set((existing || []).map(e => e.alert_id));
    const newFeatures = relevant.filter(f => !existingIds.has(f.properties.id));
    console.log(`[hunt-nws-monitor] ${newFeatures.length} new alerts after dedup`);

    // 4. Insert new alerts
    if (newFeatures.length > 0) {
      const insertRows = newFeatures.map(f => {
        const ugcCodes = f.properties.geocode?.UGC || [];
        const states = extractStates(ugcCodes);
        return {
          alert_id: f.properties.id,
          event_type: f.properties.event,
          severity: f.properties.severity,
          headline: f.properties.headline,
          description: f.properties.description?.substring(0, 2000),
          states,
          areas: f.properties.areaDesc,
          onset: f.properties.onset,
          expires: f.properties.expires,
          geometry: f.geometry,
          raw_ugc: ugcCodes,
        };
      });

      const { error: insertErr } = await supabase
        .from('hunt_nws_alerts')
        .insert(insertRows);

      if (insertErr) {
        console.error('[hunt-nws-monitor] Insert error:', insertErr);
        // Continue to embedding — partial insert may have succeeded
      } else {
        console.log(`[hunt-nws-monitor] Inserted ${insertRows.length} new alerts`);
      }

      // 5. Embed new alerts into hunt_knowledge
      try {
        await embedAlerts(supabase, newFeatures);
      } catch (embedErr) {
        console.error('[hunt-nws-monitor] Embedding failed:', embedErr);
      }
    }

    // 6. Clean up expired alerts (older than 24 hours past expiry)
    const { count: expiredCount } = await supabase
      .from('hunt_nws_alerts')
      .delete({ count: 'exact' })
      .lt('expires', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    console.log(`[hunt-nws-monitor] Cleaned ${expiredCount ?? 0} expired alerts`);

    // 7. Get total active count
    const { count: totalActive } = await supabase
      .from('hunt_nws_alerts')
      .select('*', { count: 'exact', head: true });

    const result = {
      new_alerts: newFeatures.length,
      total_active: totalActive ?? 0,
      expired_cleaned: expiredCount ?? 0,
    };

    console.log('[hunt-nws-monitor] Complete:', result);
    return successResponse(req, result);
  } catch (error) {
    console.error('[hunt-nws-monitor]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});

async function embedAlerts(
  supabase: ReturnType<typeof createSupabaseClient>,
  features: NWSFeature[],
): Promise<void> {
  const texts: string[] = [];
  const meta: { title: string; states: string[]; tags: string[]; alert_id: string; severity: string; onset?: string; expires?: string }[] = [];

  for (const f of features) {
    const ugcCodes = f.properties.geocode?.UGC || [];
    const states = extractStates(ugcCodes);
    const statesJoined = states.join(',');
    const date = f.properties.onset
      ? new Date(f.properties.onset).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const text = `nws_alert | ${statesJoined} | ${date} | type:${f.properties.event} severity:${f.properties.severity} | ${f.properties.headline}`;
    texts.push(text);
    meta.push({
      title: `${f.properties.event} - ${states[0] || 'US'}`,
      states,
      tags: [...states, 'nws', 'alert', slugify(f.properties.event)],
      alert_id: f.properties.id,
      severity: f.properties.severity,
      onset: f.properties.onset,
      expires: f.properties.expires,
    });
  }

  const embeddings = await batchEmbed(texts, 'document');

  const knowledgeRows = meta.map((item, idx) => ({
    title: item.title,
    content: texts[idx],
    content_type: 'nws-alert',
    tags: item.tags,
    embedding: embeddings[idx],
    state_abbr: item.states[0] || null,
    species: null,
    effective_date: item.onset ? item.onset.split('T')[0] : null,
    metadata: {
      alert_id: item.alert_id,
      severity: item.severity,
      onset: item.onset,
      expires: item.expires,
    },
  }));

  // Insert in batches of 50
  for (let i = 0; i < knowledgeRows.length; i += 50) {
    const batch = knowledgeRows.slice(i, i + 50);
    const { error: kErr } = await supabase
      .from('hunt_knowledge')
      .insert(batch);
    if (kErr) {
      console.error(`[hunt-nws-monitor] Knowledge insert error (batch ${i}):`, kErr);
    } else {
      console.log(`[hunt-nws-monitor] Embedded ${batch.length} alerts into hunt_knowledge`);
    }
  }
}

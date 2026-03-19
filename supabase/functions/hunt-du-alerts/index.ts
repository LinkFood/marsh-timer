import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// State name -> abbreviation mapping
// ---------------------------------------------------------------------------

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

const DU_API_BASE = "https://www.ducks.org/sites/ducksorg/contents/data/api.json";
const MAX_NEW_ARTICLES = 10;
const RATE_LIMIT_MS = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractArticleText(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || text.match(/class="[^"]*article[_-]?body[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || text.match(/class="[^"]*field-item[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || text.match(/class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const raw = articleMatch ? articleMatch[1] : text;
  let clean = raw.replace(/<[^>]+>/g, " ");
  clean = clean.replace(/\s+/g, " ").trim();
  clean = clean
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return clean;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  try {
    console.log('[hunt-du-alerts] Starting weekly DU migration alerts check');

    const supabase = createSupabaseClient();

    // 1. Get latest article date we have stored
    const { data: latestRow, error: latestErr } = await supabase
      .from('hunt_du_articles')
      .select('article_date')
      .order('article_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr) {
      console.error('[hunt-du-alerts] Error fetching latest article:', latestErr);
    }

    const latestDate = latestRow?.article_date
      ? new Date(latestRow.article_date)
      : new Date('2000-01-01');

    console.log(`[hunt-du-alerts] Latest stored article date: ${latestDate.toISOString()}`);

    // 2. Fetch first page from DU API
    const apiUrl = `${DU_API_BASE}?limit=50&offset=0`;
    console.log('[hunt-du-alerts] Fetching DU API...');
    const apiRes = await fetch(apiUrl);
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('[hunt-du-alerts] DU API error:', apiRes.status, errText);
      return errorResponse(req, 'DU API error', 502);
    }

    const apiData = await apiRes.json();
    const articles = apiData.articles || [];

    // 3. Filter for migration alerts newer than our latest
    interface DUArticle {
      uuid: string;
      title: string;
      articleDate: string;
      url: string;
      teaser: string;
      categories: { name: string }[];
      states: { name: string }[];
    }

    const newAlerts = (articles as DUArticle[]).filter((a) => {
      if (!a.url || !a.url.includes('migration-alerts')) return false;
      const articleDate = new Date(a.articleDate);
      return articleDate > latestDate;
    }).slice(0, MAX_NEW_ARTICLES);

    console.log(`[hunt-du-alerts] Found ${newAlerts.length} new migration alerts`);

    if (newAlerts.length === 0) {
      const summary = { new_articles: 0, embedded: 0, run_at: new Date().toISOString() };
      await logCronRun({ functionName: 'hunt-du-alerts', status: 'success', summary, durationMs: Date.now() - startTime });
      return successResponse(req, summary);
    }

    // 4. Process each new alert
    const embedTexts: string[] = [];
    const embedMeta: {
      uuid: string;
      title: string;
      body: string;
      states: string[];
      state_abbr: string | null;
      article_date: string;
      teaser: string;
    }[] = [];

    let articlesInserted = 0;

    for (const article of newAlerts) {
      const fullUrl = `https://www.ducks.org${article.url}`;
      let body = "";

      try {
        const pageRes = await fetch(fullUrl);
        if (pageRes.ok) {
          const html = await pageRes.text();
          body = extractArticleText(html);
        } else {
          console.warn(`[hunt-du-alerts] Failed to fetch body for ${article.uuid}: ${pageRes.status}`);
          body = article.teaser || "";
        }
      } catch (err) {
        console.warn(`[hunt-du-alerts] Error fetching body for ${article.uuid}: ${err}`);
        body = article.teaser || "";
      }

      const stateNames = article.states?.map((s) => s.name) || [];
      const firstAbbr = stateNames.length === 1 ? (STATE_ABBRS[stateNames[0]] || null) : null;
      const dateStr = article.articleDate || new Date().toISOString();

      // Insert into hunt_du_articles
      const { error: insertErr } = await supabase
        .from('hunt_du_articles')
        .upsert({
          uuid: article.uuid,
          title: article.title,
          article_date: dateStr,
          url: fullUrl,
          teaser: article.teaser || "",
          states: stateNames,
          body,
        }, { onConflict: 'uuid' });

      if (insertErr) {
        console.error(`[hunt-du-alerts] Insert error for ${article.uuid}:`, insertErr);
        continue;
      }

      articlesInserted++;

      const embedText = `du_alert | ${stateNames.join(", ")} | ${dateStr.split("T")[0]} | ${article.title} | ${article.teaser || ""}`;
      embedTexts.push(embedText);
      embedMeta.push({
        uuid: article.uuid,
        title: article.title,
        body,
        states: stateNames,
        state_abbr: firstAbbr,
        article_date: dateStr,
        teaser: article.teaser || "",
      });

      await sleep(RATE_LIMIT_MS);
    }

    // 5. Embed and insert into hunt_knowledge (batch of up to 10, well under 20 limit)
    let embeddingsCreated = 0;

    if (embedTexts.length > 0) {
      try {
        const embeddings = await batchEmbed(embedTexts, 'document');

        for (let i = 0; i < embeddings.length; i++) {
          const meta = embedMeta[i];
          const content = meta.body.length > 2000 ? meta.body.substring(0, 2000) : meta.body;

          const { error: knErr } = await supabase
            .from('hunt_knowledge')
            .insert({
              title: meta.title,
              content,
              content_type: 'du_alert',
              tags: meta.states,
              embedding: embeddings[i],
              state_abbr: meta.state_abbr,
              species: 'duck',
              effective_date: meta.article_date || null,
              metadata: {
                source: 'du_migration_alerts',
                uuid: meta.uuid,
                article_date: meta.article_date,
              },
            });

          if (knErr) {
            console.error(`[hunt-du-alerts] Knowledge insert error for ${meta.uuid}:`, knErr);
          } else {
            // Mark as embedded
            await supabase
              .from('hunt_du_articles')
              .update({ embedded_at: new Date().toISOString() })
              .eq('uuid', meta.uuid);
            embeddingsCreated++;
          }
        }
      } catch (embedErr) {
        console.error('[hunt-du-alerts] Embedding error:', embedErr);
      }
    }

    const summary = {
      new_articles: articlesInserted,
      embedded: embeddingsCreated,
      run_at: new Date().toISOString(),
    };
    console.log('[hunt-du-alerts] Complete:', JSON.stringify(summary));

    await logCronRun({
      functionName: 'hunt-du-alerts',
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-du-alerts] Fatal error:', error);
    await logCronRun({
      functionName: 'hunt-du-alerts',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, 'Internal server error', 500);
  }
});

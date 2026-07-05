import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// hunt-wikidata-ingest  (ADDITIVE INGEST)
//
// The "who/what happened here" layer for the map (Vision Rung 6 — the human
// history layer). Scrapes geolocated + dated notable items from Wikidata's
// SPARQL endpoint into the archive, embeds every one (the Embedding Law), and
// dedups by QID so re-runs add nothing twice.
//
// This function is INSERT-ONLY. It never updates or deletes existing rows.
//
// SPARQL (proven fast ~13s/200 rows; the alternation/person-join variants both
// 504 on WDQS, so we drive off P585 point-in-time which the optimizer likes):
//
//   SELECT ?item ?itemLabel ?itemDescription ?loc ?date ?type ?typeLabel WHERE {
//     ?item wdt:P17 wd:Q30 ;          # country = United States
//           wdt:P625 ?loc ;           # coordinate location (true point)
//           wdt:P585 ?date ;          # point in time (the "when it happened")
//           wdt:P31 ?type .           # instance of (for classification)
//     SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
//   }
//   ORDER BY ?item                    # stable pagination
//   LIMIT <pageSize> OFFSET <offset>
//
// Each row → embeddable text (label + description + type + date + coords),
// content_type wikidata-event | wikidata-person | wikidata-place, QID carried
// in title (for cheap dedup) and metadata (for query), lat/lng + date in
// metadata (the map's true anchor), effective_date = the event date.
// ---------------------------------------------------------------------------

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "DuckCountdown/1.0 (https://duckcountdown.com; jayhillendalepress@gmail.com) wikidata-ingest";
const SPARQL_TIMEOUT_MS = 60000; // hard 60s per WDQS request
const MAX_ITEMS_CAP = 500; // keep the first runs BOUNDED (shared IO budget)
const DEFAULT_PAGE_SIZE = 250;
const PAGE_PAUSE_MS = 2000; // throttle between SPARQL pages

// Event-signal type labels → wikidata-event, checked BEFORE place hints so
// "structure fire" / "marathon" don't fall through to "place".
const EVENT_HINTS = [
  "fire", "accident", "disaster", "battle", "war", "siege", "raid",
  "marathon", "race", "election", "incident", "attack", "massacre",
  "shooting", "bombing", "earthquake", "flood", "storm", "hurricane",
  "tornado", "derailment", "crash", "collision", "wreck", "eruption",
  "explosion", "ceremony", "festival", "game", "match", "tournament",
  "protest", "riot", "strike", "trial", "summit", "convention",
  "expedition", "launch", "eclipse", "founding", "signing", "meeting",
];

// Place-ish P31 type labels → classify as wikidata-place (coords are the item's
// own, so these are true structures/features that "happened" via founding).
const PLACE_HINTS = [
  "city", "town", "village", "county", "municipality", "settlement",
  "building", "structure", "fort", "fortification", "bridge", "dam",
  "church", "cathedral", "temple", "cemetery", "burial", "monument",
  "park", "mountain", "river", "lake", "island", "canal", "lighthouse",
  "railway station", "station", "school", "university", "hospital",
  "reservoir", "reservation", "neighborhood", "district", "site",
  "house", "mansion", "estate", "mill", "factory", "plantation",
];

interface WdRow {
  qid: string;
  label: string;
  description: string;
  lat: number;
  lng: number;
  date: string; // raw Wikidata dateTime, e.g. 1776-07-04T00:00:00Z or -0044-03-15T00:00:00Z
  typeQid: string;
  typeLabel: string;
}

function qidFromUri(uri: string): string {
  const i = uri.lastIndexOf("/");
  return i >= 0 ? uri.slice(i + 1) : uri;
}

// "Point(-73.81048 40.86617)" -> { lng, lat }
function parsePoint(wkt: string): { lat: number; lng: number } | null {
  const m = wkt.match(/Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  if (!m) return null;
  const lng = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// Parse a Wikidata dateTime into { effectiveDate, year, precision, bce }.
// CE dates -> "YYYY-MM-DD" (Postgres date-safe). BCE / year 0 -> effectiveDate
// null (kept honestly in metadata.date + metadata.bce) since a US-filtered set
// is CE in practice and BCE date-col handling is a footgun.
function parseWdDate(raw: string): {
  effectiveDate: string | null;
  year: number | null;
  bce: boolean;
} {
  // Format: [-]YYYY-MM-DDT00:00:00Z  (year may be > 4 digits / negative)
  const m = raw.match(/^(-?)(\d+)-(\d{2})-(\d{2})T/);
  if (!m) return { effectiveDate: null, year: null, bce: false };
  const bce = m[1] === "-";
  const year = parseInt(m[2], 10);
  if (bce || year < 1) {
    return { effectiveDate: null, year: bce ? -year : year, bce: true };
  }
  const mo = m[3];
  const da = m[4];
  // Wikidata year-precision dates come through as MM-DD = 01-01; still a valid
  // date to store. Precision nuance is preserved in metadata.date (raw).
  const yyyy = String(year).padStart(4, "0");
  return { effectiveDate: `${yyyy}-${mo}-${da}`, year, bce: false };
}

function classify(typeQid: string, typeLabel: string): string {
  if (typeQid === "Q5") return "wikidata-person";
  const t = (typeLabel || "").toLowerCase();
  for (const hint of EVENT_HINTS) {
    if (t.includes(hint)) return "wikidata-event";
  }
  for (const hint of PLACE_HINTS) {
    if (t.includes(hint)) return "wikidata-place";
  }
  return "wikidata-event";
}

function buildSparql(pageSize: number, offset: number): string {
  return `SELECT ?item ?itemLabel ?itemDescription ?loc ?date ?type ?typeLabel WHERE {
  ?item wdt:P17 wd:Q30 ;
        wdt:P625 ?loc ;
        wdt:P585 ?date ;
        wdt:P31 ?type .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?item
LIMIT ${pageSize} OFFSET ${offset}`;
}

async function fetchPage(pageSize: number, offset: number): Promise<WdRow[]> {
  const query = buildSparql(pageSize, offset);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPARQL_TIMEOUT_MS);
  try {
    const res = await fetch(`${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WDQS ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    const bindings: any[] = json?.results?.bindings ?? [];
    const rows: WdRow[] = [];
    for (const b of bindings) {
      const itemUri = b?.item?.value;
      const loc = b?.loc?.value;
      const rawDate = b?.date?.value;
      if (!itemUri || !loc || !rawDate) continue;
      const pt = parsePoint(loc);
      if (!pt) continue;
      rows.push({
        qid: qidFromUri(itemUri),
        label: b?.itemLabel?.value ?? "",
        description: b?.itemDescription?.value ?? "",
        lat: pt.lat,
        lng: pt.lng,
        date: rawDate,
        typeQid: b?.type?.value ? qidFromUri(b.type.value) : "",
        typeLabel: b?.typeLabel?.value ?? "",
      });
    }
    return rows;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  // --- params (bounded by construction) ---
  let limit = MAX_ITEMS_CAP;
  let pageSize = DEFAULT_PAGE_SIZE;
  let startOffset = 0;
  try {
    const body = await req.json();
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(Math.floor(body.limit), MAX_ITEMS_CAP);
    }
    if (typeof body?.pageSize === "number" && body.pageSize > 0) {
      pageSize = Math.min(Math.floor(body.pageSize), 500);
    }
    if (typeof body?.offset === "number" && body.offset >= 0) {
      startOffset = Math.floor(body.offset);
    }
  } catch (_) { /* no body — use defaults */ }

  try {
    const supabase = createSupabaseClient();

    // --- 1. Pull pages from WDQS until we have `limit` unique items ---
    const byQid = new Map<string, WdRow>();
    let offset = startOffset;
    let pagesFetched = 0;
    const maxPages = Math.ceil(limit / pageSize) + 2; // small slack for dupes

    while (byQid.size < limit && pagesFetched < maxPages) {
      const page = await fetchPage(pageSize, offset);
      pagesFetched++;
      for (const row of page) {
        if (!byQid.has(row.qid)) byQid.set(row.qid, row);
        if (byQid.size >= limit) break;
      }
      offset += pageSize;
      if (page.length < pageSize) break; // reached the end of the result set
      if (byQid.size < limit) await sleep(PAGE_PAUSE_MS);
    }

    const fetched = byQid.size;
    let candidates = Array.from(byQid.values()).slice(0, limit);

    if (candidates.length === 0) {
      const durationMs = Date.now() - startTime;
      await logCronRun({
        functionName: "hunt-wikidata-ingest",
        status: "success",
        summary: { fetched: 0, inserted: 0, skipped_existing: 0, pages: pagesFetched },
        durationMs,
      });
      return cronResponse({ fetched: 0, inserted: 0, skipped_existing: 0, durationMs });
    }

    // --- 2. Dedup against the archive by title (QID carried in title) ---
    // A title IN() over all 8M rows seq-scans and times out. Instead, narrow to
    // the wikidata subset first via the (content_type, created_at) index
    // (equality on content_type), pull its titles (a small, bounded set), and
    // dedup in memory. No full-table scan.
    const titleFor = (r: WdRow) => `wikidata:${r.qid} ${r.label}`.slice(0, 500);
    const existingTitles = new Set<string>();
    {
      const PAGE = 1000;
      let from = 0;
      // Loop past the PostgREST 1000-row cap until the subset is exhausted.
      // deno-lint-ignore no-constant-condition
      while (true) {
        const { data: existing, error: exErr } = await supabase
          .from("hunt_knowledge")
          .select("title")
          .in("content_type", ["wikidata-event", "wikidata-person", "wikidata-place"])
          .range(from, from + PAGE - 1);
        if (exErr) throw new Error(`dedup query failed: ${exErr.message}`);
        const batch = existing || [];
        for (const r of batch) existingTitles.add((r as any).title);
        if (batch.length < PAGE) break;
        from += PAGE;
      }
    }

    const fresh = candidates.filter((r) => !existingTitles.has(titleFor(r)));
    const skippedExisting = candidates.length - fresh.length;

    if (fresh.length === 0) {
      const durationMs = Date.now() - startTime;
      await logCronRun({
        functionName: "hunt-wikidata-ingest",
        status: "success",
        summary: { fetched, inserted: 0, skipped_existing: skippedExisting, pages: pagesFetched },
        durationMs,
      });
      return cronResponse({
        fetched,
        inserted: 0,
        skipped_existing: skippedExisting,
        note: "all fetched items already in the archive (idempotent re-run)",
        durationMs,
      });
    }

    // --- 3. Embed everything (batchEmbed chunks at 20 internally) + insert ---
    let totalInserted = 0;
    let errors = 0;
    const sampleInserted: any[] = [];

    // Insert in blocks of 20 so each embed call is one Voyage batch of <=20.
    for (let i = 0; i < fresh.length; i += 20) {
      const block = fresh.slice(i, i + 20);

      const texts = block.map((r) => {
        const contentType = classify(r.typeQid, r.typeLabel);
        const kind = contentType.replace("wikidata-", "");
        const desc = r.description ? ` — ${r.description}` : "";
        const when = r.date.slice(0, 10);
        return `wikidata-${kind} | ${r.label}${desc} | type: ${r.typeLabel || "unknown"} | date: ${when} | location: ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)} (United States) | source: Wikidata ${r.qid}`;
      });

      let embeddings: number[][];
      try {
        embeddings = await batchEmbed(texts);
      } catch (embErr) {
        console.error(`Embed failed for block @${i}: ${embErr}`);
        errors++;
        continue;
      }

      const rows = block.map((r, j) => {
        const contentType = classify(r.typeQid, r.typeLabel);
        const parsed = parseWdDate(r.date);
        return {
          title: titleFor(r),
          content: texts[j],
          content_type: contentType,
          tags: ["wikidata", "history", contentType.replace("wikidata-", ""),
            ...(r.typeLabel ? [r.typeLabel.toLowerCase()] : [])],
          state_abbr: null, // coords are the true anchor; state left honest-null
          species: null,
          effective_date: parsed.effectiveDate,
          metadata: {
            source: "wikidata",
            qid: r.qid,
            url: `https://www.wikidata.org/wiki/${r.qid}`,
            lat: r.lat,
            lng: r.lng,
            date: r.date,
            year: parsed.year,
            bce: parsed.bce,
            wd_type: r.typeQid,
            wd_type_label: r.typeLabel,
            label: r.label,
            description: r.description,
          },
          embedding: JSON.stringify(embeddings[j]),
        };
      });

      const { data: inserted, error: insErr } = await supabase
        .from("hunt_knowledge")
        .insert(rows)
        .select("id, title, content_type, effective_date, metadata");

      if (insErr) {
        console.error(`Insert failed for block @${i}: ${insErr.message}`);
        errors++;
      } else {
        totalInserted += rows.length;
        if (sampleInserted.length < 5 && inserted) {
          for (const row of inserted) {
            if (sampleInserted.length >= 5) break;
            sampleInserted.push(row);
          }
        }
      }

      await sleep(500); // pace the IO / Voyage budget
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-wikidata-ingest",
      status: errors > 0 ? "partial" : "success",
      summary: {
        fetched,
        inserted: totalInserted,
        skipped_existing: skippedExisting,
        pages: pagesFetched,
        errors,
      },
      durationMs,
    });

    return cronResponse({
      fetched,
      inserted: totalInserted,
      skipped_existing: skippedExisting,
      pages: pagesFetched,
      errors,
      sample: sampleInserted,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-wikidata-ingest",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});

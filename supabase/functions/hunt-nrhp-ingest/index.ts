import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';

// ---------------------------------------------------------------------------
// hunt-nrhp-ingest  (ADDITIVE INGEST)
//
// The "what's significant here" layer for the map (Vision Rung 6 — the human
// history "who/what stood here"). Scrapes the National Register of Historic
// Places point layer (NPS, public domain — US federal work) into the archive,
// embeds every one (the Embedding Law), and dedups by the NRHP reference number
// so re-runs add nothing twice.
//
// This function is INSERT-ONLY. It never updates or deletes existing rows.
//
// SOURCE (public NPS ArcGIS REST — no key):
//   https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/
//     nrhp_locations/MapServer/0/query
//   ?where=1=1
//   &outFields=NRIS_Refnum,RESNAME,ResType,Address,City,County,State,Vicinity,
//             CertDate,Is_NHL,BND_TYPE,MAP_METHOD,STATUS,NARA_URL
//   &resultOffset=<n>&resultRecordCount=<pageSize>
//   &f=geojson                      (each feature = Point [lng, lat])
//
// Each row -> embeddable text (name + type + city/county/state + listed date),
// content_type 'nrhp-place', NRIS ref carried in title (cheap dedup) + metadata,
// effective_date = the listing (certification) date, state_abbr resolved from
// the full state name, lat/lng in metadata (the map's true anchor).
//
// SENSITIVITY (hard rule): NPS deliberately generalizes coordinates for
// archaeologically sensitive / Native American / burial / sacred sites. We
// RESPECT that generalization and NEVER re-sharpen. Any record flagged sensitive
// (Address == "Address Restricted", or archaeological/burial/sacred/Native
// keywords) has its coordinate COARSENED to ~11km (1 decimal) before storage,
// the precise pair is NOT stored, and metadata.sensitive + location_generalized
// are set true. We never publish a precise location for these sites.
// ---------------------------------------------------------------------------

const NRHP_ENDPOINT =
  "https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer/0/query";
const OUT_FIELDS =
  "NRIS_Refnum,RESNAME,ResType,Address,City,County,State,Vicinity,CertDate,Is_NHL,BND_TYPE,MAP_METHOD,STATUS,NARA_URL";
const USER_AGENT =
  "DuckCountdown/1.0 (https://duckcountdown.com; jayhillendalepress@gmail.com) nrhp-ingest";
const HTTP_TIMEOUT_MS = 60000; // hard 60s per ArcGIS request
const MAX_ITEMS_CAP = 250; // BOUNDED first run (shared IO budget) — do not scale
const DEFAULT_PAGE_SIZE = 250; // ArcGIS default maxRecordCount is 1000; we ask 250
const PAGE_PAUSE_MS = 2000; // throttle between ArcGIS pages

// Archaeological / burial / sacred / Native indicators — mark sensitive even
// when the Address isn't the literal "Address Restricted" flag.
const SENSITIVE_HINTS = [
  "archeolog", "archaeolog", "burial", "ossuary", "midden", "mound",
  "pueblo", "petroglyph", "pictograph", "rock art", "rockshelter",
  "rock shelter", "village site", "sacred", "kiva", "cliff dwelling",
  "effigy", "earthwork", "shell ring", "sacred site", "traditional cultural",
];

// Full state name (as ArcGIS returns, uppercased) -> USPS abbr.
const NAME_TO_ABBR: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [abbr, { name }] of Object.entries(STATE_CENTROIDS)) {
    m[name.toUpperCase()] = abbr;
  }
  return m;
})();

interface NrhpRow {
  ref: string;
  name: string;
  resType: string;
  address: string;
  city: string;
  county: string;
  state: string; // full name, uppercase
  vicinity: string;
  certDate: string; // MM/DD/YY
  isNhl: boolean;
  bndType: string;
  status: string;
  naraUrl: string;
  lat: number;
  lng: number;
}

// "04/19/84" -> "1984-04-19". NRHP began 1966; pivot 2-digit years on the
// current year (00..26 -> 2000s, 27..99 -> 1900s). Returns null if unparseable.
function parseCertDate(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, da, yr] = m;
  let year: number;
  if (yr.length === 4) {
    year = parseInt(yr, 10);
  } else {
    const yy = parseInt(yr, 10);
    const pivot = (new Date().getFullYear() % 100) + 1; // e.g. 27 in 2026
    year = yy < pivot ? 2000 + yy : 1900 + yy;
  }
  const mm = mo.padStart(2, "0");
  const dd = da.padStart(2, "0");
  if (parseInt(mm, 10) < 1 || parseInt(mm, 10) > 12) return null;
  if (parseInt(dd, 10) < 1 || parseInt(dd, 10) > 31) return null;
  return `${String(year).padStart(4, "0")}-${mm}-${dd}`;
}

// A record is sensitive if NPS restricted its address, or its name/type carries
// an archaeological/burial/sacred/Native indicator.
function isSensitive(r: NrhpRow): boolean {
  const addr = (r.address || "").toLowerCase();
  if (addr.includes("restricted")) return true;
  const hay = `${r.name} ${r.resType}`.toLowerCase();
  return SENSITIVE_HINTS.some((h) => hay.includes(h));
}

function titleFor(r: NrhpRow): string {
  return `nrhp:${r.ref} ${r.name}`.slice(0, 500);
}

function fetchUrl(offset: number, pageSize: number): string {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: OUT_FIELDS,
    orderByFields: "NRIS_Refnum", // stable pagination
    resultOffset: String(offset),
    resultRecordCount: String(pageSize),
    f: "geojson",
  });
  return `${NRHP_ENDPOINT}?${params.toString()}`;
}

async function fetchPage(offset: number, pageSize: number): Promise<NrhpRow[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(fetchUrl(offset, pageSize), {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`NPS ArcGIS ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    // ArcGIS returns 200 with an { error: {...} } body on query errors.
    if (json?.error) {
      throw new Error(`NPS ArcGIS error: ${JSON.stringify(json.error).slice(0, 300)}`);
    }
    const features: any[] = json?.features ?? [];
    const rows: NrhpRow[] = [];
    for (const f of features) {
      const p = f?.properties ?? {};
      const g = f?.geometry;
      const ref = (p.NRIS_Refnum ?? "").toString().trim();
      if (!ref) continue; // ref number is our dedup key — skip if missing
      const coords = g?.type === "Point" ? g.coordinates : null;
      if (!coords || coords.length < 2) continue;
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat === 0 && lng === 0) continue; // null-island = no real location
      rows.push({
        ref,
        name: (p.RESNAME ?? "").toString().trim(),
        resType: (p.ResType ?? "").toString().trim(),
        address: (p.Address ?? "").toString().trim(),
        city: (p.City ?? "").toString().trim(),
        county: (p.County ?? "").toString().trim(),
        state: (p.State ?? "").toString().trim(),
        vicinity: (p.Vicinity ?? "").toString().trim(),
        certDate: (p.CertDate ?? "").toString().trim(),
        isNhl: String(p.Is_NHL ?? "").toLowerCase() === "true" ||
          String(p.Is_NHL ?? "") === "1",
        bndType: (p.BND_TYPE ?? "").toString().trim(),
        status: (p.STATUS ?? "").toString().trim(),
        naraUrl: (p.NARA_URL ?? "").toString().trim(),
        lat,
        lng,
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

    // --- 1. Pull pages from NPS ArcGIS until we have `limit` unique refs ---
    const byRef = new Map<string, NrhpRow>();
    let offset = startOffset;
    let pagesFetched = 0;
    const maxPages = Math.ceil(limit / pageSize) + 2; // small slack for dupes

    while (byRef.size < limit && pagesFetched < maxPages) {
      const page = await fetchPage(offset, pageSize);
      pagesFetched++;
      for (const row of page) {
        if (!byRef.has(row.ref)) byRef.set(row.ref, row);
        if (byRef.size >= limit) break;
      }
      offset += pageSize;
      if (page.length < pageSize) break; // reached the end of the result set
      if (byRef.size < limit) await sleep(PAGE_PAUSE_MS);
    }

    const fetched = byRef.size;
    const candidates = Array.from(byRef.values()).slice(0, limit);

    if (candidates.length === 0) {
      const durationMs = Date.now() - startTime;
      await logCronRun({
        functionName: "hunt-nrhp-ingest",
        status: "success",
        summary: { fetched: 0, inserted: 0, skipped_existing: 0, pages: pagesFetched },
        durationMs,
      });
      return cronResponse({ fetched: 0, inserted: 0, skipped_existing: 0, durationMs });
    }

    // --- 2. Dedup against the archive by title (NRIS ref carried in title) ---
    // Narrow to the nrhp-place subset first via the (content_type, created_at)
    // index (equality on content_type), pull its titles (a small, bounded set),
    // dedup in memory. No full-table scan over 8M rows.
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
          .eq("content_type", "nrhp-place")
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
        functionName: "hunt-nrhp-ingest",
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

    // --- 3. Embed everything (blocks of 20 = one Voyage batch) + insert ---
    let totalInserted = 0;
    let errors = 0;
    let sensitiveCount = 0;
    const sampleInserted: any[] = [];

    for (let i = 0; i < fresh.length; i += 20) {
      const block = fresh.slice(i, i + 20);

      const texts = block.map((r) => {
        const where = [r.city, r.county, r.state].filter(Boolean).join(", ");
        const listed = parseCertDate(r.certDate);
        const nhl = r.isNhl ? " | National Historic Landmark" : "";
        const type = r.resType || "historic place";
        return `nrhp-place | ${r.name} | type: ${type} | location: ${where}` +
          `${listed ? ` | listed: ${listed}` : ""}${nhl}` +
          ` | National Register of Historic Places (NPS) ref ${r.ref}`;
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
        const listed = parseCertDate(r.certDate);
        const sensitive = isSensitive(r);
        if (sensitive) sensitiveCount++;
        // SENSITIVITY: coarsen to ~11km (1 decimal) and never store the precise
        // pair for archaeological/burial/sacred/restricted sites. Respect NPS's
        // generalization; never re-sharpen.
        const lat = sensitive ? Math.round(r.lat * 10) / 10 : r.lat;
        const lng = sensitive ? Math.round(r.lng * 10) / 10 : r.lng;
        const abbr = NAME_TO_ABBR[r.state] ?? null;
        const url = r.naraUrl ||
          `https://npgallery.nps.gov/NRHP/GetAsset/NRHP/${r.ref}_text`;
        return {
          title: titleFor(r),
          content: texts[j],
          content_type: "nrhp-place",
          tags: ["nrhp", "history", "historic-place",
            ...(r.resType ? [r.resType.toLowerCase()] : []),
            ...(r.isNhl ? ["national-historic-landmark"] : []),
            ...(sensitive ? ["sensitive-location"] : [])],
          state_abbr: abbr,
          species: null,
          effective_date: listed,
          metadata: {
            source: "nrhp",
            ref: r.ref,
            name: r.name,
            category: r.resType || null,
            lat,
            lng,
            listed_date: listed,
            city: r.city || null,
            county: r.county || null,
            state: r.state || null,
            is_nhl: r.isNhl,
            status: r.status || null,
            url,
            sensitive,
            location_generalized: sensitive,
            location_precision: sensitive ? "~11km (coarsened, sensitive site)" : "point",
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
        if (sampleInserted.length < 6 && inserted) {
          for (const row of inserted) {
            if (sampleInserted.length >= 6) break;
            sampleInserted.push(row);
          }
        }
      }

      await sleep(500); // pace the IO / Voyage budget
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-nrhp-ingest",
      status: errors > 0 ? "partial" : "success",
      summary: {
        fetched,
        inserted: totalInserted,
        skipped_existing: skippedExisting,
        sensitive: sensitiveCount,
        pages: pagesFetched,
        errors,
      },
      durationMs,
    });

    return cronResponse({
      fetched,
      inserted: totalInserted,
      skipped_existing: skippedExisting,
      sensitive_generalized: sensitiveCount,
      pages: pagesFetched,
      errors,
      sample: sampleInserted,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-nrhp-ingest",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});

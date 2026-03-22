import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// USFWS Waterfowl Breeding Population & Habitat Survey (WBPHS)
// Source: U.S. Fish & Wildlife Service, Division of Migratory Bird Management
// "Waterfowl Population Status, 2025" — published September 2, 2025
// https://www.fws.gov/sites/default/files/documents/2025-09/waterfowl-population-status-report-2025.pdf
//
// The WBPHS is the gold standard for North American waterfowl population data.
// Aerial surveys conducted annually since 1955 across 2M+ sq mi of breeding habitat.
// Traditional survey area: Alaska, central Canada, northcentral U.S. (strata 1-18, 20-50, 75-77)
// Eastern survey area: Ontario, Quebec, Atlantic provinces, Maine (strata 51-53, 56, 62-72)
//
// No public API exists. Data is published annually in PDF reports.
// This function embeds the authoritative population estimates into hunt_knowledge.

interface SpeciesEstimate {
  species: string;
  scientificName: string;
  estimate2025: number; // in millions
  estimate2024: number; // in millions
  longTermAvg: number;  // in millions
  changeFrom2024Pct: number;
  changeFromLTAPct: number;
  nawmpObjective?: number; // NAWMP population objective in millions (from Figure 4)
  surveyArea: string;
  notes: string;
}

interface HabitatMetric {
  metric: string;
  value2025: number;
  value2024: number;
  longTermAvg: number;
  changeFrom2024Pct: number;
  changeFromLTAPct: number;
  unit: string;
  notes: string;
}

interface GooseSwanEstimate {
  population: string;
  trend10yr: string; // % change per year over most recent 10 years
  recentChange: string;
  notes: string;
}

// 2025 WBPHS traditional survey area — 10 principal duck species (Table B.3 / exec summary)
const DUCK_SPECIES: SpeciesEstimate[] = [
  {
    species: "Mallard",
    scientificName: "Anas platyrhynchos",
    estimate2025: 6.6,
    estimate2024: 6.6,
    longTermAvg: 7.9,
    changeFrom2024Pct: -1,
    changeFromLTAPct: -17,
    nawmpObjective: 7.77,
    surveyArea: "traditional",
    notes: "Most abundant and most commonly harvested waterfowl species in North America. 2025 estimate nearly equal to 2024. Remains 17% below the long-term average (1955-2024). Eastern North America mallard estimate 1.1M, similar to 2024 and 10% below LTA.",
  },
  {
    species: "Gadwall",
    scientificName: "Mareca strepera",
    estimate2025: 2.4,
    estimate2024: 2.3,
    longTermAvg: 2.1,
    changeFrom2024Pct: 6,
    changeFromLTAPct: 17,
    nawmpObjective: 2.49,
    surveyArea: "traditional",
    notes: "Population 17% above long-term average. One of the success stories — population has grown substantially since the 1960s. Gadwall have expanded their breeding range eastward.",
  },
  {
    species: "American Wigeon",
    scientificName: "Mareca americana",
    estimate2025: 3.2,
    estimate2024: 2.9,
    longTermAvg: 2.6,
    changeFrom2024Pct: 9,
    changeFromLTAPct: 22,
    nawmpObjective: 2.52,
    surveyArea: "traditional",
    notes: "Population 22% above long-term average. Similar to 2024 estimate. Strong numbers in central Alberta-NE British Columbia-NWT region.",
  },
  {
    species: "American Green-winged Teal",
    scientificName: "Anas crecca",
    estimate2025: 2.6,
    estimate2024: 2.6,
    longTermAvg: 2.6,
    changeFrom2024Pct: 0,
    changeFromLTAPct: 0,
    nawmpObjective: 2.4,
    surveyArea: "traditional",
    notes: "Population at long-term average. Similar to 2024 estimate. Eastern survey area green-winged teal estimate 0.3M, 24% below 2024.",
  },
  {
    species: "Blue-winged Teal",
    scientificName: "Spatula discors",
    estimate2025: 4.4,
    estimate2024: 4.6,
    longTermAvg: 5.1,
    changeFrom2024Pct: -4,
    changeFromLTAPct: -13,
    nawmpObjective: 5.48,
    surveyArea: "traditional",
    notes: "Similar to 2024 estimate but 13% below the long-term average. Blue-winged teal are early migrants — among the first ducks to head south in fall. Prairie drought continues to stress breeding habitat.",
  },
  {
    species: "Northern Shoveler",
    scientificName: "Spatula clypeata",
    estimate2025: 2.8,
    estimate2024: 2.8,
    longTermAvg: 2.8,
    changeFrom2024Pct: 0,
    changeFromLTAPct: 0,
    nawmpObjective: 2.99,
    surveyArea: "traditional",
    notes: "Population at long-term average. Similar to 2024. Shovelers have benefited from wetland conservation efforts in the Prairie Pothole Region.",
  },
  {
    species: "Northern Pintail",
    scientificName: "Anas acuta",
    estimate2025: 2.2,
    estimate2024: 2.0,
    longTermAvg: 3.8,
    changeFrom2024Pct: 13,
    changeFromLTAPct: -41,
    nawmpObjective: 3.15,
    surveyArea: "traditional",
    notes: "CRITICAL CONCERN: 41% below long-term average despite 13% increase from 2024. Pintails peaked at ~10M in the 1950s-70s and have been in long-term decline. Most depressed population among the 10 principal species. Prairie drought and agricultural conversion of grasslands are primary drivers.",
  },
  {
    species: "Redhead",
    scientificName: "Aythya americana",
    estimate2025: 0.9,
    estimate2024: 0.9,
    longTermAvg: 0.7,
    changeFrom2024Pct: 17,
    changeFromLTAPct: 25,
    nawmpObjective: 0.81,
    surveyArea: "traditional",
    notes: "Strong population — 25% above long-term average. Redheads are diving ducks that nest in prairie marshes. Population has recovered well from 1980s lows.",
  },
  {
    species: "Canvasback",
    scientificName: "Aythya valisineria",
    estimate2025: 0.7,
    estimate2024: 0.7,
    longTermAvg: 0.7,
    changeFrom2024Pct: 22,
    changeFromLTAPct: 0,
    nawmpObjective: 0.69,
    surveyArea: "traditional",
    notes: "Population at long-term average. Canvasbacks are a premier diving duck and an iconic waterfowl species. Numbers have been relatively stable in recent years.",
  },
  {
    species: "Scaup (Lesser and Greater combined)",
    scientificName: "Aythya affinis / A. marila",
    estimate2025: 3.7,
    estimate2024: 3.7,
    longTermAvg: 4.9,
    changeFrom2024Pct: 0,
    changeFromLTAPct: -25,
    nawmpObjective: 4.67,
    surveyArea: "traditional",
    notes: "CONCERN: 25% below long-term average. Scaup have declined from peaks of 7-8M in the 1970s-80s. Causes of decline remain under investigation — may include changes in boreal wetland quality, contaminant exposure, or reduced food availability on wintering grounds.",
  },
];

// Habitat metrics
const HABITAT_METRICS: HabitatMetric[] = [
  {
    metric: "Total May Ponds (Prairie Canada + Northcentral U.S.)",
    value2025: 4.2,
    value2024: 5.2,
    longTermAvg: 5.2,
    changeFrom2024Pct: -19,
    changeFromLTAPct: -20,
    unit: "millions",
    notes: "Lowest pond estimate since 2004. Prairie Canada ponds 2.6M (27% below LTA). Northcentral U.S. ponds 1.6M (34% below 2024). Persistent drought in the Prairie Pothole Region has depleted wetlands critical for nesting waterfowl.",
  },
  {
    metric: "Total Breeding Ducks (Traditional Survey Area)",
    value2025: 34.0,
    value2024: 34.0,
    longTermAvg: 35.4,
    changeFrom2024Pct: 0,
    changeFromLTAPct: -4,
    unit: "millions",
    notes: "Unchanged from 2024, 4% below LTA (1955-2024). Excludes scoters, eiders, long-tailed ducks, mergansers, wood ducks. Despite declining pond habitat, duck populations have shown resilience — likely due to birds shifting to areas with better water conditions.",
  },
  {
    metric: "Eastern Survey Area Total (6 species)",
    value2025: 4.8,
    value2024: 5.2,
    longTermAvg: 4.5,
    changeFrom2024Pct: -7,
    changeFromLTAPct: 6,
    unit: "millions",
    notes: "Eastern survey area (Ontario, Quebec, Atlantic provinces, Maine) — 7% below 2024 but 6% above long-term average. Includes goldeneyes, green-winged teal, mergansers, ring-necked ducks, American black ducks. Good habitat conditions in eastern Canada and Great Lakes.",
  },
];

// Goose and swan population summaries
const GOOSE_SWAN_DATA: GooseSwanEstimate[] = [
  {
    population: "Cackling Geese (Branta hutchinsii)",
    trend10yr: "-9% per year",
    recentChange: "Significant negative trend over most recent 10-year period",
    notes: "Taverner's cackling geese also declining (-4% per year).",
  },
  {
    population: "Midcontinent Population Lesser Snow Geese",
    trend10yr: "-12% per year",
    recentChange: "2025 estimate +71% above 2024 estimate",
    notes: "Despite long-term negative trend, single-year spike may reflect survey variability or shifting distribution.",
  },
  {
    population: "Greater Snow Geese (Anser caerulescens)",
    trend10yr: "-6% per year",
    recentChange: "2025 estimate -32% below 2024 estimate",
    notes: "Light goose management programs (conservation order) designed to reduce overabundant populations.",
  },
  {
    population: "Pacific Population Greater White-fronted Geese",
    trend10yr: "-6% per year",
    recentChange: "Significant negative trend",
    notes: "White-fronted geese are important harvest species in Central and Pacific flyways.",
  },
  {
    population: "Atlantic Brant (Branta bernicla)",
    trend10yr: "-4% per year",
    recentChange: "2025 estimate +19% above prior count",
    notes: "Brant are coastal geese dependent on eelgrass — habitat quality on wintering grounds is critical.",
  },
  {
    population: "Emperor Geese (Anser canagicus)",
    trend10yr: "-5% per year",
    recentChange: "2025 estimate +29% above 2024",
    notes: "Endemic to Alaska and NE Siberia. Limited hunting seasons recently reopened after decades of closure.",
  },
  {
    population: "Western Population Tundra Swans",
    trend10yr: "-7% per year",
    recentChange: "2025 count -11% below prior year",
    notes: "Tundra swans breed in Arctic Alaska and Canada, winter in Pacific and Atlantic states.",
  },
  {
    population: "Eastern Population Tundra Swans",
    trend10yr: "stable",
    recentChange: "2025 count +20% above prior year",
    notes: "Eastern tundra swans winter in Chesapeake Bay region and Carolinas.",
  },
  {
    population: "Atlantic Population Canada Geese (Branta canadensis)",
    trend10yr: "stable",
    recentChange: "+68% from prior year",
    notes: "Large increase likely reflects survey variability. Resident and migratory populations managed separately.",
  },
  {
    population: "Dusky Canada Geese (B. canadensis)",
    trend10yr: "stable",
    recentChange: "+45% from prior year",
    notes: "Breed on Copper River Delta, Alaska. Small population with dedicated management.",
  },
  {
    population: "Ross's Geese (Anser rossii)",
    trend10yr: "increasing",
    recentChange: "+217% from prior year",
    notes: "Dramatic increase likely reflects survey artifact. Ross's geese have been expanding their range and mixing with snow goose flocks.",
  },
  {
    population: "Midcontinent Population Greater White-fronted Geese",
    trend10yr: "increasing",
    recentChange: "+115% from prior year",
    notes: "Strong population. Important harvest species in Central and Mississippi flyways.",
  },
];

const SURVEY_YEAR = 2025;
const REPORT_DATE = "2025-09-02";
const CONTENT_TYPE = "usfws-breeding-survey";

function buildDuckText(sp: SpeciesEstimate): string {
  const status = sp.changeFromLTAPct <= -25 ? "CONCERN" :
    sp.changeFromLTAPct <= -10 ? "below_average" :
    sp.changeFromLTAPct >= 10 ? "above_average" : "stable";

  return `USFWS Waterfowl Breeding Population Survey ${SURVEY_YEAR} | ${sp.species} (${sp.scientificName}) | ` +
    `Population estimate: ${sp.estimate2025}M (${sp.estimate2025 * 1000}K birds) | ` +
    `2024 estimate: ${sp.estimate2024}M | Long-term average: ${sp.longTermAvg}M | ` +
    `Change from 2024: ${sp.changeFrom2024Pct > 0 ? '+' : ''}${sp.changeFrom2024Pct}% | ` +
    `Change from LTA: ${sp.changeFromLTAPct > 0 ? '+' : ''}${sp.changeFromLTAPct}% | ` +
    `Status: ${status} | Survey area: ${sp.surveyArea} | ` +
    (sp.nawmpObjective ? `NAWMP objective: ${sp.nawmpObjective}M | ` : '') +
    `${sp.notes}`;
}

function buildHabitatText(h: HabitatMetric): string {
  return `USFWS WBPHS ${SURVEY_YEAR} Habitat | ${h.metric} | ` +
    `${SURVEY_YEAR}: ${h.value2025} ${h.unit} | 2024: ${h.value2024} ${h.unit} | LTA: ${h.longTermAvg} ${h.unit} | ` +
    `Change from 2024: ${h.changeFrom2024Pct > 0 ? '+' : ''}${h.changeFrom2024Pct}% | ` +
    `Change from LTA: ${h.changeFromLTAPct > 0 ? '+' : ''}${h.changeFromLTAPct}% | ` +
    `${h.notes}`;
}

function buildGooseSwanText(g: GooseSwanEstimate): string {
  return `USFWS ${SURVEY_YEAR} Goose/Swan Survey | ${g.population} | ` +
    `10-year trend: ${g.trend10yr} | Recent change: ${g.recentChange} | ${g.notes}`;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    const entries: { text: string; meta: Record<string, unknown> }[] = [];

    // 1. Duck species estimates
    for (const sp of DUCK_SPECIES) {
      const text = buildDuckText(sp);
      entries.push({
        text,
        meta: {
          title: `USFWS WBPHS ${SURVEY_YEAR} ${sp.species}`,
          content: text,
          content_type: CONTENT_TYPE,
          tags: ["usfws", "wbphs", "breeding-survey", "population", sp.species.toLowerCase(), "duck"],
          species: "duck",
          effective_date: REPORT_DATE,
          metadata: {
            source: "usfws-wbphs",
            survey_year: SURVEY_YEAR,
            species_name: sp.species,
            scientific_name: sp.scientificName,
            estimate_millions: sp.estimate2025,
            estimate_2024_millions: sp.estimate2024,
            long_term_avg_millions: sp.longTermAvg,
            change_from_2024_pct: sp.changeFrom2024Pct,
            change_from_lta_pct: sp.changeFromLTAPct,
            nawmp_objective_millions: sp.nawmpObjective || null,
            survey_area: sp.surveyArea,
          },
        },
      });
    }

    // 2. Habitat metrics
    for (const h of HABITAT_METRICS) {
      const text = buildHabitatText(h);
      entries.push({
        text,
        meta: {
          title: `USFWS WBPHS ${SURVEY_YEAR} ${h.metric}`,
          content: text,
          content_type: CONTENT_TYPE,
          tags: ["usfws", "wbphs", "breeding-survey", "habitat", "ponds", "duck"],
          species: "duck",
          effective_date: REPORT_DATE,
          metadata: {
            source: "usfws-wbphs",
            survey_year: SURVEY_YEAR,
            metric: h.metric,
            value_2025: h.value2025,
            value_2024: h.value2024,
            long_term_avg: h.longTermAvg,
            unit: h.unit,
          },
        },
      });
    }

    // 3. Goose and swan data
    for (const g of GOOSE_SWAN_DATA) {
      const text = buildGooseSwanText(g);
      entries.push({
        text,
        meta: {
          title: `USFWS ${SURVEY_YEAR} ${g.population}`,
          content: text,
          content_type: CONTENT_TYPE,
          tags: ["usfws", "wbphs", "breeding-survey", "population", "goose", "swan"],
          species: "goose",
          effective_date: REPORT_DATE,
          metadata: {
            source: "usfws-wbphs",
            survey_year: SURVEY_YEAR,
            population: g.population,
            trend_10yr: g.trend10yr,
            recent_change: g.recentChange,
          },
        },
      });
    }

    // 4. Overall survey summary entry
    const summaryText = `USFWS Waterfowl Breeding Population & Habitat Survey ${SURVEY_YEAR} Summary | ` +
      `Published ${REPORT_DATE} | Total breeding ducks: 34.0M (unchanged from 2024, 4% below LTA) | ` +
      `Total May ponds: 4.2M (19% below 2024, 20% below LTA — lowest since 2004) | ` +
      `Mallards: 6.6M (17% below LTA) | Pintails: 2.2M (41% below LTA — most depressed species) | ` +
      `Blue-winged Teal: 4.4M (13% below LTA) | Scaup: 3.7M (25% below LTA) | ` +
      `Above-average species: Gadwall (+17%), Wigeon (+22%), Redhead (+25%) | ` +
      `At-average: Green-winged Teal, Shoveler, Canvasback | ` +
      `Habitat: Prairie drought persists, lowest pond count since 2004. Eastern Canada/Great Lakes in good condition. ` +
      `USFWS recommends liberal management frameworks for 2026-2027 season across all four flyways. ` +
      `Survey covers 2M+ sq mi of breeding habitat across Alaska, central Canada, and northcentral U.S. since 1955.`;

    entries.push({
      text: summaryText,
      meta: {
        title: `USFWS WBPHS ${SURVEY_YEAR} Annual Summary`,
        content: summaryText,
        content_type: CONTENT_TYPE,
        tags: ["usfws", "wbphs", "breeding-survey", "summary", "population", "duck", "goose"],
        species: "duck",
        effective_date: REPORT_DATE,
        metadata: {
          source: "usfws-wbphs",
          survey_year: SURVEY_YEAR,
          total_ducks_millions: 34.0,
          total_ponds_millions: 4.2,
          report_url: "https://www.fws.gov/sites/default/files/documents/2025-09/waterfowl-population-status-report-2025.pdf",
        },
      },
    });

    console.log(`Embedding ${entries.length} USFWS survey entries...`);

    let totalEmbedded = 0;
    let errors = 0;

    // Embed and upsert in batches of 20
    for (let i = 0; i < entries.length; i += 20) {
      const chunk = entries.slice(i, i + 20);
      const texts = chunk.map(e => e.text);

      try {
        const embeddings = await batchEmbed(texts);

        const rows = chunk.map((e, j) => ({
          ...e.meta,
          embedding: JSON.stringify(embeddings[j]),
        }));

        const { error: upsertError } = await supabase
          .from("hunt_knowledge")
          .upsert(rows, { onConflict: "title" });

        if (upsertError) {
          console.error(`Upsert error: ${upsertError.message}`);
          errors++;
        } else {
          totalEmbedded += rows.length;
          console.log(`  Batch ${Math.floor(i / 20) + 1}: ${rows.length} entries embedded`);
        }
      } catch (err) {
        console.error(`Embed batch error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-usfws-survey",
      status: errors > 0 ? "partial" : "success",
      summary: {
        survey_year: SURVEY_YEAR,
        duck_species: DUCK_SPECIES.length,
        habitat_metrics: HABITAT_METRICS.length,
        goose_swan_entries: GOOSE_SWAN_DATA.length,
        total_entries: entries.length,
        embedded: totalEmbedded,
        errors,
      },
      durationMs,
    });

    return successResponse(req, {
      survey_year: SURVEY_YEAR,
      total_entries: entries.length,
      embedded: totalEmbedded,
      errors,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-usfws-survey",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});

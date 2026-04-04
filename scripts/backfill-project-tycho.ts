/**
 * Backfill Project Tycho disease surveillance data into hunt_knowledge
 *
 * 125 years of weekly US disease case counts (1888-2014) for 26 diseases
 * across all 50 states. Embeds rich narratives via Voyage AI.
 *
 * DATA SOURCE: Project Tycho v2.0 (https://www.tycho.pitt.edu)
 *
 * TWO MODES:
 *   1. API mode (requires TYCHO_API_KEY from free registration at tycho.pitt.edu)
 *   2. CSV mode (fallback — download CSV manually, place at ./data/tycho/)
 *
 * EXPECTED CSV FORMAT (Project Tycho Format v1.1):
 *   Columns (comma-separated, quoted):
 *     ConditionName, ConditionSNOMED, PathogenName, PathogenTaxonID, Outcome,
 *     MedicalProcedure, CountryName, CountryISO, Admin1Name, Admin1ISO,
 *     Admin2Name, CityName, SpecialRegionName, SpecialRegionURL,
 *     PeriodStartDate, PeriodEndDate, PartOfCumulativeCountSeries,
 *     AgeRange, Gender, BiologicalSex, EthnicGroup, Race, Subpopulation,
 *     PlaceOfAquisition, DiagnosisCertainty, SourceName, CountValue
 *
 *   For CSV fallback, place files in ./data/tycho/ named like:
 *     US.38907003.csv  (one per disease, downloaded from tycho.pitt.edu)
 *   OR a single combined file:
 *     tycho-us-all.csv
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... TYCHO_API_KEY=... npx tsx scripts/backfill-project-tycho.ts
 *
 * Resume:
 *   START_DISEASE=5 START_STATE=OH START_YEAR=1950 npx tsx scripts/backfill-project-tycho.ts
 *
 * CSV fallback:
 *   CSV_DIR=./data/tycho npx tsx scripts/backfill-project-tycho.ts
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------- Config ----------

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const TYCHO_API_KEY = process.env.TYCHO_API_KEY || "";
const CSV_DIR = process.env.CSV_DIR || "";

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required");
  process.exit(1);
}

const START_DISEASE = process.env.START_DISEASE
  ? parseInt(process.env.START_DISEASE, 10)
  : 0;
const START_STATE = process.env.START_STATE || "";
const START_YEAR = process.env.START_YEAR
  ? parseInt(process.env.START_YEAR, 10)
  : 0;

const TYCHO_API_BASE = "https://www.tycho.pitt.edu/api";
const TYCHO_API_LIMIT = 20000; // max per request
const API_DELAY_MS = 1000; // 1s between API requests

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// ---------- Disease Config ----------

const DISEASES = [
  "Measles",
  "Polio",
  "Smallpox",
  "Diphtheria",
  "Pertussis",
  "Scarlet Fever",
  "Typhoid Fever",
  "Tuberculosis",
  "Influenza",
  "Pneumonia",
  "Malaria",
  "Hepatitis A",
  "Mumps",
  "Rubella",
  "Chickenpox",
  "Meningitis",
  "Syphilis",
  "Gonorrhea",
  "Whooping Cough",
  "Dysentery",
  "Cholera",
  "Yellow Fever",
  "Typhus",
  "Rabies",
  "Tetanus",
  "Encephalitis",
];

// Tycho uses SNOMED-CT condition names which may differ from common names.
// Map our disease names to likely Tycho ConditionName values.
// The API /condition endpoint returns exact names; these are best guesses
// based on SNOMED-CT conventions. The script will try exact match first,
// then partial match on the API condition list.
const DISEASE_ALIASES: Record<string, string[]> = {
  Polio: ["Poliomyelitis", "Poliomyelitis, acute", "Polio"],
  Chickenpox: ["Chickenpox", "Varicella"],
  "Whooping Cough": ["Whooping cough", "Pertussis", "Whooping Cough"],
  "Typhoid Fever": ["Typhoid fever", "Typhoid Fever", "Typhoid"],
  "Scarlet Fever": ["Scarlet fever", "Scarlet Fever"],
  Tuberculosis: ["Tuberculosis", "Pulmonary tuberculosis"],
  Meningitis: ["Meningitis", "Meningococcal disease", "Meningococcal meningitis"],
  Typhus: ["Typhus fever", "Typhus", "Epidemic typhus"],
  Encephalitis: ["Encephalitis", "Viral encephalitis"],
  "Yellow Fever": ["Yellow fever", "Yellow Fever"],
  Dysentery: ["Dysentery", "Bacillary dysentery", "Shigellosis"],
};

// Historical context for narrative enrichment
const DISEASE_CONTEXT: Record<string, string> = {
  Measles:
    "Before the introduction of the measles vaccine in 1963, virtually every child in America contracted measles, with 3-4 million cases annually.",
  Polio:
    "Poliomyelitis terrorized American families every summer. The Salk vaccine arrived in 1955, and the Sabin oral vaccine in 1961.",
  Smallpox:
    "Smallpox was eradicated globally by 1980 following a massive vaccination campaign. The last natural US case was in 1949.",
  Diphtheria:
    "Diphtheria killed thousands of children annually before widespread vaccination in the 1920s. The disease was known as 'the strangling angel of children.'",
  Pertussis:
    "Whooping cough was a leading cause of childhood death before the vaccine became widely available in the 1940s.",
  "Scarlet Fever":
    "Scarlet fever epidemics swept through American cities regularly in the late 19th and early 20th centuries, often closing schools for weeks.",
  "Typhoid Fever":
    "Typhoid fever was endemic in cities with poor water sanitation. 'Typhoid Mary' Mallon became infamous as a healthy carrier who infected dozens.",
  Tuberculosis:
    "TB was called 'the white plague' and was the leading cause of death in the US in the late 1800s. Sanatoriums dotted the American landscape.",
  Influenza:
    "The 1918 Spanish Flu killed an estimated 675,000 Americans. Influenza pandemics have struck repeatedly: 1957 Asian Flu, 1968 Hong Kong Flu.",
  Pneumonia:
    "Before antibiotics, pneumonia was called 'the captain of the men of death.' It remains a major cause of mortality among the elderly.",
  Malaria:
    "Malaria was endemic across the American South until the mid-20th century. The CDC was originally founded in 1946 to combat malaria.",
  "Hepatitis A":
    "Hepatitis A outbreaks were common before the vaccine was introduced in 1995, often spreading through contaminated food and water.",
  Mumps:
    "Mumps was a routine childhood illness before the vaccine in 1967, frequently causing outbreaks in schools and military camps.",
  Rubella:
    "A massive rubella epidemic in 1964-65 caused 12.5 million infections and 20,000 cases of congenital rubella syndrome in newborns.",
  Chickenpox:
    "Before the varicella vaccine in 1995, chickenpox infected nearly 4 million Americans annually, mostly children.",
  Meningitis:
    "Meningococcal meningitis outbreaks were feared for their rapid onset and high fatality rate, particularly in crowded living conditions.",
  Syphilis:
    "Syphilis was a major public health crisis, especially during wartime. The Tuskegee study (1932-1972) remains one of medicine's darkest chapters.",
  Gonorrhea:
    "Gonorrhea rates surged during both World Wars and have fluctuated with social changes and antibiotic resistance patterns.",
  "Whooping Cough":
    "Whooping cough was a leading killer of infants before vaccination. Its characteristic 'whoop' sound terrorized parents.",
  Dysentery:
    "Dysentery was a major killer in crowded cities and military camps, often linked to contaminated water supplies.",
  Cholera:
    "Cholera epidemics devastated American cities in the 19th century, driving major public health reforms and water treatment systems.",
  "Yellow Fever":
    "Yellow fever epidemics ravaged Southern port cities. The 1878 Memphis epidemic killed over 5,000 people and depopulated the city.",
  Typhus:
    "Typhus spread through lice in crowded, unsanitary conditions. It was a constant companion of war, poverty, and imprisonment.",
  Rabies:
    "Rabies remained a feared disease throughout American history, with Pasteur's vaccine (1885) marking a turning point in treatment.",
  Tetanus:
    "Tetanus, or 'lockjaw,' was a common and terrifying consequence of wounds before widespread vaccination in the mid-20th century.",
  Encephalitis:
    "Encephalitis outbreaks, often mosquito-borne, caused periodic epidemics of brain inflammation across the United States.",
};

// ---------- State Maps ----------

const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

const STATE_ISO_TO_ABBR: Record<string, string> = {};
for (const abbr of Object.keys(STATE_ABBR_TO_NAME)) {
  STATE_ISO_TO_ABBR[`US-${abbr}`] = abbr;
}

// Also map full state names (uppercase) to abbr for CSV parsing
const STATE_NAME_TO_ABBR: Record<string, string> = {};
for (const [abbr, name] of Object.entries(STATE_ABBR_TO_NAME)) {
  STATE_NAME_TO_ABBR[name.toUpperCase()] = abbr;
}

const ALL_STATE_ABBRS = Object.keys(STATE_ABBR_TO_NAME).sort();

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getDecade(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatWeekDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------- CSV Parsing ----------

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// ---------- Data Structures ----------

interface WeekRecord {
  disease: string;
  stateAbbr: string;
  stateName: string;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;
  caseCount: number;
  year: number;
}

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: string;
  species: null;
  effective_date: string;
  metadata: Record<string, unknown>;
  embedText: string;
}

// ---------- Narrative Builder ----------

function buildNarrative(
  record: WeekRecord,
  stateAvg: number,
): string {
  const { disease, stateName, weekStart, caseCount, year } = record;
  const weekDate = formatWeekDate(weekStart);
  const isEpidemic = stateAvg > 0 && caseCount > 2 * stateAvg;
  const diseaseLower = disease.toLowerCase();

  let narrative = `During the week of ${weekDate}, ${stateName} reported ${formatNumber(caseCount)} new cases of ${diseaseLower}.`;

  if (isEpidemic) {
    narrative += ` This represented an epidemic-level surge, more than double the state's average weekly caseload of ${formatNumber(Math.round(stateAvg))}.`;
  }

  // Add historical context based on disease and era
  const context = DISEASE_CONTEXT[disease];
  if (context) {
    // Pick era-appropriate context
    if (disease === "Influenza" && year >= 1917 && year <= 1919) {
      narrative += ` The Spanish Flu pandemic was ravaging the nation, ultimately killing an estimated 675,000 Americans.`;
    } else if (disease === "Influenza" && year >= 1957 && year <= 1958) {
      narrative += ` The Asian Flu pandemic was sweeping across the United States.`;
    } else if (disease === "Influenza" && year >= 1968 && year <= 1969) {
      narrative += ` The Hong Kong Flu pandemic was spreading across the country.`;
    } else if (disease === "Polio" && year >= 1950 && year <= 1955) {
      narrative += ` The summer polio season struck fear in parents across America. Children were kept from swimming pools and movie theaters.`;
    } else if (disease === "Polio" && year >= 1955 && year <= 1962) {
      narrative += ` The Salk vaccine, introduced in 1955, was beginning to turn the tide against poliomyelitis.`;
    } else if (disease === "Measles" && year < 1963) {
      narrative += ` Before the measles vaccine in 1963, outbreaks of this scale were expected every winter and spring.`;
    } else if (disease === "Measles" && year >= 1963 && year <= 1970) {
      narrative += ` The newly introduced measles vaccine was beginning to reduce case counts dramatically.`;
    } else if (disease === "Smallpox" && year <= 1949) {
      narrative += ` Smallpox vaccination campaigns were ongoing, though the disease still claimed victims regularly.`;
    } else if (disease === "Rubella" && year >= 1964 && year <= 1965) {
      narrative += ` A massive rubella epidemic was sweeping the nation, causing thousands of cases of birth defects.`;
    } else if (
      disease === "Syphilis" &&
      (year >= 1940 && year <= 1945)
    ) {
      narrative += ` Wartime conditions drove sexually transmitted disease rates to alarming levels across military and civilian populations.`;
    } else if (caseCount > 100) {
      // Generic high-count context
      narrative += ` ${context}`;
    }
  }

  return narrative;
}

function buildEntry(
  record: WeekRecord,
  stateAvg: number,
): PreparedEntry {
  const isEpidemic = stateAvg > 0 && record.caseCount > 2 * stateAvg;
  const decade = getDecade(record.year);

  const title = `${record.disease} ${record.stateName} Week of ${record.weekStart}`;
  const narrative = buildNarrative(record, stateAvg);

  const tags: string[] = [
    record.stateAbbr,
    record.disease.toLowerCase().replace(/\s+/g, "-"),
    "disease",
    "public-health",
    decade,
  ];
  if (isEpidemic) tags.push("epidemic");

  // Special era tags
  if (
    record.disease === "Influenza" &&
    record.year >= 1917 &&
    record.year <= 1919
  ) {
    tags.push("spanish-flu", "pandemic");
  }
  if (record.disease === "Polio" && record.year >= 1940 && record.year <= 1960) {
    tags.push("polio-era");
  }

  return {
    title,
    content: narrative,
    content_type: "disease-surveillance",
    tags,
    state_abbr: record.stateAbbr,
    species: null,
    effective_date: record.weekStart,
    metadata: {
      source: "project-tycho",
      disease: record.disease,
      state: record.stateName,
      state_abbr: record.stateAbbr,
      week_start: record.weekStart,
      week_end: record.weekEnd,
      case_count: record.caseCount,
      year: record.year,
      is_epidemic: isEpidemic,
      state_avg_weekly: Math.round(stateAvg),
    },
    embedText: narrative,
  };
}

// ---------- Embedding ----------

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VOYAGE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "voyage-3-lite",
          input: texts,
          input_type: "document",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      }
      if (res.status === 429 && attempt < retries - 1) {
        console.log(`    Rate limited, waiting ${(attempt + 1) * 30}s...`);
        await delay((attempt + 1) * 30000);
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Supabase Insert ----------

async function insertBatch(rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
          method: "POST",
          headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(chunk),
        });
        if (res.ok) break;
        if (attempt < 2) {
          console.log(`    Insert retry ${attempt + 1}/3...`);
          await delay(5000);
          continue;
        }
        const text = await res.text();
        console.error(`    Insert failed after retries: ${text}`);
      } catch (err) {
        if (attempt < 2) {
          await delay(5000);
          continue;
        }
        console.error(`    Insert fetch failed after retries: ${err}`);
      }
    }
  }
}

// ---------- Process entries (embed + insert) ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.embedText);

    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(texts);
    } catch (err) {
      console.error(
        `    Embed batch failed, skipping ${batch.length} entries: ${err}`,
      );
      continue;
    }

    const rows = batch.map((e, idx) => ({
      title: e.title,
      content: e.content,
      content_type: e.content_type,
      tags: e.tags,
      state_abbr: e.state_abbr,
      species: e.species,
      effective_date: e.effective_date,
      metadata: e.metadata,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    await insertBatch(rows);
    inserted += rows.length;

    // Pause between embed batches
    await delay(500);
  }

  return inserted;
}

// ---------- API Data Fetcher ----------

async function fetchDiseaseStateFromAPI(
  disease: string,
  stateAbbr: string,
): Promise<WeekRecord[]> {
  const conditionNames = [disease, ...(DISEASE_ALIASES[disease] || [])];
  const stateISO = `US-${stateAbbr}`;
  const stateName = STATE_ABBR_TO_NAME[stateAbbr];
  const allRecords: WeekRecord[] = [];

  for (const condName of conditionNames) {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        apikey: TYCHO_API_KEY,
        ConditionName: condName,
        CountryISO: "US",
        Admin1ISO: stateISO,
        PartOfCumulativeCountSeries: "0",
        Fatalities: "0",
        limit: String(TYCHO_API_LIMIT),
        offset: String(offset),
      });

      const url = `${TYCHO_API_BASE}/query?${params}`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          if (res.status === 404 || res.status === 400) {
            // No data for this condition name, try next alias
            break;
          }
          throw new Error(`API error: ${res.status}`);
        }

        const csvText = await res.text();
        const lines = csvText.split("\n").filter((l) => l.trim());

        if (lines.length <= 1) {
          hasMore = false;
          break;
        }

        const headers = parseCSVLine(lines[0]).map((h) => h.trim());
        const iPeriodStart = headers.indexOf("PeriodStartDate");
        const iPeriodEnd = headers.indexOf("PeriodEndDate");
        const iCountValue = headers.indexOf("CountValue");

        if (iPeriodStart === -1 || iCountValue === -1) {
          console.warn(`    Unexpected API response format for ${condName}`);
          break;
        }

        for (let i = 1; i < lines.length; i++) {
          const fields = parseCSVLine(lines[i]);
          const countStr = fields[iCountValue];
          const count = parseInt(countStr, 10);
          if (isNaN(count) || count <= 0) continue;

          const weekStart = fields[iPeriodStart]?.trim();
          const weekEnd =
            iPeriodEnd !== -1 ? fields[iPeriodEnd]?.trim() : weekStart;
          if (!weekStart) continue;

          const year = parseInt(weekStart.slice(0, 4), 10);
          if (isNaN(year)) continue;

          allRecords.push({
            disease,
            stateAbbr,
            stateName: stateName || stateAbbr,
            weekStart,
            weekEnd: weekEnd || weekStart,
            caseCount: count,
            year,
          });
        }

        // If we got a full page, there might be more
        if (lines.length - 1 >= TYCHO_API_LIMIT) {
          offset += TYCHO_API_LIMIT;
          await delay(API_DELAY_MS);
        } else {
          hasMore = false;
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.name === "AbortError"
        ) {
          console.warn(`    API timeout for ${condName} ${stateAbbr}, skipping`);
        } else {
          console.warn(`    API error for ${condName} ${stateAbbr}: ${err}`);
        }
        hasMore = false;
      }
    }

    // If we got data with this condition name, don't try aliases
    if (allRecords.length > 0) break;

    await delay(API_DELAY_MS);
  }

  return allRecords;
}

// ---------- CSV Data Loader ----------

function loadCSVData(csvDir: string): Map<string, Map<string, WeekRecord[]>> {
  // Returns: disease -> state -> records[]
  const data = new Map<string, Map<string, WeekRecord[]>>();

  if (!existsSync(csvDir)) {
    console.error(`CSV directory not found: ${csvDir}`);
    process.exit(1);
  }

  const files = readdirSync(csvDir).filter(
    (f) => f.endsWith(".csv") || f.endsWith(".tsv"),
  );

  if (files.length === 0) {
    console.error(`No CSV files found in ${csvDir}`);
    process.exit(1);
  }

  console.log(`Loading ${files.length} CSV file(s) from ${csvDir}...`);

  for (const file of files) {
    const filePath = join(csvDir, file);
    console.log(`  Reading ${file}...`);

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    if (lines.length < 2) continue;

    const headers = parseCSVLine(lines[0]).map((h) => h.trim());
    const iCondition = headers.indexOf("ConditionName");
    const iAdmin1ISO = headers.indexOf("Admin1ISO");
    const iAdmin1Name = headers.indexOf("Admin1Name");
    const iPeriodStart = headers.indexOf("PeriodStartDate");
    const iPeriodEnd = headers.indexOf("PeriodEndDate");
    const iCountValue = headers.indexOf("CountValue");
    const iCumulative = headers.indexOf("PartOfCumulativeCountSeries");
    const iFatalities = headers.indexOf("Fatalities");

    if (iCondition === -1 || iCountValue === -1 || iPeriodStart === -1) {
      console.warn(
        `  Skipping ${file} — missing required columns (ConditionName, PeriodStartDate, CountValue)`,
      );
      continue;
    }

    let parsed = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = parseCSVLine(line);

      // Skip cumulative counts — we want interval (weekly) counts
      if (iCumulative !== -1 && fields[iCumulative]?.trim() === "1") {
        skipped++;
        continue;
      }

      // Skip fatality counts — we want case counts
      // "0" means not fatalities, "1" means fatalities count
      if (iFatalities !== -1) {
        const fatVal = fields[iFatalities]?.trim();
        if (fatVal === "1" || fatVal === "Dead") {
          skipped++;
          continue;
        }
      }

      const conditionRaw = fields[iCondition]?.trim();
      if (!conditionRaw) continue;

      // Map Tycho condition name back to our disease list
      const disease = matchDisease(conditionRaw);
      if (!disease) {
        skipped++;
        continue;
      }

      // Get state abbr from Admin1ISO (US-XX) or Admin1Name
      let stateAbbr = "";
      if (iAdmin1ISO !== -1) {
        const iso = fields[iAdmin1ISO]?.trim();
        if (iso && STATE_ISO_TO_ABBR[iso]) {
          stateAbbr = STATE_ISO_TO_ABBR[iso];
        }
      }
      if (!stateAbbr && iAdmin1Name !== -1) {
        const name = fields[iAdmin1Name]?.trim().toUpperCase();
        if (name && STATE_NAME_TO_ABBR[name]) {
          stateAbbr = STATE_NAME_TO_ABBR[name];
        }
      }
      if (!stateAbbr) {
        skipped++;
        continue;
      }

      const countStr = fields[iCountValue]?.trim();
      const count = parseInt(countStr, 10);
      if (isNaN(count) || count <= 0) {
        skipped++;
        continue;
      }

      const weekStart = fields[iPeriodStart]?.trim();
      if (!weekStart) {
        skipped++;
        continue;
      }

      const weekEnd =
        iPeriodEnd !== -1 ? fields[iPeriodEnd]?.trim() || weekStart : weekStart;

      const year = parseInt(weekStart.slice(0, 4), 10);
      if (isNaN(year)) {
        skipped++;
        continue;
      }

      const stateName = STATE_ABBR_TO_NAME[stateAbbr] || stateAbbr;

      if (!data.has(disease)) data.set(disease, new Map());
      const diseaseMap = data.get(disease)!;
      if (!diseaseMap.has(stateAbbr)) diseaseMap.set(stateAbbr, []);
      diseaseMap.get(stateAbbr)!.push({
        disease,
        stateAbbr,
        stateName,
        weekStart,
        weekEnd,
        caseCount: count,
        year,
      });

      parsed++;
    }

    console.log(`  ${file}: ${formatNumber(parsed)} records parsed, ${formatNumber(skipped)} skipped`);
  }

  return data;
}

function matchDisease(conditionName: string): string | null {
  const lower = conditionName.toLowerCase();

  // Direct match
  for (const disease of DISEASES) {
    if (disease.toLowerCase() === lower) return disease;
  }

  // Alias match
  for (const [disease, aliases] of Object.entries(DISEASE_ALIASES)) {
    for (const alias of aliases) {
      if (alias.toLowerCase() === lower) return disease;
    }
  }

  // Partial match (condition name contains our disease name)
  for (const disease of DISEASES) {
    if (lower.includes(disease.toLowerCase())) return disease;
  }

  // Partial match on aliases
  for (const [disease, aliases] of Object.entries(DISEASE_ALIASES)) {
    for (const alias of aliases) {
      if (lower.includes(alias.toLowerCase())) return disease;
    }
  }

  return null;
}

// ---------- Compute state averages for epidemic detection ----------

function computeStateAverages(records: WeekRecord[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((sum, r) => sum + r.caseCount, 0);
  return total / records.length;
}

// ---------- Main: API Mode ----------

async function runAPIMode() {
  console.log("Mode: API (TYCHO_API_KEY found)");
  console.log(`Diseases: ${DISEASES.length} | States: 50 | Years: 1888-2014\n`);

  let totalInserted = 0;

  for (let di = START_DISEASE; di < DISEASES.length; di++) {
    const disease = DISEASES[di];
    console.log(`\n[${di + 1}/${DISEASES.length}] ${disease}`);
    let diseaseTotal = 0;

    for (const stateAbbr of ALL_STATE_ABBRS) {
      // Resume: skip states before START_STATE for the first disease
      if (di === START_DISEASE && START_STATE) {
        if (stateAbbr < START_STATE) continue;
      }

      const records = await fetchDiseaseStateFromAPI(disease, stateAbbr);

      // Apply year filter for resume
      const filtered =
        di === START_DISEASE && START_STATE === stateAbbr && START_YEAR > 0
          ? records.filter((r) => r.year >= START_YEAR)
          : records;

      if (filtered.length === 0) {
        continue;
      }

      // Sort by date
      filtered.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

      const stateAvg = computeStateAverages(records); // avg across ALL records, not just filtered
      const yearRange = `${filtered[0].year}-${filtered[filtered.length - 1].year}`;

      // Build entries
      const entries = filtered.map((r) => buildEntry(r, stateAvg));

      const inserted = await processEntries(entries);
      diseaseTotal += inserted;
      totalInserted += inserted;

      console.log(
        `  ${stateAbbr}: ${yearRange} -> ${formatNumber(inserted)} weeks embedded`,
      );

      await delay(API_DELAY_MS);
    }

    console.log(`  ${disease} total: ${formatNumber(diseaseTotal)} entries`);
  }

  return totalInserted;
}

// ---------- Main: CSV Mode ----------

async function runCSVMode(csvDir: string) {
  console.log(`Mode: CSV (loading from ${csvDir})`);

  const data = loadCSVData(csvDir);

  if (data.size === 0) {
    console.error("No matching disease data found in CSV files");
    process.exit(1);
  }

  const diseasesFound = [...data.keys()].sort();
  console.log(`\nDiseases found: ${diseasesFound.length}`);
  console.log(`Diseases: ${diseasesFound.join(", ")}\n`);

  let totalInserted = 0;

  for (let di = 0; di < DISEASES.length; di++) {
    const disease = DISEASES[di];

    // Resume support
    if (di < START_DISEASE) continue;

    const diseaseData = data.get(disease);
    if (!diseaseData || diseaseData.size === 0) {
      console.log(`[${di + 1}/${DISEASES.length}] ${disease} — no data`);
      continue;
    }

    console.log(`\n[${di + 1}/${DISEASES.length}] ${disease}`);
    let diseaseTotal = 0;

    const states = [...diseaseData.keys()].sort();

    for (const stateAbbr of states) {
      // Resume
      if (di === START_DISEASE && START_STATE && stateAbbr < START_STATE) {
        continue;
      }

      let records = diseaseData.get(stateAbbr)!;

      // Year filter for resume
      if (di === START_DISEASE && START_STATE === stateAbbr && START_YEAR > 0) {
        records = records.filter((r) => r.year >= START_YEAR);
      }

      if (records.length === 0) continue;

      // Sort by date
      records.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

      // Compute state average across ALL records for epidemic detection
      const allRecords = diseaseData.get(stateAbbr)!;
      const stateAvg = computeStateAverages(allRecords);

      const yearRange = `${records[0].year}-${records[records.length - 1].year}`;

      // Build entries
      const entries = records.map((r) => buildEntry(r, stateAvg));

      const inserted = await processEntries(entries);
      diseaseTotal += inserted;
      totalInserted += inserted;

      console.log(
        `  ${stateAbbr}: ${yearRange} -> ${formatNumber(inserted)} weeks embedded`,
      );
    }

    console.log(`  ${disease} total: ${formatNumber(diseaseTotal)} entries`);
  }

  return totalInserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== Project Tycho Disease Surveillance Backfill ===");
  console.log(`Diseases: ${DISEASES.length} | States: 50 | Years: 1888-2014`);

  if (START_DISEASE > 0 || START_STATE || START_YEAR > 0) {
    console.log(
      `Resume: disease=${START_DISEASE} state=${START_STATE || "(all)"} year=${START_YEAR || "(all)"}`,
    );
  }

  let totalInserted: number;

  if (CSV_DIR) {
    // Explicit CSV mode
    totalInserted = await runCSVMode(CSV_DIR);
  } else if (TYCHO_API_KEY) {
    // API mode
    totalInserted = await runAPIMode();
  } else {
    // Check for default CSV directory
    const defaultCSVDir = join(process.cwd(), "data", "tycho");
    if (existsSync(defaultCSVDir)) {
      console.log(`No TYCHO_API_KEY found, but CSV directory exists at ${defaultCSVDir}`);
      totalInserted = await runCSVMode(defaultCSVDir);
    } else {
      console.error(
        "\nNo data source available. Provide one of:\n" +
          "  1. TYCHO_API_KEY env var (register free at https://www.tycho.pitt.edu)\n" +
          "  2. CSV_DIR env var pointing to downloaded Tycho CSV files\n" +
          "  3. CSV files in ./data/tycho/\n" +
          "\nTo download CSV data:\n" +
          "  1. Register at https://www.tycho.pitt.edu\n" +
          "  2. Go to https://www.tycho.pitt.edu/data/\n" +
          "  3. Search for 'United States of America' pre-compiled datasets\n" +
          "  4. Download the Level 1 (state-level) dataset for each disease\n" +
          "  5. Place CSV files in ./data/tycho/\n" +
          "\nExpected CSV format: Project Tycho Format v1.1\n" +
          "  Key columns: ConditionName, Admin1ISO, PeriodStartDate, PeriodEndDate, CountValue\n" +
          "  Filter: PartOfCumulativeCountSeries=0, Fatalities=0\n",
      );
      process.exit(1);
    }
  }

  console.log(`\n=== Done! Total: ${formatNumber(totalInserted)} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

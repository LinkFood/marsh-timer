/**
 * Backfill astronomical data into hunt_knowledge
 * Computes moon phases, eclipses, solstices, equinoxes, meteor showers
 * for every day from 1900-01-01 to 2026-12-31.
 *
 * NO API NEEDED — all data is computed mathematically or from hardcoded catalogs.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-astronomical.ts
 *
 * Resume support:
 *   START_YEAR=2005 START_MONTH=6  — skip years/months before this
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required");
  process.exit(1);
}

const START_YEAR = process.env.START_YEAR
  ? parseInt(process.env.START_YEAR, 10)
  : null;
const START_MONTH = process.env.START_MONTH
  ? parseInt(process.env.START_MONTH, 10)
  : null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// ---------- Constants ----------

const SYNODIC_PERIOD = 29.53058867;
// Known new moon reference: January 6, 2000 at 18:14 UTC
// Julian Day 2451550.26 → Unix timestamp
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14, 0); // ms

const PHASE_NAMES: [string, number, number][] = [
  ["New Moon", 0, 1.85],
  ["Waxing Crescent", 1.85, 7.38],
  ["First Quarter", 7.38, 11.07],
  ["Waxing Gibbous", 11.07, 14.76],
  ["Full Moon", 14.76, 16.61],
  ["Waning Gibbous", 16.61, 22.14],
  ["Last Quarter", 22.14, 25.83],
  ["Waning Crescent", 25.83, 29.53],
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------- Solar Eclipses visible from US ----------

const SOLAR_ECLIPSES: { date: string; description: string }[] = [
  { date: "1918-06-08", description: "a total solar eclipse crossed the United States from Washington to Florida. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1925-01-24", description: "a total solar eclipse was visible across the Northeast United States. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1932-08-31", description: "a total solar eclipse crossed the Northeast United States. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1945-07-09", description: "a total solar eclipse crossed the Northwest United States and Canada. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1954-06-30", description: "a total solar eclipse crossed the Midwest United States. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1959-10-02", description: "an annular solar eclipse was visible across the Northeast United States. Annular eclipses reduce solar radiation and trigger brief behavioral changes in wildlife" },
  { date: "1963-07-20", description: "a total solar eclipse was visible from Alaska and Canada. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1970-03-07", description: "a total solar eclipse crossed the Southeast United States from Florida to Virginia. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1979-02-26", description: "a total solar eclipse crossed the Northwest United States from Washington to North Dakota. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1984-05-30", description: "an annular solar eclipse was visible across the Southeast United States. Annular eclipses reduce solar radiation and trigger brief behavioral changes in wildlife" },
  { date: "1991-07-11", description: "a total solar eclipse was visible from Hawaii. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "1994-05-10", description: "an annular solar eclipse crossed the Midwest and Northeast United States. Annular eclipses reduce solar radiation and trigger brief behavioral changes in wildlife" },
  { date: "2012-05-20", description: "an annular solar eclipse was visible across the Western United States. Annular eclipses reduce solar radiation and trigger brief behavioral changes in wildlife" },
  { date: "2017-08-21", description: "a total solar eclipse crossed the United States from Oregon to South Carolina. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
  { date: "2023-10-14", description: "an annular solar eclipse crossed from the Southwest to Southeast United States. Annular eclipses reduce solar radiation and trigger brief behavioral changes in wildlife" },
  { date: "2024-04-08", description: "a total solar eclipse crossed the United States from Texas to Maine. Total eclipses cause rapid temperature drops, wildlife behavioral changes, and dramatic environmental shifts lasting several minutes" },
];

// ---------- Meteor Showers ----------

interface MeteorShower {
  name: string;
  peakMonth: number; // 0-indexed
  peakDays: number[]; // day of month
  rate: string; // typical rate
  tag: string;
}

const METEOR_SHOWERS: MeteorShower[] = [
  { name: "Quadrantid", peakMonth: 0, peakDays: [3, 4], rate: "60-200 meteors per hour", tag: "quadrantids" },
  { name: "Lyrid", peakMonth: 3, peakDays: [22], rate: "10-20 meteors per hour", tag: "lyrids" },
  { name: "Eta Aquariid", peakMonth: 4, peakDays: [5, 6], rate: "20-40 meteors per hour", tag: "eta-aquariids" },
  { name: "Perseid", peakMonth: 7, peakDays: [12, 13], rate: "50-100 meteors per hour", tag: "perseids" },
  { name: "Orionid", peakMonth: 9, peakDays: [21, 22], rate: "10-20 meteors per hour", tag: "orionids" },
  { name: "Leonid", peakMonth: 10, peakDays: [17, 18], rate: "10-15 meteors per hour", tag: "leonids" },
  { name: "Geminid", peakMonth: 11, peakDays: [13, 14], rate: "120-150 meteors per hour", tag: "geminids" },
];

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function formatDateHuman(year: number, month: number, day: number): string {
  return `${MONTH_NAMES[month]} ${day}, ${year}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ---------- Moon Phase Calculation ----------

interface MoonPhase {
  phaseAge: number;
  phaseName: string;
  illumination: number;
  daysToNextFull: number;
  daysToNextNew: number;
}

function computeMoonPhase(year: number, month: number, day: number): MoonPhase {
  const dateMs = Date.UTC(year, month, day, 12, 0, 0);
  const daysSinceRef = (dateMs - NEW_MOON_REF) / (24 * 60 * 60 * 1000);

  let phaseAge = daysSinceRef % SYNODIC_PERIOD;
  if (phaseAge < 0) phaseAge += SYNODIC_PERIOD;

  // Determine phase name
  let phaseName = "Waning Crescent"; // fallback
  for (const [name, start, end] of PHASE_NAMES) {
    if (phaseAge >= start && phaseAge < end) {
      phaseName = name;
      break;
    }
  }

  // Illumination: (1 - cos(2π * phaseAge / SYNODIC)) / 2 * 100
  const illumination =
    ((1 - Math.cos((2 * Math.PI * phaseAge) / SYNODIC_PERIOD)) / 2) * 100;

  // Full moon is at SYNODIC/2 = ~14.765 days
  const fullMoonAge = SYNODIC_PERIOD / 2;
  let daysToNextFull = fullMoonAge - phaseAge;
  if (daysToNextFull < 0) daysToNextFull += SYNODIC_PERIOD;

  // New moon is at 0 days
  let daysToNextNew = SYNODIC_PERIOD - phaseAge;
  if (daysToNextNew >= SYNODIC_PERIOD) daysToNextNew = 0;

  return {
    phaseAge: Math.round(phaseAge * 10) / 10,
    phaseName,
    illumination: Math.round(illumination * 10) / 10,
    daysToNextFull: Math.round(daysToNextFull * 10) / 10,
    daysToNextNew: Math.round(daysToNextNew * 10) / 10,
  };
}

// ---------- Solstice/Equinox Calculation ----------

interface SeasonalEvent {
  date: string;
  dateHuman: string;
  name: string;
  description: string;
}

function computeSolsticesEquinoxes(year: number): SeasonalEvent[] {
  // Simple approximation — accurate to ±1 day
  // Base dates shift slightly with year due to leap year cycle
  const yearOffset = year % 4;

  const events: SeasonalEvent[] = [];

  // Spring equinox: March 20 (±1)
  const springDay = yearOffset === 0 ? 20 : yearOffset === 3 ? 20 : 20;
  events.push({
    date: formatDate(year, 2, springDay),
    dateHuman: formatDateHuman(year, 2, springDay),
    name: "Spring Equinox",
    description: `${formatDateHuman(year, 2, springDay)} was the Spring Equinox — when day and night are approximately equal in length. The equinox marks a critical transition in photoperiod, triggering migratory movements, breeding cycles, and plant emergence across the Northern Hemisphere.`,
  });

  // Summer solstice: June 20-21
  const summerDay = yearOffset === 0 ? 20 : 21;
  events.push({
    date: formatDate(year, 5, summerDay),
    dateHuman: formatDateHuman(year, 5, summerDay),
    name: "Summer Solstice",
    description: `${formatDateHuman(year, 5, summerDay)} was the Summer Solstice — the longest day of the year in the Northern Hemisphere. Maximum daylight hours mark peak photoperiod, influencing plant growth cycles, insect emergence, and animal behavior patterns.`,
  });

  // Fall equinox: September 22-23
  const fallDay = yearOffset === 0 ? 22 : yearOffset === 1 ? 22 : 23;
  events.push({
    date: formatDate(year, 8, fallDay),
    dateHuman: formatDateHuman(year, 8, fallDay),
    name: "Fall Equinox",
    description: `${formatDateHuman(year, 8, fallDay)} was the Fall Equinox — when day and night are approximately equal. Declining photoperiod triggers fall migration, leaf senescence, and preparation for winter dormancy across the Northern Hemisphere.`,
  });

  // Winter solstice: December 21-22
  const winterDay = yearOffset === 0 ? 21 : 21;
  events.push({
    date: formatDate(year, 11, winterDay),
    dateHuman: formatDateHuman(year, 11, winterDay),
    name: "Winter Solstice",
    description: `${formatDateHuman(year, 11, winterDay)} was the Winter Solstice — the shortest day of the year in the Northern Hemisphere. Minimum daylight marks peak winter conditions, influencing wildlife behavior, waterfowl distribution, and dormancy patterns.`,
  });

  return events;
}

// ---------- Entry Building ----------

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: null;
  species: null;
  effective_date: string;
  metadata: Record<string, unknown>;
  embedText: string;
}

function buildMoonEntry(year: number, month: number, day: number, moon: MoonPhase): PreparedEntry {
  const dateStr = formatDate(year, month, day);
  const dateHuman = formatDateHuman(year, month, day);

  const isNearNew = moon.phaseAge <= 1 || moon.phaseAge >= SYNODIC_PERIOD - 1;
  const isNearFull = moon.daysToNextFull <= 1 || (SYNODIC_PERIOD - moon.daysToNextFull <= 1 && moon.illumination > 95);

  let content: string;

  if (isNearFull) {
    content = `On ${dateHuman}, there was a Full Moon at ${moon.illumination}% illumination. Full moons historically correlate with increased wildlife activity and tidal extremes.`;
  } else if (isNearNew) {
    content = `On ${dateHuman}, there was a New Moon at ${moon.illumination}% illumination. New moons produce the darkest skies and minimal tidal range, affecting nocturnal wildlife behavior and feeding patterns.`;
  } else {
    const beforeFull = moon.daysToNextFull < SYNODIC_PERIOD / 2;
    const daysLabel = beforeFull
      ? `${moon.daysToNextFull} days before full`
      : `${moon.daysToNextNew} days before new`;
    content = `On ${dateHuman}, the moon was a ${moon.phaseName} at ${moon.illumination}% illumination, ${moon.phaseAge} days into the lunar cycle. The moon was ${daysLabel}.`;
  }

  const tags = ["moon", "lunar-phase", moon.phaseName.toLowerCase().replace(/\s+/g, "-")];

  return {
    title: `Moon Phase ${dateStr}`,
    content,
    content_type: "astronomical",
    tags,
    state_abbr: null,
    species: null,
    effective_date: dateStr,
    metadata: {
      source: "computed-astronomy",
      phase_name: moon.phaseName,
      illumination_pct: moon.illumination,
      phase_age_days: moon.phaseAge,
      days_to_next_full: moon.daysToNextFull,
      days_to_next_new: moon.daysToNextNew,
    },
    embedText: content,
  };
}

function buildEclipseEntry(eclipse: { date: string; description: string }): PreparedEntry {
  const [y, m, d] = eclipse.date.split("-").map(Number);
  const dateHuman = formatDateHuman(y, m - 1, d);
  const isTotal = eclipse.description.includes("total");
  const eclipseType = isTotal ? "total solar eclipse" : "annular solar eclipse";

  const content = `On ${dateHuman}, ${eclipse.description}.`;

  return {
    title: `Solar Eclipse ${eclipse.date}`,
    content,
    content_type: "astronomical-event",
    tags: ["astronomy", "eclipse", "solar-eclipse"],
    state_abbr: null,
    species: null,
    effective_date: eclipse.date,
    metadata: {
      source: "computed-astronomy",
      event_type: "solar-eclipse",
      eclipse_type: eclipseType,
    },
    embedText: content,
  };
}

function buildSolsticeEquinoxEntry(event: SeasonalEvent): PreparedEntry {
  const eventType = event.name.toLowerCase().includes("solstice") ? "solstice" : "equinox";

  return {
    title: `${event.name} ${event.date.slice(0, 4)}`,
    content: event.description,
    content_type: "astronomical-event",
    tags: ["astronomy", eventType, event.name.toLowerCase().replace(/\s+/g, "-")],
    state_abbr: null,
    species: null,
    effective_date: event.date,
    metadata: {
      source: "computed-astronomy",
      event_type: eventType,
      season_event: event.name,
    },
    embedText: event.description,
  };
}

function buildMeteorShowerEntry(shower: MeteorShower, year: number, day: number, moon: MoonPhase): PreparedEntry {
  const dateStr = formatDate(year, shower.peakMonth, day);
  const dateHuman = formatDateHuman(year, shower.peakMonth, day);

  const moonImpact = moon.illumination > 50
    ? `which would have reduced visible meteor counts`
    : `providing favorable dark skies for viewing`;

  const content = `The ${shower.name} meteor shower peaked on ${dateHuman}, with the moon at ${moon.illumination}% illumination (${moon.phaseName}), ${moonImpact}. The ${shower.name}s typically produce ${shower.rate} under dark skies.`;

  return {
    title: `${shower.name} Meteor Shower ${year}`,
    content,
    content_type: "astronomical-event",
    tags: ["astronomy", "meteor-shower", shower.tag],
    state_abbr: null,
    species: null,
    effective_date: dateStr,
    metadata: {
      source: "computed-astronomy",
      event_type: "meteor-shower",
      shower_name: shower.name,
      peak_rate: shower.rate,
      moon_illumination: moon.illumination,
      moon_phase: moon.phaseName,
    },
    embedText: content,
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

// ---------- Supabase upsert ----------

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
        if (res.status >= 500 && attempt < 2) {
          console.log(`  Insert retry ${attempt + 1}/3...`);
          await delay(5000);
          continue;
        }
        const text = await res.text();
        console.error(`  Insert failed: ${res.status} ${text}`);
        break;
      } catch (err) {
        if (attempt < 2) {
          await delay(5000);
          continue;
        }
        console.error(`  Insert fetch failed after retries: ${err}`);
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

    await delay(500);
  }

  return inserted;
}

// ---------- Generate entries for a year/month ----------

function generateMonthEntries(year: number, month: number): PreparedEntry[] {
  const entries: PreparedEntry[] = [];
  const days = daysInMonth(year, month);

  for (let day = 1; day <= days; day++) {
    const moon = computeMoonPhase(year, month, day);
    entries.push(buildMoonEntry(year, month, day, moon));
  }

  return entries;
}

function generateYearEvents(year: number): PreparedEntry[] {
  const entries: PreparedEntry[] = [];

  // Solstices and equinoxes
  const seasonal = computeSolsticesEquinoxes(year);
  for (const event of seasonal) {
    entries.push(buildSolsticeEquinoxEntry(event));
  }

  // Solar eclipses
  for (const eclipse of SOLAR_ECLIPSES) {
    const [ey] = eclipse.date.split("-").map(Number);
    if (ey === year) {
      entries.push(buildEclipseEntry(eclipse));
    }
  }

  // Meteor showers
  for (const shower of METEOR_SHOWERS) {
    // Use first peak day for the entry
    const peakDay = shower.peakDays[0];
    const moon = computeMoonPhase(year, shower.peakMonth, peakDay);
    entries.push(buildMeteorShowerEntry(shower, year, peakDay, moon));
  }

  return entries;
}

// ---------- Main ----------

async function main() {
  const startYear = START_YEAR || 1900;
  const startMonth = START_MONTH ? START_MONTH - 1 : 0; // Convert 1-indexed to 0-indexed
  const endYear = 2026;

  console.log(`=== Astronomical Data Backfill (${startYear}-${endYear}) ===`);

  let totalInserted = 0;

  for (let year = startYear; year <= endYear; year++) {
    console.log(`\n--- ${year} ---`);

    let yearMoonCount = 0;
    let yearEventCount = 0;

    // Generate and process moon phases month by month
    const firstMonth = year === startYear ? startMonth : 0;
    for (let month = firstMonth; month < 12; month++) {
      const moonEntries = generateMonthEntries(year, month);
      yearMoonCount += moonEntries.length;

      try {
        const inserted = await processEntries(moonEntries);
        totalInserted += inserted;
      } catch (err) {
        console.error(`  ${year}-${pad2(month + 1)} moon phases failed: ${err}`);
      }
    }

    // Generate and process special events for the year
    // Only if we're processing from January (or events fall after our start month)
    const eventEntries = generateYearEvents(year);
    const filteredEvents = year === startYear && startMonth > 0
      ? eventEntries.filter((e) => {
          const eventMonth = parseInt(e.effective_date.split("-")[1], 10) - 1;
          return eventMonth >= startMonth;
        })
      : eventEntries;

    yearEventCount = filteredEvents.length;

    if (filteredEvents.length > 0) {
      try {
        const inserted = await processEntries(filteredEvents);
        totalInserted += inserted;
      } catch (err) {
        console.error(`  ${year} events failed: ${err}`);
      }
    }

    console.log(`  ${yearMoonCount} moon phases + ${yearEventCount} events -> ${yearMoonCount + yearEventCount} embedded`);
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

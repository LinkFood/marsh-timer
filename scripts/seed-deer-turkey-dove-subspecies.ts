/**
 * Seed hunt_knowledge with deer, turkey, and dove subspecies behavioral knowledge
 * Expands species intelligence to cover all huntable subspecies for these three species.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/seed-deer-turkey-dove-subspecies.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) { const data = await res.json(); return data.embedding; }
      if (res.status >= 500 && attempt < retries - 1) { await new Promise(r => setTimeout(r, (attempt+1)*5000)); continue; }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) { await new Promise(r => setTimeout(r, (attempt+1)*10000)); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  if (USE_EDGE_FN) {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedViaEdgeFn(text, retries));
      await new Promise(r => setTimeout(r, 100));
    }
    return results;
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      }
      if (res.status === 429 && attempt < retries - 1) { await new Promise(r => setTimeout(r, (attempt+1)*30000)); continue; }
      if (res.status >= 500 && attempt < retries - 1) { await new Promise(r => setTimeout(r, (attempt+1)*5000)); continue; }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) { await new Promise(r => setTimeout(r, (attempt+1)*10000)); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function upsertKnowledgeBatch(entries: {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  species: string | null;
  effective_date: string | null;
  embedding: number[];
}[]) {
  const rows = entries.map((e) => ({
    title: e.title,
    content: e.content,
    content_type: e.content_type,
    tags: e.tags,
    species: e.species,
    effective_date: e.effective_date,
    embedding: JSON.stringify(e.embedding),
  }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`  Batch upsert failed: ${await res.text()}`);
  }
}

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  species: string | null;
  effective_date: string | null;
  richText: string;
}

async function processBatch(batch: PreparedEntry[]): Promise<number> {
  const texts = batch.map((e) => e.richText);
  const embeddings = await batchEmbed(texts);

  const entries = batch.map((e, i) => ({
    title: e.title,
    content: e.content,
    content_type: e.content_type,
    tags: e.tags,
    species: e.species,
    effective_date: e.effective_date,
    embedding: embeddings[i],
  }));

  await upsertKnowledgeBatch(entries);
  return entries.length;
}

// ============================================================
// DEER SUBSPECIES BEHAVIOR
// ============================================================

const deerSubspeciesEntries: PreparedEntry[] = [
  // Whitetail Deer
  {
    title: "whitetail deer: habitat and range",
    content: "Whitetail deer are the most popular big game animal in North America, found in all lower 48 states. They prefer edge habitat — the transition zones between woods and fields where cover meets food. Agricultural areas with woodlots, creek bottoms, and fence rows are prime whitetail country.",
    content_type: "species-behavior",
    tags: ["deer", "whitetail", "habitat", "range", "edge-habitat", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "whitetail deer habitat range | most popular big game, all lower 48, edge habitat between woods and fields, agricultural areas, woodlots, creek bottoms",
  },
  {
    title: "whitetail deer: rut behavior",
    content: "Whitetail deer rut peaks in November in most areas, driven by photoperiod (day length) not temperature. Bucks respond strongly to cold fronts during the rut — cold snaps increase daytime movement significantly. Scrapes, rubs, and chasing behavior intensify in the pre-rut (late October) and peak rut (mid-November).",
    content_type: "species-behavior",
    tags: ["deer", "whitetail", "rut", "photoperiod", "cold-front", "november", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "whitetail deer rut behavior | peaks November, driven by photoperiod not temperature, cold fronts increase movement, scrapes rubs chasing pre-rut late October",
  },
  {
    title: "whitetail deer: hunting pressure and movement patterns",
    content: "Whitetail deer bedding and feeding patterns shift dramatically with hunting pressure. Pressured deer become nocturnal, moving primarily in the last 30 minutes of daylight and first 30 minutes of dawn. Mature bucks use thick cover corridors between bedding and feeding areas and avoid open areas during daylight.",
    content_type: "species-behavior",
    tags: ["deer", "whitetail", "pressure", "movement", "nocturnal", "bedding", "feeding", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "whitetail deer hunting pressure | become nocturnal under pressure, move last/first 30 minutes of light, mature bucks use thick cover corridors, avoid open areas",
  },

  // Mule Deer
  {
    title: "mule deer: habitat and range",
    content: "Mule deer are a western species found in open country — sagebrush flats, mountain meadows, desert scrub, and high prairie. Larger than whitetail deer with distinctive large ears and a black-tipped tail. They browse more than they graze, feeding on shrubs, forbs, and woody vegetation rather than agricultural crops.",
    content_type: "species-behavior",
    tags: ["deer", "mule-deer", "habitat", "western", "open-country", "sagebrush", "browse", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "mule deer habitat range | western states, open country, sagebrush flats, mountain meadows, desert scrub, larger than whitetail, browse more than graze",
  },
  {
    title: "mule deer: rut and migration",
    content: "Mule deer rut later than whitetail — mid-November through December in most areas. They migrate between summer and winter ranges, sometimes covering 100+ miles. Winter range is typically lower elevation with less snow. Stotting (pronking) is their distinctive escape behavior — bouncing with all four feet hitting the ground simultaneously.",
    content_type: "species-behavior",
    tags: ["deer", "mule-deer", "rut", "migration", "stotting", "winter-range", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "mule deer rut migration | rut mid-November to December, migrate 100+ miles summer to winter range, stotting pronking escape behavior, lower elevation winter",
  },

  // Blacktail Deer
  {
    title: "blacktail deer: habitat and range",
    content: "Blacktail deer are a Pacific Coast subspecies of mule deer — both Columbian blacktail (CA, OR, WA) and Sitka blacktail (AK). They live in dense rainforest habitat and thick coastal brush. Smaller than mule deer with a very limited range. Extremely difficult to hunt due to thick vegetative cover — still-hunting and spot-and-stalk in old-growth timber is the primary method.",
    content_type: "species-behavior",
    tags: ["deer", "blacktail", "habitat", "pacific-coast", "rainforest", "dense-cover", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "blacktail deer habitat range | Pacific Coast subspecies of mule deer, Columbian and Sitka, dense rainforest, CA OR WA AK, difficult to hunt, thick cover",
  },
  {
    title: "blacktail deer: behavior and hunting",
    content: "Blacktail deer are homebodies — they have very small home ranges compared to other deer species, often staying within a 1-2 square mile area their entire lives. Rainy weather actually increases daytime movement as blacktails are adapted to wet conditions. Clearcuts and logging roads create edge habitat that concentrates blacktails.",
    content_type: "species-behavior",
    tags: ["deer", "blacktail", "behavior", "home-range", "rain", "clearcut", "hunting", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "blacktail deer behavior hunting | small home ranges 1-2 sq miles, rain increases daytime movement, clearcuts and logging roads create edge habitat",
  },

  // Coues Deer
  {
    title: "coues deer: habitat and range",
    content: "Coues deer are the smallest North American deer — a tiny whitetail subspecies of the Southwest found in Arizona, New Mexico, and northern Mexico. They live in rugged mountain terrain, preferring oak woodlands and rocky canyons between 4,000 and 9,000 feet elevation. Often called the 'grey ghost' due to how well they blend into their environment.",
    content_type: "species-behavior",
    tags: ["deer", "coues", "habitat", "southwest", "arizona", "mountain", "smallest", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "coues deer habitat range | smallest North American deer, whitetail subspecies, AZ NM Mexico, rugged mountain terrain, oak woodlands, 4000-9000 feet, grey ghost",
  },
  {
    title: "coues deer: hunting methods",
    content: "Coues deer hunting is primarily a glassing game — hunters sit on ridgetops and glass for hours with high-quality binoculars and spotting scopes, searching for deer bedded in shaded pockets on hillsides. Extremely wary with exceptional eyesight. Spot-and-stalk across steep terrain is the standard method. Considered one of the most challenging North American big game hunts.",
    content_type: "species-behavior",
    tags: ["deer", "coues", "hunting", "glassing", "spot-and-stalk", "wary", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "coues deer hunting methods | glassing game, sit on ridgetops, binoculars and spotting scopes, extremely wary, spot-and-stalk steep terrain, most challenging hunt",
  },

  // Axis Deer
  {
    title: "axis deer: range and breeding",
    content: "Axis deer are an invasive/exotic species in Texas and Hawaii, originally from India. Unlike native deer, axis have no fixed rut — they breed year-round, meaning bucks can be in hard antler any month. Their distinctive spotted coat is retained into adulthood. Growing populations in the Texas Hill Country and parts of Hawaii.",
    content_type: "species-behavior",
    tags: ["deer", "axis", "invasive", "exotic", "texas", "hawaii", "year-round-breeding", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "axis deer range breeding | invasive exotic, Texas and Hawaii, no fixed rut breed year-round, spotted coat adults, growing populations Texas Hill Country",
  },
  {
    title: "axis deer: habitat and hunting",
    content: "Axis deer prefer open grassland and savanna habitat, avoiding dense timber. They are herd animals often found in groups of 10-50. Not native to North America but legally hunted in Texas with no closed season on most properties. Very alert with excellent senses — considered harder to approach than native whitetail due to constant herd vigilance.",
    content_type: "species-behavior",
    tags: ["deer", "axis", "habitat", "grassland", "herd", "hunting", "texas", "behavior", "knowledge"],
    species: "deer",
    effective_date: null,
    richText: "axis deer habitat hunting | open grassland savanna, herd animals 10-50, no closed season Texas, harder to approach than whitetail, constant herd vigilance",
  },
];

// ============================================================
// TURKEY SUBSPECIES BEHAVIOR
// ============================================================

const turkeySubspeciesEntries: PreparedEntry[] = [
  // Eastern Wild Turkey
  {
    title: "eastern wild turkey: range and habitat",
    content: "Eastern wild turkey is the most common and widespread subspecies, found across the entire eastern United States. They prefer mixed hardwood-pine forest with openings — mature oaks for mast, pines for roosting, and open fields or clearings for strutting and feeding. Gobble peaks March-April depending on latitude.",
    content_type: "species-behavior",
    tags: ["turkey", "eastern", "habitat", "range", "hardwood", "gobble", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "eastern wild turkey range habitat | most common subspecies, eastern US, mixed hardwood-pine forest, mature oaks, gobble peaks March-April",
  },
  {
    title: "eastern wild turkey: calling and weather response",
    content: "Eastern turkeys respond well to calling — aggressive yelps, cuts, and cackles can pull toms into range. They are affected by rain: gobbling drops significantly in heavy rain, but light drizzle can actually increase ground-level activity as birds move to open areas. Cold snaps in early spring can delay gobbling activity by days.",
    content_type: "species-behavior",
    tags: ["turkey", "eastern", "calling", "rain", "weather", "gobble", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "eastern wild turkey calling weather | respond well to calling, heavy rain kills gobbling, light drizzle increases ground activity, cold snaps delay gobbling",
  },
  {
    title: "eastern wild turkey: roosting and daily pattern",
    content: "Eastern turkeys roost in hardwood trees along ridges and creek bottoms, flying up before dark and pitching down at first light. Morning gobbling from the roost is the primary location tool for hunters. Birds typically fly down, strut/breed, then move to feeding areas by mid-morning. Late morning and early afternoon are often quiet, with a second activity spike in late afternoon.",
    content_type: "species-behavior",
    tags: ["turkey", "eastern", "roosting", "daily-pattern", "fly-down", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "eastern wild turkey roosting daily pattern | roost in hardwoods, fly up before dark, pitch down first light, morning gobbling, mid-morning quiet, afternoon spike",
  },

  // Osceola (Florida) Turkey
  {
    title: "osceola turkey: range and habitat",
    content: "Osceola turkey (Florida turkey) is found only in peninsular Florida — the most geographically restricted subspecies. Darker plumage than Eastern with more iridescence. They prefer pine flatwoods, cypress swamps, and oak hammocks. Swamp water levels directly affect habitat use — low water concentrates birds on remaining dry ground.",
    content_type: "species-behavior",
    tags: ["turkey", "osceola", "florida", "habitat", "flatwoods", "swamp", "water-levels", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "osceola turkey range habitat | Florida only, darker than Eastern, pine flatwoods, cypress swamps, oak hammocks, water levels affect habitat use",
  },
  {
    title: "osceola turkey: hunting behavior",
    content: "Osceola turkeys are wilder and warier than Eastern turkeys — they see fewer hunters but the open flatwoods make approach difficult. They gobble less frequently and are less responsive to aggressive calling. Patience and subtle calling are more effective. The combination of limited range and wary behavior makes the Osceola one of the hardest subspecies to harvest for Grand Slam hunters.",
    content_type: "species-behavior",
    tags: ["turkey", "osceola", "florida", "wary", "calling", "grand-slam", "hunting", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "osceola turkey hunting behavior | wilder and warier than Eastern, gobble less, subtle calling better, hardest subspecies for Grand Slam",
  },

  // Rio Grande Turkey
  {
    title: "rio grande turkey: range and habitat",
    content: "Rio Grande turkey is the dominant subspecies of Texas, Oklahoma, and Kansas, extending into other western states. They prefer river bottoms, mesquite country, and agricultural areas. Found in large flocks during winter — sometimes 200+ birds congregating near roost sites along waterways. They roost in trees along rivers, creeks, and stock tanks.",
    content_type: "species-behavior",
    tags: ["turkey", "rio-grande", "texas", "habitat", "river-bottom", "mesquite", "flock", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "rio grande turkey range habitat | Texas Oklahoma Kansas, river bottoms, mesquite country, large winter flocks 200+, roost along waterways",
  },
  {
    title: "rio grande turkey: hunting and behavior",
    content: "Rio Grande turkeys can be less wary than Eastern turkeys in areas with lower hunting pressure, but heavily hunted public land birds get educated fast. They are more visible than Eastern turkeys due to open terrain — spotting birds at distance and setting up ahead of travel routes is a common strategy. Wind is a major factor in the open country — gobbling drops significantly on high-wind days.",
    content_type: "species-behavior",
    tags: ["turkey", "rio-grande", "hunting", "wind", "open-terrain", "pressure", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "rio grande turkey hunting behavior | less wary in low-pressure areas, open terrain allows spotting at distance, wind kills gobbling, set up on travel routes",
  },

  // Merriam's Turkey
  {
    title: "merriam's turkey: range and habitat",
    content: "Merriam's turkey is the mountain/western subspecies found in Colorado, New Mexico, Montana, South Dakota, and surrounding states. Distinguished by white-tipped tail feathers and lighter overall coloration. They prefer ponderosa pine forests and meadows at elevation. Migrate between elevations seasonally — higher in summer, lower in winter following snow lines.",
    content_type: "species-behavior",
    tags: ["turkey", "merriams", "mountain", "western", "ponderosa", "elevation", "migration", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "merriams turkey range habitat | mountain western CO NM MT SD, white-tipped tail, ponderosa pine, migrate between elevations, follow snow lines",
  },
  {
    title: "merriam's turkey: behavior and hunting",
    content: "Merriam's turkeys are less vocal than Eastern turkeys — they gobble less frequently and respond to calling less aggressively. However, they are often considered easier to hunt because they see fewer hunters and are more predictable in their travel patterns between roost, water, and feeding areas. Spot-and-stalk and ambush hunting near water sources are effective in the arid mountain terrain.",
    content_type: "species-behavior",
    tags: ["turkey", "merriams", "calling", "less-vocal", "spot-and-stalk", "water", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "merriams turkey behavior hunting | less vocal than Eastern, fewer hunters, predictable travel patterns, spot-and-stalk near water sources, arid mountain terrain",
  },

  // Gould's Turkey
  {
    title: "gould's turkey: range and conservation",
    content: "Gould's turkey is the rarest US subspecies, found only in extreme southern Arizona and New Mexico near the Mexican border. Largest of the subspecies with white-tipped tail feathers similar to Merriam's. Mountain habitat at 5,000-8,000 feet in Madrean pine-oak woodlands. A conservation success story — populations have recovered through restoration efforts after near-extirpation from the US.",
    content_type: "species-behavior",
    tags: ["turkey", "goulds", "rare", "arizona", "conservation", "mountain", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "goulds turkey range conservation | rarest US subspecies, extreme southern AZ NM, largest subspecies, 5000-8000 feet, Madrean pine-oak, conservation success",
  },
  {
    title: "gould's turkey: hunting opportunities",
    content: "Gould's turkey hunting opportunities are extremely limited — only a handful of tags issued annually in Arizona and New Mexico. Drawing odds are very low. The remote, rugged mountain terrain makes access challenging. Completing a 'World Slam' (all 6 subspecies including Gould's and Ocellated) requires a Gould's harvest, making these tags among the most coveted in turkey hunting.",
    content_type: "species-behavior",
    tags: ["turkey", "goulds", "hunting", "limited-tags", "world-slam", "remote", "behavior", "knowledge"],
    species: "turkey",
    effective_date: null,
    richText: "goulds turkey hunting opportunities | extremely limited tags, low draw odds, rugged remote terrain, required for World Slam, most coveted tags in turkey hunting",
  },
];

// ============================================================
// DOVE SUBSPECIES BEHAVIOR
// ============================================================

const doveSubspeciesEntries: PreparedEntry[] = [
  // Mourning Dove
  {
    title: "mourning dove: migration and breeding",
    content: "Mourning dove is the most hunted migratory bird in North America — more mourning doves are harvested annually than all other migratory game birds combined. They migrate based on photoperiod and food availability, moving south in fall. Multiple nesting cycles per year (up to 6 broods in southern states) make them incredibly prolific despite high harvest rates.",
    content_type: "species-behavior",
    tags: ["dove", "mourning-dove", "migration", "breeding", "harvest", "migratory", "behavior", "knowledge"],
    species: "dove",
    effective_date: null,
    richText: "mourning dove migration breeding | most hunted migratory bird, migrate by photoperiod and food, up to 6 broods per year, prolific despite high harvest",
  },
  {
    title: "mourning dove: habitat and flight",
    content: "Mourning doves prefer open fields with bare ground for feeding — harvested grain fields, freshly disked ground, and gravel roads for grit. They roost in trees and fly between roost, water, and feeding areas on predictable routes. Fast erratic flight up to 55 mph with twisting dives makes them challenging wing-shooting targets. Hunting over water holes in arid regions is extremely effective.",
    content_type: "species-behavior",
    tags: ["dove", "mourning-dove", "habitat", "flight", "feeding", "bare-ground", "water", "behavior", "knowledge"],
    species: "dove",
    effective_date: null,
    richText: "mourning dove habitat flight | open fields, bare ground, harvested grain, roost-water-feed routes, 55 mph erratic flight, water hole hunting in arid regions",
  },
  {
    title: "mourning dove: weather and timing",
    content: "Mourning doves are most active in the first 2-3 hours after sunrise and the last 2 hours before sunset. Overcast days with light wind provide the best hunting — birds fly lower and more frequently. Cold fronts push local birds south and can empty a field overnight. Opening day (September 1 in most states) typically offers the best shooting as birds haven't been pressured yet.",
    content_type: "species-behavior",
    tags: ["dove", "mourning-dove", "weather", "timing", "cold-front", "opening-day", "behavior", "knowledge"],
    species: "dove",
    effective_date: null,
    richText: "mourning dove weather timing | active first 2-3 hours and last 2 hours of daylight, overcast days best, cold fronts push birds south, opening day best shooting",
  },

  // White-winged Dove
  {
    title: "white-winged dove: range and expansion",
    content: "White-winged doves have been expanding their range dramatically northward from their traditional stronghold in Texas and Arizona. Once restricted to the Rio Grande Valley and Sonoran Desert, they now breed as far north as Oklahoma and the Carolinas. Large concentrations remain in South Texas agricultural areas where they feed on grain sorghum and sunflower fields.",
    content_type: "species-behavior",
    tags: ["dove", "white-winged", "range", "expansion", "texas", "arizona", "behavior", "knowledge"],
    species: "dove",
    effective_date: null,
    richText: "white-winged dove range expansion | expanding northward from TX AZ, traditional Rio Grande Valley and Sonoran, now to OK and Carolinas, large concentrations South Texas",
  },
  {
    title: "white-winged dove: habitat and behavior",
    content: "White-winged doves prefer agricultural areas and have adapted well to urban and suburban environments — nesting in neighborhood trees, feeding at bird feeders. Distinctive white wing patches visible in flight make them easy to identify. Slower and larger than mourning doves, making them slightly easier wing-shooting targets. They are more vocal with a distinctive 'who cooks for you' call.",
    content_type: "species-behavior",
    tags: ["dove", "white-winged", "habitat", "urban", "agricultural", "identification", "behavior", "knowledge"],
    species: "dove",
    effective_date: null,
    richText: "white-winged dove habitat behavior | agricultural and urban areas, white wing patches, slower than mourning dove, who cooks for you call, easier targets",
  },

  // Eurasian Collared-Dove
  {
    title: "eurasian collared-dove: invasive status and regulations",
    content: "Eurasian collared-doves are an invasive species with no bag limit in most states and no closed season in many areas. They arrived in Florida in the 1980s from the Bahamas and have spread across the entire continental US. Larger than mourning doves with a distinctive black collar on the back of the neck. Their rapid expansion has raised concerns about competition with native dove species.",
    content_type: "species-behavior",
    tags: ["dove", "eurasian-collared", "invasive", "no-bag-limit", "regulations", "behavior", "knowledge"],
    species: "dove",
    effective_date: null,
    richText: "eurasian collared-dove invasive regulations | no bag limit most states, no closed season, arrived Florida 1980s, spread entire US, black collar, competes with native doves",
  },
  {
    title: "eurasian collared-dove: habitat and behavior",
    content: "Eurasian collared-doves are year-round residents — they do not migrate. They thrive in urban and suburban habitat near grain elevators, feed lots, and bird feeders. Larger and slower than mourning doves, making them easy targets. Aggressive competitors that displace native doves from feeding and nesting sites. Their non-migratory status and no bag limits make them available year-round practice for dove hunters.",
    content_type: "species-behavior",
    tags: ["dove", "eurasian-collared", "habitat", "urban", "resident", "non-migratory", "aggressive", "behavior", "knowledge"],
    species: "dove",
    effective_date: null,
    richText: "eurasian collared-dove habitat behavior | year-round resident, no migration, urban suburban, grain elevators feed lots, displace native doves, year-round practice targets",
  },
];

// ============================================================
// MAIN
// ============================================================

async function seedCategory(name: string, entries: PreparedEntry[]): Promise<number> {
  console.log(`\nSeeding ${name} (${entries.length} entries)...`);

  let count = 0;
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    try {
      const n = await processBatch(batch);
      count += n;
      console.log(`  ${count}/${entries.length} embedded`);
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`  Batch ${i}-${i + batch.length} failed: ${err}`);
    }
  }

  console.log(`  Done: ${count}/${entries.length} ${name} entries seeded`);
  return count;
}

async function main() {
  console.log("=== Seeding Deer, Turkey & Dove Subspecies Knowledge ===");
  console.log("Expands species intelligence to all huntable subspecies for deer, turkey, and dove.");
  console.log(`Mode: ${USE_EDGE_FN ? "Edge Function (sequential)" : "Direct Voyage API (batch 20)"}\n`);

  const deerCount = await seedCategory("Deer Subspecies", deerSubspeciesEntries);
  const turkeyCount = await seedCategory("Turkey Subspecies", turkeySubspeciesEntries);
  const doveCount = await seedCategory("Dove Subspecies", doveSubspeciesEntries);

  const total = deerCount + turkeyCount + doveCount;
  console.log(`\n=== COMPLETE ===`);
  console.log(`Deer subspecies:    ${deerCount} entries`);
  console.log(`Turkey subspecies:  ${turkeyCount} entries`);
  console.log(`Dove subspecies:    ${doveCount} entries`);
  console.log(`Total:              ${total} entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

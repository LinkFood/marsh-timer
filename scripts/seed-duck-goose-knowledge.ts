/**
 * Seed hunt_knowledge with duck and goose behavioral knowledge
 * The brain has 58K DU observation pins but ZERO entries about WHY ducks/geese
 * do what they do. This fills that gap with hunter/biologist-level behavioral rules.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/seed-duck-goose-knowledge.ts
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
// DUCK SPECIES BEHAVIOR
// ============================================================

const duckSpeciesEntries: PreparedEntry[] = [
  // Mallard
  {
    title: "mallard: habitat preference",
    content: "Mallards prefer flooded timber and agricultural fields when water is 6-18 inches deep. They are the most adaptable puddle duck and will use nearly any shallow water habitat, but flooded oak flats and harvested grain fields are prime.",
    content_type: "species-behavior",
    tags: ["duck", "mallard", "habitat", "behavior", "flooded-timber", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "mallard habitat preference | flooded timber, agricultural fields, 6-18 inches water depth, oak flats, grain fields",
  },
  {
    title: "mallard: cold front movement",
    content: "Mallards move BEHIND cold fronts, not ahead of them. They push south after the front passes, riding the north winds on the backside. Hunters should expect new birds 12-48 hours after a front moves through, not during.",
    content_type: "species-behavior",
    tags: ["duck", "mallard", "migration", "cold-front", "weather", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "mallard cold front movement pattern | move BEHIND cold fronts not ahead, push south after front passes, new birds 12-48 hours after",
  },
  {
    title: "mallard: daily activity pattern",
    content: "Mallards are most active at dawn and the last hour before sunset. Mid-day activity is typically limited to loafing and preening on water. On overcast days, feeding activity may extend further into the morning.",
    content_type: "species-behavior",
    tags: ["duck", "mallard", "activity", "timing", "dawn", "dusk", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "mallard daily activity pattern | most active dawn and last hour before sunset, mid-day loafing, overcast extends feeding",
  },
  {
    title: "mallard: wind and landing behavior",
    content: "Mallards respond strongly to wind — they always land into the wind. Decoys should face into the wind with a landing zone (opening in the spread) downwind of the hunter. Wind determines everything about decoy placement.",
    content_type: "species-behavior",
    tags: ["duck", "mallard", "wind", "landing", "decoys", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "mallard wind landing behavior | land into wind, decoys face into wind, landing zone downwind of hunter",
  },
  {
    title: "mallard: hunting pressure response",
    content: "Mallards become decoy-shy after 2-3 weeks of hunting pressure. They learn to avoid traditional setups, fly higher, and circle more before committing. Late-season mallards require smaller, more realistic decoy spreads and less aggressive calling.",
    content_type: "species-behavior",
    tags: ["duck", "mallard", "pressure", "decoy-shy", "late-season", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "mallard hunting pressure response | decoy-shy after 2-3 weeks, fly higher, circle more, late-season needs smaller realistic spreads",
  },
  {
    title: "mallard: feeding habits",
    content: "Mallards feed primarily on waste grain (corn, rice, milo) and acorns. In flooded timber, acorns are the primary food source. In agricultural areas, they feed in harvested fields, especially rice and corn stubble. They are opportunistic feeders and will eat invertebrates when available.",
    content_type: "species-behavior",
    tags: ["duck", "mallard", "food", "feeding", "grain", "acorns", "rice", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "mallard feeding habits | waste grain corn rice milo, acorns in flooded timber, harvested fields, opportunistic invertebrates",
  },

  // Pintail
  {
    title: "pintail: cold front movement",
    content: "Pintails move AHEAD of cold fronts — they are often the first species to migrate. When a major cold front is forecast, pintails will be on the move before it arrives. They are long-distance migrants and can cover 500+ miles in a single flight.",
    content_type: "species-behavior",
    tags: ["duck", "pintail", "migration", "cold-front", "weather", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "pintail cold front movement | move AHEAD of cold fronts, first species to migrate, 500+ miles single flight",
  },
  {
    title: "pintail: habitat preference",
    content: "Pintails prefer open water and shallow marshes. Unlike mallards, they avoid heavily wooded areas and flooded timber. They favor wide-open wetlands, rice prairies, and coastal marshes where they can see approaching danger from a distance.",
    content_type: "species-behavior",
    tags: ["duck", "pintail", "habitat", "marsh", "open-water", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "pintail habitat preference | open water, shallow marshes, avoid timber, rice prairies, coastal marshes, need visibility",
  },
  {
    title: "pintail: wariness and decoy behavior",
    content: "Pintails are more wary than mallards — they need larger decoy spreads with more space between decoys. They prefer to land on the edges of spreads rather than in the middle. Pintail-specific decoys mixed into a mallard spread increase effectiveness.",
    content_type: "species-behavior",
    tags: ["duck", "pintail", "decoys", "wary", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "pintail wariness decoy behavior | more wary than mallards, larger spreads, more space, land on edges, pintail-specific decoys help",
  },
  {
    title: "pintail: feeding habits",
    content: "Pintails feed on aquatic vegetation and waste grain. They tip up in shallow water to reach submerged plants and seeds. In rice country, they are heavily dependent on post-harvest rice stubble and second-crop ratoon rice.",
    content_type: "species-behavior",
    tags: ["duck", "pintail", "food", "feeding", "rice", "aquatic-vegetation", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "pintail feeding habits | aquatic vegetation, waste grain, tip up in shallow water, rice stubble, ratoon rice",
  },

  // Wood Duck
  {
    title: "wood duck: migration and residency",
    content: "Wood ducks are non-migratory in southern states. Northern populations migrate short distances but many remain year-round in the Southeast. They are cavity nesters and depend on mature timber for nesting sites.",
    content_type: "species-behavior",
    tags: ["duck", "wood-duck", "migration", "resident", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "wood duck migration residency | non-migratory in south, short-distance migrants in north, cavity nesters, mature timber",
  },
  {
    title: "wood duck: habitat preference",
    content: "Wood ducks prefer heavily wooded swamps and beaver ponds. They are the quintessential flooded timber duck. Small creeks, oxbow lakes, and forested wetlands are prime wood duck habitat. They roost in trees, not on open water.",
    content_type: "species-behavior",
    tags: ["duck", "wood-duck", "habitat", "swamp", "beaver-pond", "timber", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "wood duck habitat preference | wooded swamps, beaver ponds, flooded timber, small creeks, oxbow lakes, roost in trees",
  },
  {
    title: "wood duck: daily activity pattern",
    content: "Wood ducks are most active at first light — they arrive at feeding areas before other duck species. The first 30 minutes of legal shooting light is peak wood duck time. They fly fast through timber corridors on predictable routes.",
    content_type: "species-behavior",
    tags: ["duck", "wood-duck", "activity", "timing", "dawn", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "wood duck daily activity | most active first light, arrive before other species, first 30 minutes peak, fast timber corridors",
  },
  {
    title: "wood duck: decoy response",
    content: "Wood ducks respond poorly to spinning-wing decoys. They are more responsive to small groups of wood duck decoys placed in sheltered, wooded areas. Motion decoys in timber can actually spook them.",
    content_type: "species-behavior",
    tags: ["duck", "wood-duck", "decoys", "spinning-wing", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "wood duck decoy response | poor response to spinning-wing, small groups in sheltered timber, motion decoys can spook",
  },

  // Green-winged Teal
  {
    title: "green-winged teal: flight characteristics",
    content: "Green-winged teal are the fastest flying duck — small, agile, and fly in tight flocks that twist and turn in unison. Their speed and erratic flight make them challenging to shoot. Flock sizes range from small groups to hundreds.",
    content_type: "species-behavior",
    tags: ["duck", "green-winged-teal", "flight", "speed", "flock", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "green-winged teal flight | fastest flying duck, small agile, tight flocks, twist and turn, challenging to shoot",
  },
  {
    title: "green-winged teal: migration timing",
    content: "Green-winged teal are early migrants — they move with the first cold snaps in September-October. They are often the first and last ducks of the season, with some lingering into late winter in southern states.",
    content_type: "species-behavior",
    tags: ["duck", "green-winged-teal", "migration", "timing", "early", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "green-winged teal migration timing | early migrants, first cold snaps September-October, first and last ducks of season",
  },
  {
    title: "green-winged teal: habitat and feeding",
    content: "Green-winged teal prefer shallow mud flats and flooded fields. They feed on seeds and invertebrates in very shallow water and exposed mud. Moist soil management areas are prime green-wing habitat.",
    content_type: "species-behavior",
    tags: ["duck", "green-winged-teal", "habitat", "mud-flats", "feeding", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "green-winged teal habitat feeding | shallow mud flats, flooded fields, seeds and invertebrates, moist soil management areas",
  },
  {
    title: "green-winged teal: decoy response",
    content: "Green-winged teal are very responsive to spinning-wing decoys. They decoy readily to small spreads and often buzz the spread multiple times before committing. Teal-specific decoys are effective but not required.",
    content_type: "species-behavior",
    tags: ["duck", "green-winged-teal", "decoys", "spinning-wing", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "green-winged teal decoy response | very responsive to spinning-wing, decoy readily, buzz spread multiple times",
  },

  // Gadwall
  {
    title: "gadwall: general behavior",
    content: "Gadwall — the 'gray duck' — are understated but one of the most common puddle ducks. They are often the first to leave an area when hunting pressure increases, making them an indicator species for pressure levels.",
    content_type: "species-behavior",
    tags: ["duck", "gadwall", "pressure", "indicator", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "gadwall general behavior | gray duck, common puddle duck, first to leave under pressure, pressure indicator species",
  },
  {
    title: "gadwall: feeding and habitat",
    content: "Gadwall prefer submerged aquatic vegetation — they are the most herbivorous of puddle ducks. They favor marshes with dense underwater plant growth. Often found mixed in with other puddle duck species rather than in pure gadwall flocks.",
    content_type: "species-behavior",
    tags: ["duck", "gadwall", "feeding", "habitat", "aquatic-vegetation", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "gadwall feeding habitat | submerged aquatic vegetation, most herbivorous puddle duck, dense underwater plants, mixed flocks",
  },
  {
    title: "gadwall: calling response",
    content: "Gadwall are less responsive to calling than mallards. Aggressive calling can push them away. Subtle hen sounds and feeding chuckles work better than loud hail calls. They respond more to decoy placement than calling.",
    content_type: "species-behavior",
    tags: ["duck", "gadwall", "calling", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "gadwall calling response | less responsive than mallards, aggressive calling pushes away, subtle hen sounds, decoy placement matters more",
  },

  // Wigeon
  {
    title: "wigeon: feeding strategy",
    content: "Wigeon are kleptoparasites — they feed by stealing food from diving ducks and coots. They wait near diving duck rafts and snatch vegetation brought to the surface. They also graze on land more than other puddle ducks, feeding on grasses and clover.",
    content_type: "species-behavior",
    tags: ["duck", "wigeon", "feeding", "kleptoparasite", "diving-ducks", "grazing", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "wigeon feeding strategy | steal food from diving ducks and coots, wait near rafts, graze on land more than other puddle ducks",
  },
  {
    title: "wigeon: habitat and flock behavior",
    content: "Wigeon prefer areas near diving duck rafts where they can pirate food. They whistle instead of quack — a distinctive three-note whistle. Often found in mixed flocks rather than pure wigeon groups. They are more skittish than mallards.",
    content_type: "species-behavior",
    tags: ["duck", "wigeon", "habitat", "flock", "call", "whistle", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "wigeon habitat flock behavior | near diving duck rafts, whistle not quack, mixed flocks, more skittish than mallards",
  },

  // Blue-winged Teal
  {
    title: "blue-winged teal: migration timing",
    content: "Blue-winged teal are very early migrants — most have left the US by mid-October. They winter in Central and South America. Almost entirely gone before regular duck season opens in most states, which is why early teal seasons exist in September.",
    content_type: "species-behavior",
    tags: ["duck", "blue-winged-teal", "migration", "timing", "early", "teal-season", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "blue-winged teal migration timing | most leave US by mid-October, winter Central/South America, gone before regular season, early teal seasons",
  },
  {
    title: "blue-winged teal: habitat and flight",
    content: "Blue-winged teal are extremely fast flyers. They prefer marshes and ponds with emergent vegetation — cattails, bulrush, and smartweed. They nest in grasslands near water and are one of the last ducks to arrive on northern breeding grounds in spring.",
    content_type: "species-behavior",
    tags: ["duck", "blue-winged-teal", "habitat", "flight", "marsh", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "blue-winged teal habitat flight | extremely fast, marshes with emergent vegetation, cattails bulrush smartweed, late spring arrival",
  },

  // Canvasback
  {
    title: "canvasback: status and habitat",
    content: "Canvasback — the 'king of ducks' — is the most prized trophy duck among waterfowlers. They prefer large open water with wild celery beds (Vallisneria, their namesake). Deep divers — rarely found in flooded timber or shallow marshes.",
    content_type: "species-behavior",
    tags: ["duck", "canvasback", "habitat", "open-water", "wild-celery", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "canvasback status habitat | king of ducks, most prized, large open water, wild celery beds, deep divers, not in timber",
  },
  {
    title: "canvasback: migration and population",
    content: "Canvasbacks migrate in large V-formations at high altitude. Their populations fluctuate dramatically with drought on prairie breeding grounds — prairie pothole conditions in spring directly predict fall canvasback numbers. Restrictive bag limits are common.",
    content_type: "species-behavior",
    tags: ["duck", "canvasback", "migration", "population", "prairie", "drought", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "canvasback migration population | V-formations high altitude, populations tied to prairie drought, pothole conditions predict numbers",
  },

  // Redhead
  {
    title: "redhead: nesting and habitat",
    content: "Redheads often parasitize canvasback nests — they lay eggs in other species' nests, including canvasbacks, other redheads, and even non-duck species. They prefer large marshes and bays, feeding by diving in 3-10 feet of water.",
    content_type: "species-behavior",
    tags: ["duck", "redhead", "nesting", "parasitic", "canvasback", "habitat", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "redhead nesting habitat | parasitize canvasback nests, lay eggs in other nests, large marshes and bays, dive 3-10 feet",
  },
  {
    title: "redhead: flock behavior",
    content: "Redheads often form large rafts on open water. They mix with canvasbacks and scaup. In winter, large concentrations build up in coastal bays, especially the Laguna Madre in Texas which hosts the majority of wintering redheads.",
    content_type: "species-behavior",
    tags: ["duck", "redhead", "flock", "rafting", "coastal", "laguna-madre", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "redhead flock behavior | large rafts open water, mix with canvasbacks and scaup, Laguna Madre Texas major wintering area",
  },

  // Scaup (Bluebill)
  {
    title: "scaup: migration timing",
    content: "Scaup (bluebill) are late migrants — peak movement occurs in November-December. They are among the last ducks to head south, arriving well into the regular season. Two species (Greater and Lesser) are nearly identical in the field.",
    content_type: "species-behavior",
    tags: ["duck", "scaup", "bluebill", "migration", "timing", "late", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "scaup bluebill migration timing | late migrants, peak November-December, last ducks south, Greater and Lesser nearly identical",
  },
  {
    title: "scaup: habitat and feeding",
    content: "Scaup prefer large bodies of open water. They form massive rafts offshore, sometimes numbering in the thousands. They feed by diving for aquatic invertebrates and vegetation. They are rarely found in flooded fields or timber.",
    content_type: "species-behavior",
    tags: ["duck", "scaup", "bluebill", "habitat", "open-water", "rafting", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "scaup bluebill habitat feeding | large open water, massive rafts offshore, dive for invertebrates and vegetation, not in fields/timber",
  },

  // Bufflehead
  {
    title: "bufflehead: size and flight",
    content: "Bufflehead are the smallest diving duck in North America. Very fast flyers with a rapid wingbeat. They almost never decoy — they land where they want to land regardless of decoy placement. Late migrants, arriving after most puddle ducks have already settled in.",
    content_type: "species-behavior",
    tags: ["duck", "bufflehead", "flight", "diving", "size", "migration", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "bufflehead size flight | smallest diving duck North America, very fast rapid wingbeat, almost never decoy, late migrants",
  },
  {
    title: "bufflehead: habitat and nesting",
    content: "Bufflehead prefer protected coves, small ponds, and river backwaters. They nest exclusively in tree cavities, specifically old woodpecker holes — one of the few ducks that depend entirely on cavity nesting. Their small size allows them to use smaller cavities than other cavity-nesting ducks.",
    content_type: "species-behavior",
    tags: ["duck", "bufflehead", "habitat", "nesting", "cavity", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "bufflehead habitat nesting | protected coves, small ponds, river backwaters, nest exclusively in tree cavities, old woodpecker holes",
  },

  // Northern Shoveler
  {
    title: "northern shoveler: feeding behavior",
    content: "Northern shovelers have a distinctive large spatulate bill used to filter small invertebrates and seeds from the water surface. They swim in circles — often in groups — to stir up food from the bottom. These spinning feeding formations are unique among ducks and easy to identify.",
    content_type: "species-behavior",
    tags: ["duck", "northern-shoveler", "feeding", "bill", "filter", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "northern shoveler feeding behavior | large spatulate bill, filter invertebrates and seeds, swim in circles to stir food, spinning formations",
  },
  {
    title: "northern shoveler: habitat and hunting",
    content: "Northern shovelers prefer shallow marshes with abundant floating vegetation. Not highly prized by hunters but very common in the bag. Often seen in spinning feeding formations on calm, shallow water. They are puddle ducks but feed more like a baleen whale — straining water through comb-like structures on their bill.",
    content_type: "species-behavior",
    tags: ["duck", "northern-shoveler", "habitat", "marsh", "hunting", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "northern shoveler habitat hunting | shallow marshes, floating vegetation, common in bag, not highly prized, filter feeders",
  },

  // Ring-necked Duck
  {
    title: "ring-necked duck: identification and habitat",
    content: "Despite the name, the ring on a ring-necked duck's neck is nearly invisible in the field — they are identified by the white ring on the bill. Prefer wooded swamps, beaver ponds, and small lakes. One of the first diving ducks to arrive in fall, making them an early-season diving duck opportunity.",
    content_type: "species-behavior",
    tags: ["duck", "ring-necked-duck", "identification", "habitat", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "ring-necked duck identification habitat | ring invisible on neck, white ring on bill, wooded swamps, beaver ponds, first diving duck in fall",
  },
  {
    title: "ring-necked duck: feeding and migration",
    content: "Ring-necked ducks are diving ducks that feed in relatively shallow water — 3 to 6 feet. Strong migrants that move in large flocks. Unlike other diving ducks that prefer open water, ring-necks favor smaller, more sheltered water bodies surrounded by timber.",
    content_type: "species-behavior",
    tags: ["duck", "ring-necked-duck", "feeding", "migration", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "ring-necked duck feeding migration | dive in shallow 3-6 feet, strong migrants large flocks, prefer sheltered water over open",
  },

  // Mottled Duck
  {
    title: "mottled duck: residency and range",
    content: "Mottled ducks are non-migratory — resident year-round along the Gulf Coast (Texas, Louisiana, Florida). They are the 'original' Gulf Coast duck before mallards expanded south. Very similar in appearance to female mallards, making field identification challenging.",
    content_type: "species-behavior",
    tags: ["duck", "mottled-duck", "resident", "gulf-coast", "non-migratory", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "mottled duck residency range | non-migratory, resident Gulf Coast TX LA FL, original Gulf Coast duck, similar to female mallard",
  },
  {
    title: "mottled duck: conservation and behavior",
    content: "Mottled ducks are a critical conservation concern due to hybridization with released mallards — genetic swamping threatens the species. Most active at dawn and dusk. Prefer coastal marshes and rice prairies. Hunting pressure on mottled ducks is carefully managed due to declining pure populations.",
    content_type: "species-behavior",
    tags: ["duck", "mottled-duck", "conservation", "hybridization", "mallard", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "mottled duck conservation | hybridization with mallards threatens species, dawn and dusk active, coastal marshes, rice prairies",
  },

  // American Black Duck
  {
    title: "american black duck: range and wariness",
    content: "American black duck is the primary puddle duck of the Atlantic Flyway. Very wary — significantly harder to hunt than mallards. They prefer tidal salt marshes, wooded swamps, and beaver flowages. Respond well to calling in timber and marshes but are extremely cautious about decoy spreads.",
    content_type: "species-behavior",
    tags: ["duck", "american-black-duck", "atlantic-flyway", "wary", "habitat", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "american black duck range wariness | primary Atlantic Flyway puddle duck, very wary, harder than mallards, salt marshes, wooded swamps",
  },
  {
    title: "american black duck: population decline",
    content: "American black duck populations are declining due to mallard competition and habitat loss. They hybridize extensively with mallards, and the expanding mallard range into traditional black duck territory accelerates this problem. Bag limits are typically restrictive — often one per day.",
    content_type: "species-behavior",
    tags: ["duck", "american-black-duck", "population", "decline", "mallard", "hybridization", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "american black duck population decline | declining from mallard competition and habitat loss, extensive hybridization, restrictive bag limits",
  },

  // Common Goldeneye
  {
    title: "common goldeneye: flight and identification",
    content: "Common goldeneye — nicknamed 'whistler' — named for the distinctive whistling sound of its wings in flight. This wing noise is audible before the bird is visible, giving hunters an early warning. Arrive late in migration, typically November-December, well into the regular season.",
    content_type: "species-behavior",
    tags: ["duck", "common-goldeneye", "whistler", "flight", "wing-noise", "migration", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "common goldeneye flight identification | whistler, whistling wing sound, audible before visible, late migrants November-December",
  },
  {
    title: "common goldeneye: habitat and behavior",
    content: "Common goldeneye prefer large rivers, lakes, and coastal bays. Diving duck that feeds on aquatic invertebrates. Nest in tree cavities. Often found in small groups rather than large rafts, unlike scaup. They are hardy cold-weather ducks, often the last to leave northern waters before freeze-up.",
    content_type: "species-behavior",
    tags: ["duck", "common-goldeneye", "habitat", "diving", "rivers", "lakes", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "common goldeneye habitat behavior | large rivers lakes coastal bays, dive for invertebrates, tree cavity nesters, small groups, cold-hardy",
  },

  // Barrow's Goldeneye
  {
    title: "barrow's goldeneye: range and identification",
    content: "Barrow's goldeneye is the western counterpart to common goldeneye with a very limited range compared to its cousin. Distinguished from common goldeneye by a crescent-shaped (not round) white face patch. Prefer mountain lakes and rivers in summer, moving to coastal waters in winter.",
    content_type: "species-behavior",
    tags: ["duck", "barrows-goldeneye", "range", "identification", "western", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "barrows goldeneye range identification | western counterpart to common goldeneye, crescent face patch not round, limited range, mountain lakes",
  },
  {
    title: "barrow's goldeneye: habitat",
    content: "Barrow's goldeneye breed on mountain lakes and rivers in the Pacific Northwest and western Canada. In winter they move to coastal waters. Their limited range means most hunters will never encounter them — they are a specialty bird for western waterfowlers.",
    content_type: "species-behavior",
    tags: ["duck", "barrows-goldeneye", "habitat", "mountain", "coastal", "western", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "barrows goldeneye habitat | mountain lakes rivers Pacific Northwest, winter coastal waters, limited range, specialty western bird",
  },

  // Hooded Merganser
  {
    title: "hooded merganser: identification and habitat",
    content: "Hooded merganser is the smallest merganser with a spectacular fan-shaped crest. Prefer wooded swamps, beaver ponds, and small streams. Nest in tree cavities. Often encountered unexpectedly while hunting wood ducks — they share the same habitat preferences.",
    content_type: "species-behavior",
    tags: ["duck", "hooded-merganser", "crest", "habitat", "swamp", "beaver-pond", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "hooded merganser identification habitat | smallest merganser, spectacular crest, wooded swamps, beaver ponds, encountered while hunting woodies",
  },
  {
    title: "hooded merganser: feeding and flight",
    content: "Hooded mergansers are fish-eating ducks — meat has a strong, fishy flavor that most hunters don't prefer. Fast, agile flyers through timber corridors. Their serrated bill is designed for gripping slippery fish. Despite not being prized table fare, they are beautiful birds and legal to harvest.",
    content_type: "species-behavior",
    tags: ["duck", "hooded-merganser", "feeding", "fish", "flight", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "hooded merganser feeding flight | fish-eating, strong flavor, fast agile in timber, serrated bill for gripping fish",
  },

  // Common Merganser
  {
    title: "common merganser: size and habitat",
    content: "Common merganser is the largest merganser — nearly goose-sized. Prefer large rivers and lakes. Primarily fish-eating with a serrated bill for gripping prey. Often seen swimming in long lines together. Not traditionally targeted by duck hunters but legal in most states.",
    content_type: "species-behavior",
    tags: ["duck", "common-merganser", "size", "habitat", "fish", "rivers", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "common merganser size habitat | largest merganser goose-sized, large rivers and lakes, fish-eating, swim in long lines, legal but not targeted",
  },
  {
    title: "common merganser: behavior",
    content: "Common mergansers are powerful divers that pursue fish underwater. They can stay submerged for extended periods. In winter, they concentrate on open water below dams and in river tailwaters where fish are concentrated. Their large size makes them easy to identify in flight.",
    content_type: "species-behavior",
    tags: ["duck", "common-merganser", "diving", "fish", "winter", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "common merganser behavior | powerful divers, pursue fish underwater, concentrate below dams and tailwaters in winter, large easy to ID",
  },

  // Red-breasted Merganser
  {
    title: "red-breasted merganser: habitat and identification",
    content: "Red-breasted mergansers prefer saltwater — coastal bays, estuaries, and the Great Lakes. Distinguished from common merganser by a shaggy, unkempt crest and thinner bill. Late migrants that arrive on wintering grounds well into the season.",
    content_type: "species-behavior",
    tags: ["duck", "red-breasted-merganser", "habitat", "saltwater", "coastal", "identification", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "red-breasted merganser habitat identification | prefer saltwater, coastal bays estuaries Great Lakes, shaggy crest, thinner bill, late migrants",
  },
  {
    title: "red-breasted merganser: flock behavior",
    content: "Red-breasted mergansers often raft up in large groups offshore. They are fish-eating ducks that feed cooperatively — groups will herd fish together before diving. Sea duck hunting for mergansers is a specialty pursuit, not mainstream duck hunting.",
    content_type: "species-behavior",
    tags: ["duck", "red-breasted-merganser", "flock", "feeding", "cooperative", "sea-duck", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "red-breasted merganser flock behavior | large rafts offshore, cooperative fish herding, sea duck specialty pursuit",
  },

  // Ruddy Duck
  {
    title: "ruddy duck: identification and behavior",
    content: "Ruddy duck is a stiff-tailed duck that often holds its tail erect. Blue bill in breeding season. Very reluctant to fly — strongly prefers diving to escape danger rather than taking flight. This makes them unique among ducks and frustrating to flush.",
    content_type: "species-behavior",
    tags: ["duck", "ruddy-duck", "identification", "stiff-tail", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "ruddy duck identification behavior | stiff-tailed, holds tail erect, blue bill breeding, prefers diving over flying to escape, reluctant flyer",
  },
  {
    title: "ruddy duck: habitat and feeding",
    content: "Ruddy ducks prefer large marshes with dense emergent vegetation. Diving duck that feeds by straining mud through its bill, similar to shovelers but underwater. Not prized by hunters but legal to harvest. They are small, compact ducks that sit very low in the water.",
    content_type: "species-behavior",
    tags: ["duck", "ruddy-duck", "habitat", "marsh", "feeding", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "ruddy duck habitat feeding | large marshes, dense vegetation, strain mud through bill underwater, not prized, sit low in water",
  },

  // Long-tailed Duck (Oldsquaw)
  {
    title: "long-tailed duck: diving and habitat",
    content: "Long-tailed duck (formerly Oldsquaw) is a sea duck that winters on the Great Lakes and coastal waters. One of the deepest diving ducks ever recorded — depths exceeding 200 feet. Prefer offshore open water, making them difficult to access for most hunters.",
    content_type: "species-behavior",
    tags: ["duck", "long-tailed-duck", "oldsquaw", "diving", "deep", "sea-duck", "habitat", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "long-tailed duck diving habitat | sea duck, Great Lakes and coastal, deepest diving duck 200+ feet, prefer offshore open water",
  },
  {
    title: "long-tailed duck: flight and identification",
    content: "Long-tailed ducks are very fast flyers. Males have distinctive long tail feathers. They are cold-weather specialists — completely at home in frigid northern waters and rough seas. Their vocalizations are loud and distinctive, carrying long distances over open water.",
    content_type: "species-behavior",
    tags: ["duck", "long-tailed-duck", "oldsquaw", "flight", "identification", "cold-weather", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "long-tailed duck flight identification | very fast flyers, long tail feathers males, cold-weather specialists, loud distinctive calls",
  },

  // Surf Scoter
  {
    title: "surf scoter: habitat and feeding",
    content: "Surf scoter is a sea duck with a distinctive colorful bill. Winter on both coasts and the Great Lakes. Prefer rocky coastline and offshore waters. Feed by diving for mussels and clams, crushing shells with powerful jaw muscles.",
    content_type: "species-behavior",
    tags: ["duck", "surf-scoter", "sea-duck", "habitat", "coastal", "feeding", "mussels", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "surf scoter habitat feeding | sea duck, colorful bill, both coasts and Great Lakes, rocky coastline, dive for mussels and clams",
  },
  {
    title: "surf scoter: hunting",
    content: "Surf scoters are not traditionally hunted by most duck hunters — sea duck hunting is a specialty pursuit requiring boats, cold-weather gear, and knowledge of offshore waters. They decoy better than most sea ducks, responding to scoter decoy spreads set near rocky points and jetties.",
    content_type: "species-behavior",
    tags: ["duck", "surf-scoter", "sea-duck", "hunting", "specialty", "decoys", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "surf scoter hunting | specialty sea duck pursuit, need boats and cold gear, decoy near rocky points and jetties, better than most sea ducks",
  },

  // Common Eider
  {
    title: "common eider: size and range",
    content: "Common eider is the largest duck in North America. Arctic breeding, winters on northern coastlines from Maine to Alaska. Prized historically for eiderdown insulation — the softest natural insulating material known. Very large and slow-flying with a distinctive flight silhouette.",
    content_type: "species-behavior",
    tags: ["duck", "common-eider", "size", "arctic", "range", "eiderdown", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "common eider size range | largest duck North America, Arctic breeding, winter northern coastlines, eiderdown insulation, large slow-flying",
  },
  {
    title: "common eider: feeding and hunting tradition",
    content: "Common eiders feed on mussels, crabs, and sea urchins by diving in coastal waters. Sea duck hunting for eiders is a long tradition in New England and eastern Canada — hunters use layout boats and large decoy spreads in rough ocean conditions. It is one of the most demanding forms of waterfowl hunting.",
    content_type: "species-behavior",
    tags: ["duck", "common-eider", "feeding", "mussels", "sea-duck", "hunting", "tradition", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "common eider feeding hunting | dive for mussels crabs sea urchins, New England and eastern Canada tradition, layout boats, rough ocean, demanding",
  },

  // Cinnamon Teal
  {
    title: "cinnamon teal: range and habitat",
    content: "Cinnamon teal are a western US species, rarely seen east of the Great Plains. Males are brilliant cinnamon-red, one of the most colorful ducks in North America. They prefer shallow marshy ponds with emergent vegetation — cattails, bulrush, and sedges. Closely related to blue-winged teal.",
    content_type: "species-behavior",
    tags: ["duck", "cinnamon-teal", "range", "habitat", "western", "marsh", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "cinnamon teal range habitat | western US only, rarely east of Great Plains, brilliant cinnamon male, shallow marshy ponds, emergent vegetation",
  },
  {
    title: "cinnamon teal: migration and behavior",
    content: "Cinnamon teal migrate early like their close relative the blue-winged teal — most leave the US by October. They winter primarily in Mexico and Central America. Their early departure means they are mainly encountered during early teal seasons in September. Shallow, vegetated wetlands with muddy bottoms are key habitat.",
    content_type: "species-behavior",
    tags: ["duck", "cinnamon-teal", "migration", "early", "teal-season", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "cinnamon teal migration behavior | migrate early like blue-winged teal, leave by October, winter Mexico, mainly encountered early teal seasons",
  },

  // Greater Scaup
  {
    title: "greater scaup: identification and habitat",
    content: "Greater scaup are larger than lesser scaup with a rounder head showing a green sheen (not purple like lesser scaup). They prefer saltwater bays, coastal estuaries, and the Great Lakes in winter. Breed on the tundra of Alaska and northern Canada. Often mixed with lesser scaup, making field ID one of the most difficult challenges in waterfowl identification.",
    content_type: "species-behavior",
    tags: ["duck", "greater-scaup", "identification", "habitat", "saltwater", "coastal", "tundra", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "greater scaup identification habitat | larger than lesser, rounder head green sheen, saltwater bays Great Lakes, breed Alaska/Canada tundra, hard to ID from lesser",
  },
  {
    title: "greater scaup: winter distribution and feeding",
    content: "Greater scaup concentrate on saltwater habitats in winter more than lesser scaup. Large rafts form on coastal bays from New England to the mid-Atlantic and on the Great Lakes. They dive for mollusks, crustaceans, and aquatic vegetation. Their preference for saltwater versus the lesser scaup's freshwater preference is the best field separation between the two species.",
    content_type: "species-behavior",
    tags: ["duck", "greater-scaup", "winter", "distribution", "saltwater", "diving", "feeding", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "greater scaup winter distribution feeding | saltwater more than lesser, coastal bays New England to mid-Atlantic, Great Lakes, dive for mollusks crustaceans",
  },

  // Lesser Scaup
  {
    title: "lesser scaup: abundance and identification",
    content: "Lesser scaup are the most abundant diving duck in North America. Distinguished from greater scaup by a peaked (not rounded) head shape with a purple sheen (not green). In the field, head shape is the most reliable ID feature. Often called 'bluebill' by hunters alongside greater scaup.",
    content_type: "species-behavior",
    tags: ["duck", "lesser-scaup", "abundance", "identification", "bluebill", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "lesser scaup abundance identification | most abundant diving duck North America, peaked head purple sheen, head shape best field ID, bluebill",
  },
  {
    title: "lesser scaup: habitat and flocking",
    content: "Lesser scaup prefer freshwater lakes and marshes more than greater scaup, though there is significant overlap. They form huge rafts on reservoirs and large lakes, sometimes numbering tens of thousands. They are a major component of the late-season diving duck harvest in the Mississippi and Central flyways.",
    content_type: "species-behavior",
    tags: ["duck", "lesser-scaup", "habitat", "freshwater", "rafting", "reservoir", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "lesser scaup habitat flocking | prefer freshwater over saltwater, huge rafts on reservoirs tens of thousands, major late-season diving duck harvest",
  },

  // Harlequin Duck
  {
    title: "harlequin duck: habitat and range",
    content: "Harlequin ducks breed on fast-flowing mountain streams in the Pacific Northwest and a small population in eastern Canada and northeastern US. In winter they move to rocky coastlines on both the Pacific and Atlantic. The eastern population is very small and endangered in some states. Spectacular slate-blue and chestnut plumage with white markings.",
    content_type: "species-behavior",
    tags: ["duck", "harlequin-duck", "habitat", "range", "mountain-streams", "rocky-coastline", "sea-duck", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "harlequin duck habitat range | breed fast-flowing mountain streams, winter rocky coastlines Pacific and Atlantic, eastern population small/endangered, spectacular plumage",
  },
  {
    title: "harlequin duck: behavior and conservation",
    content: "Harlequin ducks are sea ducks that thrive in turbulent water — crashing surf and whitewater rapids. They feed on aquatic invertebrates in fast-moving water by walking along the bottom. Very small population in eastern US makes them a conservation priority. Most hunters never encounter them. Harvest is closed or heavily restricted in many eastern states.",
    content_type: "species-behavior",
    tags: ["duck", "harlequin-duck", "behavior", "conservation", "sea-duck", "turbulent-water", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "harlequin duck behavior conservation | thrive in turbulent water surf and rapids, walk stream bottoms for invertebrates, eastern population conservation priority, restricted harvest",
  },

  // King Eider
  {
    title: "king eider: range and breeding",
    content: "King eiders are Arctic specialists that breed on the tundra of northern Alaska and Canada. They winter primarily in the Bering Sea, with small numbers on the Atlantic coast from Newfoundland to New England. Larger and more colorful than common eiders — males have a distinctive orange frontal shield on the bill.",
    content_type: "species-behavior",
    tags: ["duck", "king-eider", "range", "arctic", "tundra", "bering-sea", "sea-duck", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "king eider range breeding | Arctic specialist, breed tundra Alaska/Canada, winter Bering Sea, small numbers Atlantic coast, orange frontal shield",
  },
  {
    title: "king eider: hunting and accessibility",
    content: "King eiders are rarely encountered by most waterfowl hunters due to their remote Arctic and subarctic range. They are a bucket-list sea duck for dedicated hunters, requiring trips to remote Alaska or northern Atlantic coast. They dive deeply for mollusks and crustaceans in cold ocean waters. Their plumage is among the most striking of any North American duck.",
    content_type: "species-behavior",
    tags: ["duck", "king-eider", "hunting", "remote", "sea-duck", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "king eider hunting accessibility | rarely encountered, bucket-list sea duck, remote Alaska or northern Atlantic, deep divers for mollusks, striking plumage",
  },

  // White-winged Scoter
  {
    title: "white-winged scoter: identification and habitat",
    content: "White-winged scoter is the largest of the three scoter species. Distinguished by white wing patches (secondaries) visible in flight — the only scoter with this feature. Winter on both coasts and the Great Lakes. Breed in the boreal forests and prairie regions of western Canada.",
    content_type: "species-behavior",
    tags: ["duck", "white-winged-scoter", "identification", "habitat", "sea-duck", "coastal", "great-lakes", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "white-winged scoter identification habitat | largest scoter, white wing patches in flight, both coasts and Great Lakes, breed boreal/prairie Canada",
  },
  {
    title: "white-winged scoter: feeding and migration",
    content: "White-winged scoters dive for mussels and clams, crushing shells with powerful jaw muscles. They are late migrants — among the last ducks to move south in fall. Large rafts form offshore in winter, sometimes mixing with other scoter species. Sea duck hunting for scoters requires boats, heavy decoy spreads, and tolerance for rough ocean conditions.",
    content_type: "species-behavior",
    tags: ["duck", "white-winged-scoter", "feeding", "migration", "late", "mussels", "sea-duck", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "white-winged scoter feeding migration | dive for mussels and clams, late migrants, large offshore rafts, sea duck hunting requires boats and heavy gear",
  },

  // Black Scoter
  {
    title: "black scoter: identification and range",
    content: "Black scoter males are entirely black with a bright orange knob at the base of the bill — the only all-black duck in North America. They winter on both coasts, preferring offshore waters. The least common scoter in most areas. Breed in boreal forests and tundra of Alaska and northern Canada.",
    content_type: "species-behavior",
    tags: ["duck", "black-scoter", "identification", "range", "sea-duck", "offshore", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "black scoter identification range | all-black male bright orange bill knob, both coasts offshore, least common scoter, breed boreal/tundra Alaska Canada",
  },
  {
    title: "black scoter: behavior and hunting",
    content: "Black scoters prefer offshore waters more than the other scoter species, making them the most difficult scoter to access for hunters. They dive for mollusks and crustaceans. Their flight is strong and direct. In some coastal areas they are locally common in winter, but overall they are the scoter species hunters encounter least frequently.",
    content_type: "species-behavior",
    tags: ["duck", "black-scoter", "behavior", "hunting", "offshore", "sea-duck", "diving", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "black scoter behavior hunting | most offshore of scoters, hardest to access, dive for mollusks crustaceans, least frequently encountered scoter",
  },

  // Fulvous Whistling-Duck
  {
    title: "fulvous whistling-duck: identification and range",
    content: "Fulvous whistling-duck is a tropical species found in Texas, Louisiana, and Florida. Not a true 'duck' — more closely related to geese and swans. Distinctive upright posture with long legs, tawny-fulvous body, and a distinctive whistling call in flight. Prefer rice fields and shallow freshwater marshes.",
    content_type: "species-behavior",
    tags: ["duck", "fulvous-whistling-duck", "identification", "range", "tropical", "texas", "louisiana", "florida", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "fulvous whistling-duck identification range | tropical TX LA FL, not true duck related to geese/swans, upright posture long legs, whistling call, rice fields",
  },
  {
    title: "fulvous whistling-duck: habitat and behavior",
    content: "Fulvous whistling-ducks are strongly associated with rice agriculture — they feed in flooded rice fields and nest in dense rice and marsh vegetation. They are active at dawn and dusk but also feed nocturnally. Their range in the US is limited to the Gulf Coast states. Populations fluctuate and they are uncommon enough that many waterfowl hunters have never seen one.",
    content_type: "species-behavior",
    tags: ["duck", "fulvous-whistling-duck", "habitat", "rice", "nocturnal", "gulf-coast", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "fulvous whistling-duck habitat behavior | rice fields and marshes, feed dawn dusk and nocturnally, Gulf Coast only, uncommon, populations fluctuate",
  },

  // Black-bellied Whistling-Duck
  {
    title: "black-bellied whistling-duck: range expansion",
    content: "Black-bellied whistling-ducks are increasingly common in Texas and expanding northward through the southern US. Distinctive with a black belly, bright pink bill, and long pink legs. They roost and nest in trees — often seen perched on fence posts, power lines, and in residential areas. Their range expansion northward is one of the most dramatic in North American waterfowl.",
    content_type: "species-behavior",
    tags: ["duck", "black-bellied-whistling-duck", "range", "expansion", "texas", "southern-us", "cavity-nester", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "black-bellied whistling-duck range expansion | increasingly common TX and south, expanding north, roost in trees, perch on fences, dramatic range expansion",
  },
  {
    title: "black-bellied whistling-duck: nesting and behavior",
    content: "Black-bellied whistling-ducks are cavity nesters that also use nest boxes readily. Their distinctive whistling call is loud and carries far. They are often seen in large flocks in agricultural areas, especially grain fields. Not truly migratory — most are year-round residents in their range. They are increasingly showing up in urban and suburban areas with suitable habitat.",
    content_type: "species-behavior",
    tags: ["duck", "black-bellied-whistling-duck", "nesting", "cavity", "behavior", "resident", "urban", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "black-bellied whistling-duck nesting behavior | cavity nesters use nest boxes, loud whistling call, large flocks ag fields, mostly resident, urban/suburban expansion",
  },
];

// ============================================================
// GOOSE SPECIES BEHAVIOR
// ============================================================

const gooseSpeciesEntries: PreparedEntry[] = [
  // Canada Goose
  {
    title: "canada goose: territorial and family behavior",
    content: "Canada geese are highly territorial on breeding grounds. Family groups stay together through fall and winter — parents, juveniles, and sometimes offspring from previous years travel as a unit. This family structure affects flock behavior and calling response.",
    content_type: "species-behavior",
    tags: ["goose", "canada-goose", "territorial", "family", "flock", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "canada goose territorial family behavior | highly territorial breeding, family groups stay together fall/winter, affects flock behavior",
  },
  {
    title: "canada goose: subspecies and migration",
    content: "Larger Canada goose subspecies (Giant Canada) are often resident and don't migrate — they are the geese in parks and golf courses. Smaller subspecies (Lesser, Richardson's, Cackling) are long-distance migrants from the Arctic. Resident and migrant populations behave very differently.",
    content_type: "species-behavior",
    tags: ["goose", "canada-goose", "subspecies", "migration", "resident", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "canada goose subspecies migration | Giant Canada resident non-migratory, Lesser/Richardson's/Cackling long-distance Arctic migrants, very different behavior",
  },
  {
    title: "canada goose: daily routine",
    content: "Canada geese feed in agricultural fields during the day and roost on large water bodies at night. Their daily pattern is predictable: leave roost at dawn, feed in fields morning and afternoon, return to roost before dark. Intercepting this flight path is the primary hunting strategy.",
    content_type: "species-behavior",
    tags: ["goose", "canada-goose", "daily-routine", "feeding", "roosting", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "canada goose daily routine | feed agricultural fields by day, roost large water at night, predictable dawn departure and dusk return",
  },
  {
    title: "canada goose: wariness and sentinels",
    content: "Canada geese are very wary — they post sentinels while the flock feeds. At least one bird keeps its head up scanning for danger at all times. Geese landing in a field look for heads-down feeding posture in decoys as a safety signal. Full-body decoys with feeding and resting poses are critical.",
    content_type: "species-behavior",
    tags: ["goose", "canada-goose", "wary", "sentinel", "decoys", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "canada goose wariness sentinels | post sentinels while feeding, scan for danger, look for heads-down decoys, full-body feeding/resting poses critical",
  },
  {
    title: "canada goose: flagging response",
    content: "Canada geese respond to flagging — waving a dark cloth or flag mimics the wing flash of geese landing or taking off. Flagging is most effective at long range to turn flocks that are passing by. Stop flagging when birds commit and start their approach.",
    content_type: "species-behavior",
    tags: ["goose", "canada-goose", "flagging", "hunting", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "canada goose flagging response | wave dark cloth to mimic wing flash, effective at long range, stop when birds commit to approach",
  },

  // Snow Goose
  {
    title: "snow goose: flock size and numbers",
    content: "Snow geese travel in massive flocks of thousands to tens of thousands. Their populations have exceeded habitat carrying capacity, causing widespread destruction of Arctic breeding grounds. Conservation order (spring season) was created specifically to reduce numbers.",
    content_type: "species-behavior",
    tags: ["goose", "snow-goose", "flock", "population", "conservation-order", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "snow goose flock size numbers | massive flocks thousands+, exceeded carrying capacity, destroying Arctic habitat, conservation order to reduce",
  },
  {
    title: "snow goose: feeding and crop damage",
    content: "Snow geese feed in agricultural fields and can destroy crops rapidly. Large flocks can strip a field clean in hours. They grub in wet soil for roots and tubers. On the Arctic breeding grounds, their grubbing has destroyed vast areas of tundra vegetation.",
    content_type: "species-behavior",
    tags: ["goose", "snow-goose", "feeding", "agriculture", "crop-damage", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "snow goose feeding crop damage | feed in ag fields, strip fields clean, grub for roots and tubers, destroyed Arctic tundra",
  },
  {
    title: "snow goose: decoy spreads and calling",
    content: "Snow geese respond to massive decoy spreads — 500 or more decoys is common for serious snow goose hunting. Electronic calls are legal during the conservation order (spring season). The sheer scale of snow goose hunting is unlike any other waterfowl pursuit.",
    content_type: "species-behavior",
    tags: ["goose", "snow-goose", "decoys", "calling", "electronic", "conservation-order", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "snow goose decoy spreads calling | 500+ decoys common, electronic calls legal during conservation order, massive scale hunting",
  },
  {
    title: "snow goose: color morphs",
    content: "The blue morph (historically called 'Blue Goose') is the same species as the white-phase snow goose. Blue morphs are more common in eastern populations. Mixed flocks of white and blue phase birds travel together. Both count as the same species for bag limits.",
    content_type: "species-behavior",
    tags: ["goose", "snow-goose", "blue-goose", "color-morph", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "snow goose color morphs | blue morph same species as white, blue more common in east, mixed flocks, same bag limit",
  },

  // Specklebelly (White-fronted Goose)
  {
    title: "specklebelly: eating quality and status",
    content: "Specklebelly (white-fronted goose) is widely considered the best-eating goose among waterfowlers. Their diet of grain and grasses produces excellent table fare. They are highly prized and many hunters specifically target them.",
    content_type: "species-behavior",
    tags: ["goose", "specklebelly", "white-fronted", "eating", "table-fare", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "specklebelly eating quality status | best-eating goose, grain and grass diet, excellent table fare, highly prized, specifically targeted",
  },
  {
    title: "specklebelly: habitat preference",
    content: "Specklebellies prefer rice fields and short-grass prairies. They usually arrive before snow geese in fall. In the Texas and Louisiana rice prairies, they are the dominant goose species early in the season.",
    content_type: "species-behavior",
    tags: ["goose", "specklebelly", "white-fronted", "habitat", "rice", "prairie", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "specklebelly habitat preference | rice fields, short-grass prairies, arrive before snow geese, dominant early season in TX/LA rice",
  },
  {
    title: "specklebelly: wariness and decoying",
    content: "Specklebellies are less wary than Canada geese. They often decoy readily to small spreads of 12-36 decoys. Their distinctive 'yodel' call is easy to replicate and they respond well to calling. They often commit quickly without the extensive circling of Canadas.",
    content_type: "species-behavior",
    tags: ["goose", "specklebelly", "white-fronted", "decoys", "calling", "yodel", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "specklebelly wariness decoying | less wary than Canadas, decoy to small spreads 12-36, yodel call, commit quickly",
  },

  // Cackling Goose
  {
    title: "cackling goose: identification and split",
    content: "Cackling goose was split from Canada goose as a separate species in 2004. Smaller than Canada goose with a shorter neck, stubbier bill, and more compact body. Four subspecies, all breeding in Arctic Alaska and Canada. Primarily winter in the Pacific Flyway. Hunters must learn to distinguish them from small-bodied Canada goose subspecies — bag limits may differ.",
    content_type: "species-behavior",
    tags: ["goose", "cackling-goose", "identification", "species-split", "arctic", "pacific-flyway", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "cackling goose identification split | split from Canada goose 2004, smaller shorter neck stubbier bill, Arctic breeder, Pacific Flyway winter, separate bag limits",
  },
  {
    title: "cackling goose: habitat and migration",
    content: "Cackling geese breed on Arctic tundra in western Alaska and Canada. They winter primarily in Oregon's Willamette Valley and California's Central Valley, with some in the southern Great Plains. Their long-distance migration from the Arctic to the Pacific Flyway is one of the longest goose migrations. They feed in agricultural fields like other geese but prefer shorter grass and are often found in smaller flocks than Canada geese.",
    content_type: "species-behavior",
    tags: ["goose", "cackling-goose", "habitat", "migration", "arctic", "willamette", "california", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "cackling goose habitat migration | breed Arctic tundra, winter Willamette Valley and Central Valley CA, long-distance migration, shorter grass, smaller flocks",
  },

  // Ross's Goose
  {
    title: "ross's goose: identification and size",
    content: "Ross's goose is the smallest white goose in North America — significantly smaller than a snow goose. Distinguished from snow goose by a shorter, stubbier bill that lacks the black 'grinning patch' along the bill edges. They are often mixed in with snow goose flocks, making them easy to overlook. Arctic breeders that winter primarily in California's Central Valley and along the Gulf Coast.",
    content_type: "species-behavior",
    tags: ["goose", "rosss-goose", "identification", "size", "snow-goose", "arctic", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "rosss goose identification size | smallest white goose, smaller than snow goose, no grinning patch on bill, mixed in snow goose flocks, Arctic breeder",
  },
  {
    title: "ross's goose: habitat and hunting",
    content: "Ross's geese winter primarily in California's Central Valley and along the Gulf Coast from Texas to Louisiana. They are often harvested incidentally by hunters targeting snow geese, since the two species flock together. Ross's goose populations have increased dramatically — like snow geese, they benefit from agricultural food sources. They count separately from snow geese in bag limits in most states.",
    content_type: "species-behavior",
    tags: ["goose", "rosss-goose", "habitat", "hunting", "california", "gulf-coast", "snow-goose", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "rosss goose habitat hunting | winter Central Valley CA and Gulf Coast, harvested with snow geese, populations increasing, separate bag limits",
  },

  // Brant
  {
    title: "brant: habitat and diet",
    content: "Brant are small sea geese that prefer saltwater coastal bays and estuaries — they are almost never found on inland freshwater. They feed primarily on eelgrass and sea lettuce, making them one of the most habitat-specific geese. When eelgrass beds decline, brant populations suffer directly. Two subspecies: Atlantic brant on the East Coast and Black brant (Pacific brant) on the West Coast.",
    content_type: "species-behavior",
    tags: ["goose", "brant", "habitat", "diet", "eelgrass", "saltwater", "coastal", "sea-goose", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "brant habitat diet | small sea goose, saltwater bays and estuaries only, feed on eelgrass and sea lettuce, two subspecies Atlantic and Black/Pacific",
  },
  {
    title: "brant: hunting and conservation",
    content: "Brant hunting is a specialized coastal pursuit — hunters set up on tidal flats and shallow bays with large decoy spreads. Their dependence on eelgrass makes their population vulnerable to water quality and habitat changes. Atlantic brant concentrate in a few key bays (Barnegat Bay NJ, Great South Bay NY). Black brant winter from Alaska to Baja California. Bag limits are typically restrictive due to their narrow habitat requirements.",
    content_type: "species-behavior",
    tags: ["goose", "brant", "hunting", "conservation", "coastal", "tidal", "eelgrass", "behavior", "knowledge"],
    species: "goose",
    effective_date: null,
    richText: "brant hunting conservation | specialized coastal pursuit, tidal flats and bays, depend on eelgrass, Atlantic concentrate Barnegat/Great South Bay, restrictive bag limits",
  },
];

// ============================================================
// OTHER HUNTABLE SPECIES (not duck or goose)
// ============================================================

const otherSpeciesEntries: PreparedEntry[] = [
  // American Coot
  {
    title: "american coot: identification and classification",
    content: "American coot is not a duck — it belongs to the rail family (Rallidae). However, it is legal to hunt during waterfowl season in most states. Distinguished by a white bill, dark slate-gray body, and lobed (not webbed) toes. They pump their head while swimming, unlike ducks. Often found in huge flocks on marshes and lake edges, sometimes numbering in the thousands.",
    content_type: "species-behavior",
    tags: ["coot", "american-coot", "identification", "rail", "waterfowl-season", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "american coot identification classification | not a duck — rail family, legal during waterfowl season, white bill, pumping head swim, lobed toes, huge flocks",
  },
  {
    title: "american coot: habitat and hunting",
    content: "American coots prefer marshes, lake edges, and ponds with abundant submerged and emergent vegetation. They are not prized table fare among most hunters but are legal to harvest and common in the bag. Coots are often found in enormous concentrations on open water — wigeon and other ducks frequently steal food from diving coots. They are reluctant to fly, preferring to run across the water surface to escape danger.",
    content_type: "species-behavior",
    tags: ["coot", "american-coot", "habitat", "hunting", "marsh", "lake", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "american coot habitat hunting | marshes lake edges ponds, not prized but legal, enormous concentrations, wigeon steal from coots, reluctant flyers run on water",
  },
];

// ============================================================
// WEATHER-MOVEMENT RULES
// ============================================================

const weatherMovementEntries: PreparedEntry[] = [
  {
    title: "waterfowl weather rule: change vs conditions",
    content: "Ducks move on weather CHANGES, not weather conditions. A 40F day after a week of 40F days moves nothing. A 40F day after a week of 60F days moves everything. The delta matters, not the absolute temperature.",
    content_type: "hunting-knowledge",
    tags: ["duck", "goose", "weather", "migration", "temperature", "change", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "waterfowl weather rule | ducks move on weather CHANGES not conditions, delta matters not absolute temperature, 40F after 60F moves birds",
  },
  {
    title: "waterfowl weather rule: push equation",
    content: "The migration 'push' equation: cold front + north wind + precipitation = migration push. Missing any one element reduces the push significantly. All three together produce the strongest southward movements of waterfowl.",
    content_type: "hunting-knowledge",
    tags: ["duck", "goose", "weather", "migration", "cold-front", "wind", "precipitation", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "waterfowl push equation | cold front + north wind + precipitation = migration push, missing any element reduces push, all three = strongest movement",
  },
  {
    title: "waterfowl weather rule: barometric pressure feeding",
    content: "Barometric pressure affects duck feeding intensity. Ducks feed heavily when pressure is falling (storm approaching). Feeding slows when pressure stabilizes after the front passes. This is the biological equivalent of 'stocking up before the storm.'",
    content_type: "hunting-knowledge",
    tags: ["duck", "goose", "weather", "barometric-pressure", "feeding", "storm", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "waterfowl barometric pressure feeding | feed heavily when pressure falling, slow when stabilized, stocking up before the storm",
  },
  {
    title: "waterfowl weather rule: wind speed threshold",
    content: "Most duck species stop feeding and raft up in protected water when sustained winds exceed 25 mph. This concentrates birds in predictable sheltered locations — lee shorelines, protected coves, and timber edges. High wind days can produce excellent hunting in the right spots.",
    content_type: "hunting-knowledge",
    tags: ["duck", "weather", "wind", "threshold", "rafting", "sheltered", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "waterfowl wind speed threshold | stop feeding above 25 mph sustained, raft in protected water, concentrates birds in sheltered spots",
  },
  {
    title: "waterfowl weather rule: rate of temperature change",
    content: "Temperature isn't the migration trigger — rate of change is. A 20F drop over 24 hours moves more birds than a gradual 20F drop over a week. Rapid temperature crashes are the strongest single predictor of duck migration events.",
    content_type: "hunting-knowledge",
    tags: ["duck", "goose", "weather", "temperature", "rate-of-change", "migration", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "waterfowl temperature rate of change | 20F drop in 24 hours moves more than gradual drop over week, rapid crashes strongest predictor",
  },
  {
    title: "waterfowl weather rule: full moon effect",
    content: "Full moon: controversial but data suggests ducks feed more at night during full moon, making them less active at dawn. New moon periods often produce better morning hunts because birds didn't feed as heavily overnight.",
    content_type: "hunting-knowledge",
    tags: ["duck", "goose", "weather", "moon", "full-moon", "new-moon", "dawn", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "waterfowl full moon effect | ducks feed more at night during full moon, less active dawn, new moon = better morning hunts",
  },
  {
    title: "waterfowl weather rule: fog conditions",
    content: "Fog is excellent for duck hunting — birds fly lower, decoy more readily, and have difficulty spotting hunters. Fog compresses flight altitude and reduces wariness. However, avoid fog for goose hunting — geese won't fly in dense fog and will stay on the roost.",
    content_type: "hunting-knowledge",
    tags: ["duck", "goose", "weather", "fog", "conditions", "behavior", "knowledge"],
    species: null,
    effective_date: null,
    richText: "waterfowl fog conditions | excellent for duck hunting, birds fly lower decoy readily, BAD for goose hunting, geese won't fly in fog",
  },
];

// ============================================================
// WATER AND HABITAT RULES
// ============================================================

const waterHabitatEntries: PreparedEntry[] = [
  {
    title: "waterfowl habitat: flooded timber gold standard",
    content: "Flooded timber is the gold standard for mallard hunting in the Mississippi Flyway. Ideal water depth is 6-18 inches over oak flats for acorn feeding. Water too deep means birds won't use it. Water too shallow means exposed mud, which is not attractive to mallards.",
    content_type: "hunting-knowledge",
    tags: ["duck", "mallard", "habitat", "flooded-timber", "water-depth", "oak", "acorn", "mississippi-flyway", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "flooded timber gold standard | mallard hunting Mississippi Flyway, 6-18 inches over oak flats, too deep won't use, too shallow not attractive",
  },
  {
    title: "waterfowl habitat: rising water effect",
    content: "Rising water attracts ducks because it floods new food sources — acorns, invertebrates in leaf litter, seeds in previously dry soil. Birds follow rising water upstream as new areas become available. A slow, steady rise is better than a flash flood.",
    content_type: "hunting-knowledge",
    tags: ["duck", "habitat", "water-level", "rising", "flooding", "food", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "rising water effect | attracts ducks, floods new food sources acorns invertebrates seeds, birds follow rising water upstream",
  },
  {
    title: "waterfowl habitat: falling water concentration",
    content: "Falling water concentrates birds on remaining water. Fewer spots with water means more birds per spot, but overall fewer birds in the area. Falling water is a double-edged sword — great concentration but decreasing total habitat.",
    content_type: "hunting-knowledge",
    tags: ["duck", "habitat", "water-level", "falling", "concentration", "behavior", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "falling water concentration | fewer spots = more birds per spot, but fewer total birds in area, double-edged sword",
  },
  {
    title: "waterfowl habitat: green vs dead timber",
    content: "Green (living) flooded oaks produce acorns annually and are sustainable long-term duck habitat. Dead timber means the flooding pattern changed permanently — may still attract birds short-term from invertebrates in decaying wood, but won't hold them long-term without food production.",
    content_type: "hunting-knowledge",
    tags: ["duck", "habitat", "timber", "green", "dead", "acorn", "long-term", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "green vs dead timber | green oaks produce acorns annually, dead timber means changed flooding, short-term invertebrates only",
  },
  {
    title: "waterfowl habitat: rice fields",
    content: "Post-harvest rice stubble is the #1 duck food in the Central and Mississippi flyways. Second-crop ratoon rice (volunteer growth after harvest) is even more attractive because it provides green food and grain. Flooded rice fields are essentially duck magnets — mallards, pintails, and teal all concentrate on rice.",
    content_type: "hunting-knowledge",
    tags: ["duck", "habitat", "rice", "agriculture", "food", "central-flyway", "mississippi-flyway", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "rice fields #1 duck food | post-harvest stubble, ratoon rice even better, flooded rice fields = duck magnets, mallards pintails teal",
  },
  {
    title: "waterfowl habitat: moist soil management",
    content: "Wildlife management areas intentionally manage water levels to grow native plants — smartweed, millet, sedges, and other species that produce duck food. Drawdown timing in spring and summer affects what grows. Early drawdown favors millet; late drawdown favors smartweed. These managed areas concentrate ducks predictably.",
    content_type: "hunting-knowledge",
    tags: ["duck", "habitat", "moist-soil", "management", "smartweed", "millet", "wma", "knowledge"],
    species: "duck",
    effective_date: null,
    richText: "moist soil management | WMAs manage water levels for native plants smartweed millet sedges, drawdown timing affects growth, concentrate ducks predictably",
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
  console.log("=== Seeding Duck & Goose Behavioral Knowledge ===");
  console.log("This fills the biggest knowledge gap: WHY ducks/geese do what they do.");
  console.log(`Mode: Direct Voyage API (batch 20)\n`);

  const duckCount = await seedCategory("Duck Species Behavior", duckSpeciesEntries);
  const gooseCount = await seedCategory("Goose Species Behavior", gooseSpeciesEntries);
  const otherCount = await seedCategory("Other Huntable Species", otherSpeciesEntries);
  const weatherCount = await seedCategory("Weather-Movement Rules", weatherMovementEntries);
  const habitatCount = await seedCategory("Water & Habitat Rules", waterHabitatEntries);

  const total = duckCount + gooseCount + otherCount + weatherCount + habitatCount;
  console.log(`\n=== COMPLETE ===`);
  console.log(`Duck species:     ${duckCount} entries`);
  console.log(`Goose species:    ${gooseCount} entries`);
  console.log(`Other species:    ${otherCount} entries`);
  console.log(`Weather rules:    ${weatherCount} entries`);
  console.log(`Habitat rules:    ${habitatCount} entries`);
  console.log(`Total:            ${total} entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

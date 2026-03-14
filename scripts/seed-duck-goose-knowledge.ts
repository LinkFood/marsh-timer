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
  const weatherCount = await seedCategory("Weather-Movement Rules", weatherMovementEntries);
  const habitatCount = await seedCategory("Water & Habitat Rules", waterHabitatEntries);

  const total = duckCount + gooseCount + weatherCount + habitatCount;
  console.log(`\n=== COMPLETE ===`);
  console.log(`Duck species:     ${duckCount} entries`);
  console.log(`Goose species:    ${gooseCount} entries`);
  console.log(`Weather rules:    ${weatherCount} entries`);
  console.log(`Habitat rules:    ${habitatCount} entries`);
  console.log(`Total:            ${total} entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

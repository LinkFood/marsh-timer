/**
 * Seed hunt_knowledge with species-specific hunting intel
 * Deer (~100 entries), Turkey (~80 entries), Dove (~50 entries)
 * Calls Voyage AI directly in batches of 20 (max before timeout)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/seed-species-knowledge.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

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
        const wait = (attempt + 1) * 30000;
        console.log(`    Rate limited, waiting ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 10000;
        console.log(`    Error, retrying in ${wait / 1000}s: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
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
  embedding: number[];
}[]) {
  const rows = entries.map((e) => ({
    title: e.title,
    content: e.content,
    content_type: e.content_type,
    tags: e.tags,
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
    embedding: embeddings[i],
  }));

  await upsertKnowledgeBatch(entries);
  return entries.length;
}

// ============================================================
// DEER DATA (~100 entries)
// ============================================================

const deerEntries: PreparedEntry[] = [
  // Rut timing by state — pre-rut/seeking/chasing/breeding/post-rut
  // Southeast
  { title: "deer rut: alabama", content: "Alabama pre-rut starts mid-December in the north and late January in the south; peak breeding occurs late January through mid-February in southern zones.", content_type: "deer-pattern", tags: ["deer", "alabama", "rut", "timing"], richText: "deer rut timing alabama | pre-rut mid-December north, peak breeding late January south" },
  { title: "deer rut: georgia", content: "Georgia's rut peaks mid-November in the Piedmont region and late October in the mountains; southern coastal plains see peak breeding in mid-December.", content_type: "deer-pattern", tags: ["deer", "georgia", "rut", "timing"], richText: "deer rut timing georgia | peak mid-November Piedmont, late October mountains" },
  { title: "deer rut: mississippi", content: "Mississippi rut peaks mid-December in the Delta and early January in southern counties; seeking phase begins 2-3 weeks before peak breeding.", content_type: "deer-pattern", tags: ["deer", "mississippi", "rut", "timing"], richText: "deer rut timing mississippi | peak mid-December Delta, early January south" },
  { title: "deer rut: louisiana", content: "Louisiana rut varies dramatically by zone: northwest peaks early November, central peaks late December, and southeast peaks late January.", content_type: "deer-pattern", tags: ["deer", "louisiana", "rut", "timing"], richText: "deer rut timing louisiana | northwest early November, southeast late January" },
  { title: "deer rut: south carolina", content: "South Carolina rut peaks mid-October in the upstate, mid-November in the midlands, and late November through mid-December in the coastal plain.", content_type: "deer-pattern", tags: ["deer", "south carolina", "rut", "timing"], richText: "deer rut timing south carolina | upstate mid-October, coastal mid-December" },
  { title: "deer rut: florida", content: "Florida's rut is extremely variable: northwest peaks late January, central peaks February, and south Florida bucks breed as late as March.", content_type: "deer-pattern", tags: ["deer", "florida", "rut", "timing"], richText: "deer rut timing florida | northwest late January, south Florida March" },
  { title: "deer rut: north carolina", content: "North Carolina rut peaks mid-November in the mountains and piedmont; coastal plain breeding peaks late November to early December.", content_type: "deer-pattern", tags: ["deer", "north carolina", "rut", "timing"], richText: "deer rut timing north carolina | mountains mid-November, coast late November" },
  { title: "deer rut: virginia", content: "Virginia's rut peaks mid-November statewide; the seeking/chasing phase runs late October through early November with bucks on their feet during daylight.", content_type: "deer-pattern", tags: ["deer", "virginia", "rut", "timing"], richText: "deer rut timing virginia | peak mid-November statewide, chasing starts late October" },
  { title: "deer rut: tennessee", content: "Tennessee rut peaks November 10-25 statewide; bucks begin scraping and rubbing in early October with the seeking phase starting late October.", content_type: "deer-pattern", tags: ["deer", "tennessee", "rut", "timing"], richText: "deer rut timing tennessee | peak November 10-25, seeking starts late October" },
  { title: "deer rut: arkansas", content: "Arkansas peak rut runs November 10-20 statewide; the chasing phase from November 1-10 produces some of the best daylight buck movement.", content_type: "deer-pattern", tags: ["deer", "arkansas", "rut", "timing"], richText: "deer rut timing arkansas | peak November 10-20, chasing November 1-10" },

  // Midwest
  { title: "deer rut: iowa", content: "Iowa's rut peaks November 5-15; the pre-rut chasing phase from October 28-November 7 is widely considered the best time to see mature bucks on their feet.", content_type: "deer-pattern", tags: ["deer", "iowa", "rut", "timing"], richText: "deer rut timing iowa | peak November 5-15, chasing late October" },
  { title: "deer rut: illinois", content: "Illinois peak breeding occurs November 10-20; the seeking/chasing phase November 1-10 produces outstanding daylight buck movement across the state.", content_type: "deer-pattern", tags: ["deer", "illinois", "rut", "timing"], richText: "deer rut timing illinois | peak November 10-20, chasing November 1-10" },
  { title: "deer rut: kansas", content: "Kansas rut peaks November 10-20; bucks are most vulnerable during the chasing phase November 1-12 when they abandon normal patterns.", content_type: "deer-pattern", tags: ["deer", "kansas", "rut", "timing"], richText: "deer rut timing kansas | peak November 10-20, chasing November 1-12" },
  { title: "deer rut: missouri", content: "Missouri peak breeding runs November 10-22; the second rut occurs late November through early December as unbred does cycle again.", content_type: "deer-pattern", tags: ["deer", "missouri", "rut", "timing"], richText: "deer rut timing missouri | peak November 10-22, second rut late November" },
  { title: "deer rut: ohio", content: "Ohio rut peaks November 8-18; the pre-rut from October 25-November 7 is prime time for rattling and calling as bucks establish dominance.", content_type: "deer-pattern", tags: ["deer", "ohio", "rut", "timing"], richText: "deer rut timing ohio | peak November 8-18, pre-rut late October" },
  { title: "deer rut: indiana", content: "Indiana peak breeding occurs November 10-20; scraping activity peaks late October and the chasing phase runs November 3-12.", content_type: "deer-pattern", tags: ["deer", "indiana", "rut", "timing"], richText: "deer rut timing indiana | peak November 10-20, scraping late October" },
  { title: "deer rut: michigan", content: "Michigan rut peaks November 12-22 statewide; the Upper Peninsula runs about a week earlier than the southern Lower Peninsula.", content_type: "deer-pattern", tags: ["deer", "michigan", "rut", "timing"], richText: "deer rut timing michigan | peak November 12-22, UP runs a week earlier" },
  { title: "deer rut: wisconsin", content: "Wisconsin peak breeding runs November 8-18; the gun season opener traditionally falls during peak rut, producing high harvest rates.", content_type: "deer-pattern", tags: ["deer", "wisconsin", "rut", "timing"], richText: "deer rut timing wisconsin | peak November 8-18, overlaps gun opener" },
  { title: "deer rut: minnesota", content: "Minnesota rut peaks November 5-15 statewide; northern zones may see peak activity 3-5 days earlier than southern farmland.", content_type: "deer-pattern", tags: ["deer", "minnesota", "rut", "timing"], richText: "deer rut timing minnesota | peak November 5-15, north runs earlier" },
  { title: "deer rut: nebraska", content: "Nebraska peak breeding occurs November 10-20; the Sandhills region sees some of the best chasing activity November 5-12.", content_type: "deer-pattern", tags: ["deer", "nebraska", "rut", "timing"], richText: "deer rut timing nebraska | peak November 10-20, Sandhills chasing November 5-12" },

  // Northeast
  { title: "deer rut: pennsylvania", content: "Pennsylvania rut peaks November 12-20; the seeking phase starts late October with the best rattling action during November 1-10.", content_type: "deer-pattern", tags: ["deer", "pennsylvania", "rut", "timing"], richText: "deer rut timing pennsylvania | peak November 12-20, rattling November 1-10" },
  { title: "deer rut: new york", content: "New York peak breeding runs November 10-20; Adirondack bucks may peak a few days earlier than Long Island or the Southern Tier.", content_type: "deer-pattern", tags: ["deer", "new york", "rut", "timing"], richText: "deer rut timing new york | peak November 10-20, Adirondacks slightly earlier" },
  { title: "deer rut: west virginia", content: "West Virginia rut peaks November 12-22; mountain county bucks show strong chasing behavior November 5-12.", content_type: "deer-pattern", tags: ["deer", "west virginia", "rut", "timing"], richText: "deer rut timing west virginia | peak November 12-22, chasing November 5-12" },
  { title: "deer rut: maryland", content: "Maryland peak breeding occurs November 8-18; the western mountains may run 3-5 days earlier than the Eastern Shore.", content_type: "deer-pattern", tags: ["deer", "maryland", "rut", "timing"], richText: "deer rut timing maryland | peak November 8-18, western mountains run earlier" },
  { title: "deer rut: connecticut", content: "Connecticut rut peaks November 10-20; suburban deer density means bucks can locate does quickly, compressing the chasing phase.", content_type: "deer-pattern", tags: ["deer", "connecticut", "rut", "timing"], richText: "deer rut timing connecticut | peak November 10-20, compressed chasing" },
  { title: "deer rut: maine", content: "Maine peak breeding runs November 12-25; northern Maine may peak as late as early December in remote areas.", content_type: "deer-pattern", tags: ["deer", "maine", "rut", "timing"], richText: "deer rut timing maine | peak November 12-25, northern areas later" },
  { title: "deer rut: vermont", content: "Vermont rut peaks November 10-20; the rifle season in mid-November historically coincides with peak chasing activity.", content_type: "deer-pattern", tags: ["deer", "vermont", "rut", "timing"], richText: "deer rut timing vermont | peak November 10-20, overlaps rifle season" },
  { title: "deer rut: new hampshire", content: "New Hampshire peak breeding occurs November 8-18; the White Mountains see strong rutting activity November 5-15.", content_type: "deer-pattern", tags: ["deer", "new hampshire", "rut", "timing"], richText: "deer rut timing new hampshire | peak November 8-18" },

  // South/Central
  { title: "deer rut: texas", content: "Texas rut timing varies wildly: Hill Country peaks November 1-15, South Texas peaks mid-December through early January, and the Panhandle peaks mid-November.", content_type: "deer-pattern", tags: ["deer", "texas", "rut", "timing"], richText: "deer rut timing texas | Hill Country November 1-15, South Texas mid-December" },
  { title: "deer rut: oklahoma", content: "Oklahoma peak breeding runs November 10-22; southeastern counties tend to run a week later than the panhandle and northwest.", content_type: "deer-pattern", tags: ["deer", "oklahoma", "rut", "timing"], richText: "deer rut timing oklahoma | peak November 10-22, SE runs later" },
  { title: "deer rut: kentucky", content: "Kentucky rut peaks November 8-18 statewide; Land Between the Lakes and western zones see peak chasing November 5-12.", content_type: "deer-pattern", tags: ["deer", "kentucky", "rut", "timing"], richText: "deer rut timing kentucky | peak November 8-18, LBL chasing November 5-12" },

  // West
  { title: "deer rut: colorado", content: "Colorado mule deer rut peaks November 10-25; whitetail rut runs November 5-15 in the eastern plains.", content_type: "deer-pattern", tags: ["deer", "colorado", "rut", "timing", "mule deer"], richText: "deer rut timing colorado | mule deer November 10-25, whitetail November 5-15 plains" },
  { title: "deer rut: montana", content: "Montana whitetail rut peaks November 10-20; mule deer breeding peaks November 15-25 in the breaks and prairie.", content_type: "deer-pattern", tags: ["deer", "montana", "rut", "timing"], richText: "deer rut timing montana | whitetail November 10-20, mule deer November 15-25" },
  { title: "deer rut: wyoming", content: "Wyoming mule deer rut peaks November 15-25; whitetail breeding in the eastern river bottoms peaks November 8-18.", content_type: "deer-pattern", tags: ["deer", "wyoming", "rut", "timing", "mule deer"], richText: "deer rut timing wyoming | mule deer November 15-25, whitetail November 8-18" },
  { title: "deer rut: idaho", content: "Idaho mule deer rut peaks November 15-30; whitetail rut in the panhandle peaks November 10-20.", content_type: "deer-pattern", tags: ["deer", "idaho", "rut", "timing"], richText: "deer rut timing idaho | mule deer November 15-30, whitetail November 10-20 panhandle" },
  { title: "deer rut: oregon", content: "Oregon blacktail rut peaks November 10-25; mule deer in the eastern high desert breed November 15-30.", content_type: "deer-pattern", tags: ["deer", "oregon", "rut", "timing", "blacktail"], richText: "deer rut timing oregon | blacktail November 10-25, mule deer November 15-30" },
  { title: "deer rut: washington", content: "Washington blacktail rut peaks November 10-20 west of the Cascades; mule deer east of the Cascades breed November 15-25.", content_type: "deer-pattern", tags: ["deer", "washington", "rut", "timing"], richText: "deer rut timing washington | blacktail November 10-20, mule deer November 15-25" },
  { title: "deer rut: south dakota", content: "South Dakota whitetail rut peaks November 8-18; mule deer in the Black Hills breed November 12-22.", content_type: "deer-pattern", tags: ["deer", "south dakota", "rut", "timing"], richText: "deer rut timing south dakota | whitetail November 8-18, mule deer November 12-22" },
  { title: "deer rut: north dakota", content: "North Dakota whitetail rut peaks November 5-15; river bottom bucks are most active during the chasing phase November 1-10.", content_type: "deer-pattern", tags: ["deer", "north dakota", "rut", "timing"], richText: "deer rut timing north dakota | peak November 5-15, chasing November 1-10" },

  // Moon phase correlation
  { title: "deer moon phase: full moon", content: "During full moon phases, mature bucks tend to feed more at night and move less during daylight; mid-day sits from 10am-2pm become more productive.", content_type: "deer-pattern", tags: ["deer", "moon", "rut", "movement"], richText: "deer moon phase pattern | full moon bucks feed at night, mid-day sits more productive" },
  { title: "deer moon phase: new moon", content: "New moon phases during the rut correlate with increased daylight deer movement; bucks are more likely to be on their feet during traditional morning and evening periods.", content_type: "deer-pattern", tags: ["deer", "moon", "rut", "movement"], richText: "deer moon phase pattern | new moon increases daylight movement during rut" },
  { title: "deer moon phase: rutting moon", content: "The second full moon after the autumn equinox (the 'rutting moon') historically correlates with peak scraping activity and the onset of the seeking phase.", content_type: "deer-pattern", tags: ["deer", "moon", "rut", "scraping"], richText: "deer moon phase | rutting moon triggers seeking phase and peak scraping" },
  { title: "deer moon phase: quarter moon", content: "Quarter moon phases often produce the most consistent deer movement at dawn and dusk; movement patterns are less disrupted than full or new moon phases.", content_type: "deer-pattern", tags: ["deer", "moon", "movement"], richText: "deer moon phase | quarter moon consistent dawn/dusk movement" },
  { title: "deer moon phase: overhead", content: "When the moon is directly overhead or underfoot, deer feeding activity peaks regardless of phase; these major solunar periods can trigger mid-day movement during the rut.", content_type: "deer-pattern", tags: ["deer", "moon", "solunar", "movement"], richText: "deer moon phase | overhead/underfoot moon triggers feeding regardless of phase" },

  // Cold snap / weather triggers
  { title: "deer cold snap: first frost", content: "The first hard frost of fall dramatically increases deer movement as browse becomes less palatable and deer shift to mast crops; expect 40-60% more trail cam activity.", content_type: "deer-pattern", tags: ["deer", "weather", "cold", "frost", "movement"], richText: "deer cold snap | first hard frost increases movement 40-60%, browse shift to mast" },
  { title: "deer cold snap: temperature drop", content: "A temperature drop of 15+ degrees from the previous day triggers significant deer movement; bucks feed aggressively to replenish calories burned during the rut.", content_type: "deer-pattern", tags: ["deer", "weather", "cold", "temperature", "movement"], richText: "deer cold snap | 15+ degree drop triggers aggressive feeding and movement" },
  { title: "deer cold snap: post-front", content: "The first calm, cold morning after a major cold front passes is one of the best deer hunting conditions; deer that bedded during the storm will be moving to feed.", content_type: "deer-pattern", tags: ["deer", "weather", "cold", "front", "movement"], richText: "deer cold snap | calm cold morning after front = best conditions" },
  { title: "deer cold snap: extended cold", content: "Three or more consecutive days below seasonal averages push deer into predictable feeding patterns near food sources; set up on travel corridors between bedding and food.", content_type: "deer-pattern", tags: ["deer", "weather", "cold", "pattern", "food"], richText: "deer cold snap | 3+ days below average = predictable food source patterns" },
  { title: "deer cold snap: rut temperature", content: "Temperatures in the 20s-40s during the rut produce the most daylight buck activity; anything above 60F during November suppresses movement significantly.", content_type: "deer-pattern", tags: ["deer", "weather", "cold", "rut", "temperature"], richText: "deer cold snap | 20s-40s optimal rut temps, above 60F suppresses movement" },
  { title: "deer cold snap: thermal regulation", content: "When temperatures rise above 50F during November, bucks become semi-nocturnal to avoid overheating while chasing does; hunt the first and last 30 minutes of light.", content_type: "deer-pattern", tags: ["deer", "weather", "warm", "nocturnal"], richText: "deer weather | warm November temps make bucks nocturnal, hunt edges of daylight" },

  // Barometric pressure
  { title: "deer pressure: rising barometer", content: "A rising barometer after a weather system passes is one of the strongest deer movement triggers; deer sense improving conditions and feed actively.", content_type: "deer-pattern", tags: ["deer", "pressure", "barometer", "movement"], richText: "deer barometric pressure | rising barometer after storm = strong movement trigger" },
  { title: "deer pressure: high stable", content: "Stable high pressure (30.0-30.4 inHg) produces consistent but moderate deer movement; deer maintain normal feeding routines.", content_type: "deer-pattern", tags: ["deer", "pressure", "barometer", "stable"], richText: "deer barometric pressure | stable high pressure 30.0-30.4 = consistent movement" },
  { title: "deer pressure: dropping fast", content: "A rapidly dropping barometer (>0.15 inHg/hr) signals an incoming storm and triggers a feeding frenzy; deer gorge before fronts arrive.", content_type: "deer-pattern", tags: ["deer", "pressure", "barometer", "storm", "feeding"], richText: "deer barometric pressure | dropping fast >0.15/hr triggers pre-storm feeding frenzy" },
  { title: "deer pressure: low barometer", content: "Low barometric pressure below 29.8 inHg typically suppresses deer movement; deer bed down in thick cover during storm systems.", content_type: "deer-pattern", tags: ["deer", "pressure", "barometer", "low", "bedding"], richText: "deer barometric pressure | below 29.8 suppresses movement, deer bed in thick cover" },
  { title: "deer pressure: transition zone", content: "The transition period as barometric pressure crosses 30.0 inHg in either direction is a reliable deer movement window; stand time 2 hours before and after the shift.", content_type: "deer-pattern", tags: ["deer", "pressure", "barometer", "transition"], richText: "deer barometric pressure | crossing 30.0 in either direction triggers movement" },

  // Wind patterns
  { title: "deer wind: optimal speed", content: "Deer move most actively in wind speeds of 5-15 mph; this range provides enough noise cover for deer to feel comfortable but not enough to impair their senses.", content_type: "deer-pattern", tags: ["deer", "wind", "speed", "movement"], richText: "deer wind pattern | 5-15 mph optimal for movement, noise cover without sense impairment" },
  { title: "deer wind: high wind", content: "Winds above 20 mph significantly reduce deer movement; deer bed in thick cover on leeward hillsides to avoid wind chill.", content_type: "deer-pattern", tags: ["deer", "wind", "high", "bedding"], richText: "deer wind pattern | above 20 mph reduces movement, deer bed leeward" },
  { title: "deer wind: swirling wind", content: "Swirling or variable wind directions make stand hunting difficult as scent disperses unpredictably; still-hunting or ground blinds on field edges become better options.", content_type: "deer-pattern", tags: ["deer", "wind", "swirling", "scent"], richText: "deer wind pattern | swirling wind spreads scent, still-hunt or use ground blinds" },
  { title: "deer wind: north wind", content: "In most of the eastern US, a north wind after a front passage is a prime hunting indicator; deer associate north winds with cold stable conditions and move to feed.", content_type: "deer-pattern", tags: ["deer", "wind", "north", "front", "movement"], richText: "deer wind pattern | north wind after front = prime hunting, deer move to feed" },
  { title: "deer wind: thermals", content: "Morning thermals pull air downhill in valleys; set up above deer trails early and move to lower positions as afternoon thermals push air uphill.", content_type: "deer-pattern", tags: ["deer", "wind", "thermals", "terrain", "strategy"], richText: "deer wind pattern | morning thermals downhill, afternoon uphill, position accordingly" },
  { title: "deer wind: calm conditions", content: "Dead calm conditions (<3 mph) make deer hyper-alert; every sound carries and scent lingers — but rut-crazed bucks will still move despite calm air.", content_type: "deer-pattern", tags: ["deer", "wind", "calm", "scent", "rut"], richText: "deer wind pattern | dead calm deer hyper-alert, but rut bucks still move" },

  // Additional rut states
  { title: "deer rut: new mexico", content: "New Mexico mule deer rut peaks November 20-December 5; Coues deer in the Bootheel breed late January through February.", content_type: "deer-pattern", tags: ["deer", "new mexico", "rut", "timing", "mule deer"], richText: "deer rut timing new mexico | mule deer November 20-December 5, Coues late January" },
  { title: "deer rut: arizona", content: "Arizona Coues deer rut peaks late January through mid-February; mule deer breed December through early January depending on unit.", content_type: "deer-pattern", tags: ["deer", "arizona", "rut", "timing", "coues"], richText: "deer rut timing arizona | Coues late January, mule deer December" },
  { title: "deer rut: california", content: "California blacktail rut peaks November 10-25; mule deer in the eastern Sierra breed late November through mid-December.", content_type: "deer-pattern", tags: ["deer", "california", "rut", "timing", "blacktail"], richText: "deer rut timing california | blacktail November 10-25, mule deer late November" },
  { title: "deer rut: new jersey", content: "New Jersey rut peaks November 8-18; the state's high deer density means bucks encounter does quickly, producing intense but short chasing phases.", content_type: "deer-pattern", tags: ["deer", "new jersey", "rut", "timing"], richText: "deer rut timing new jersey | peak November 8-18, high density short chasing" },
  { title: "deer rut: massachusetts", content: "Massachusetts rut peaks November 10-22; bowhunters see the best chasing action from November 3-12.", content_type: "deer-pattern", tags: ["deer", "massachusetts", "rut", "timing"], richText: "deer rut timing massachusetts | peak November 10-22, chasing November 3-12" },
  { title: "deer rut: delaware", content: "Delaware rut peaks November 8-18; the shotgun season opener in mid-November aligns with peak breeding in most years.", content_type: "deer-pattern", tags: ["deer", "delaware", "rut", "timing"], richText: "deer rut timing delaware | peak November 8-18" },

  // Post-rut / second rut
  { title: "deer post-rut: general", content: "Post-rut bucks are exhausted and calorie-depleted; hunt food sources like corn, brassicas, and winter wheat from mid-December through January.", content_type: "deer-pattern", tags: ["deer", "rut", "post-rut", "food", "late season"], richText: "deer post-rut | exhausted bucks focus on food sources December-January" },
  { title: "deer second rut: timing", content: "The second rut occurs 28 days after peak breeding when unbred does and doe fawns cycle; expect a smaller spike in buck activity mid-December in most northern states.", content_type: "deer-pattern", tags: ["deer", "rut", "second rut", "timing"], richText: "deer second rut | 28 days after peak, mid-December spike from unbred does" },

  // Food source patterns
  { title: "deer food: early season acorns", content: "When white oak acorns drop in early October, deer will abandon other food sources to gorge on them; find the dropping white oaks and you find the deer.", content_type: "deer-pattern", tags: ["deer", "food", "acorns", "early season", "white oak"], richText: "deer food pattern | white oak acorn drop early October concentrates deer" },
  { title: "deer food: late season ag fields", content: "Standing corn and picked soybean fields are deer magnets from December through February; set up downwind on field edges during the last 90 minutes of daylight.", content_type: "deer-pattern", tags: ["deer", "food", "corn", "soybeans", "late season"], richText: "deer food pattern | standing corn and bean fields concentrate late season deer" },
  { title: "deer food: food plot timing", content: "Brassica food plots become most attractive after the first hard freeze converts starches to sugars; deer ignore brassicas in warm weather but devour them after frost.", content_type: "deer-pattern", tags: ["deer", "food", "food plot", "brassica", "frost"], richText: "deer food pattern | brassicas sweeten after frost, deer preference skyrockets" },

  // Additional states
  { title: "deer rut: utah", content: "Utah mule deer rut peaks November 10-25; the limited-entry units in the Book Cliffs and Henry Mountains see peak activity November 15-22.", content_type: "deer-pattern", tags: ["deer", "utah", "rut", "timing", "mule deer"], richText: "deer rut timing utah | mule deer November 10-25, Book Cliffs/Henrys peak November 15-22" },
  { title: "deer rut: nevada", content: "Nevada mule deer rut peaks November 15-30; desert mule deer breed later than mountain populations.", content_type: "deer-pattern", tags: ["deer", "nevada", "rut", "timing", "mule deer"], richText: "deer rut timing nevada | mule deer November 15-30, desert populations later" },

  // Scraping behavior
  { title: "deer scraping: peak activity", content: "Scraping activity peaks 2-3 weeks before breeding; the highest volume of fresh scrapes indicates the seeking phase is underway and bucks are actively cruising for does.", content_type: "deer-pattern", tags: ["deer", "scraping", "rut", "pre-rut", "sign"], richText: "deer scraping | peak 2-3 weeks before breeding, indicates seeking phase" },
  { title: "deer scraping: licking branches", content: "The overhanging licking branch above a scrape is more important than the scrape itself; bucks check licking branches year-round and most scrape visits happen at night.", content_type: "deer-pattern", tags: ["deer", "scraping", "licking branch", "sign"], richText: "deer scraping | licking branch more important than scrape, checked year-round" },

  // Terrain / habitat
  { title: "deer terrain: saddles", content: "Saddles between ridge points are natural deer travel corridors; bucks use saddles to cross ridges with minimal energy and exposure.", content_type: "deer-pattern", tags: ["deer", "terrain", "saddle", "travel", "strategy"], richText: "deer terrain | saddles between ridges are natural travel corridors for bucks" },
  { title: "deer terrain: bedding ridges", content: "Mature bucks bed on points and ridges where thermals and wind give them a scent advantage; they face downhill to watch their backtrail with wind at their back.", content_type: "deer-pattern", tags: ["deer", "terrain", "bedding", "ridges", "mature buck"], richText: "deer terrain | mature bucks bed on points, face downhill, wind at back" },
  { title: "deer terrain: pinch points", content: "Terrain pinch points where cover narrows between two open areas funnel deer movement; inside corners where field edges meet timber are high-percentage stand locations.", content_type: "deer-pattern", tags: ["deer", "terrain", "pinch point", "funnel", "strategy"], richText: "deer terrain | pinch points and inside corners funnel deer movement" },

  // Additional states
  { title: "deer rut: hawaii", content: "Hawaii axis deer do not have a defined rut; breeding occurs year-round with minor peaks that vary by island and rainfall patterns.", content_type: "deer-pattern", tags: ["deer", "hawaii", "rut", "timing", "axis deer"], richText: "deer rut timing hawaii | axis deer breed year-round, no defined rut" },
  { title: "deer rut: alaska", content: "Alaska Sitka blacktail rut peaks November 1-15; bucks move to alpine meadows during the rut and are most vulnerable during the chasing phase.", content_type: "deer-pattern", tags: ["deer", "alaska", "rut", "timing", "blacktail"], richText: "deer rut timing alaska | Sitka blacktail November 1-15, alpine meadows" },

  // Rain / precipitation
  { title: "deer rain: light rain", content: "Light drizzle and mist are excellent deer hunting conditions; sound is dampened, scent dissipates faster, and deer feel secure moving in low-visibility weather.", content_type: "deer-pattern", tags: ["deer", "weather", "rain", "movement"], richText: "deer rain pattern | light drizzle excellent conditions, dampens sound and scent" },
  { title: "deer rain: heavy rain", content: "Heavy, sustained rain shuts down deer movement; wait for the rain to break and hunt the first 2 hours of clearing weather for explosive activity.", content_type: "deer-pattern", tags: ["deer", "weather", "rain", "heavy", "post-rain"], richText: "deer rain pattern | heavy rain shuts movement, hunt first 2 hours of clearing" },

  // Fog
  { title: "deer fog: morning fog", content: "Dense morning fog often delays deer movement by 30-60 minutes; deer wait for visibility to improve before crossing open areas, compressing feeding activity.", content_type: "deer-pattern", tags: ["deer", "weather", "fog", "morning", "movement"], richText: "deer fog pattern | morning fog delays movement 30-60 min, compresses feeding" },

  // Hunting pressure
  { title: "deer pressure: opening day", content: "Opening day of gun season pushes deer into thick cover and shifts movement patterns to nocturnal; by day 3, deer on unpressured private land return to normal patterns.", content_type: "deer-pattern", tags: ["deer", "hunting pressure", "gun season", "nocturnal"], richText: "deer hunting pressure | opening day shifts movement nocturnal, recovery by day 3 on private" },
  { title: "deer pressure: public land", content: "On public land, the best deer hunting is often 1+ mile from the nearest road or parking area; most hunters don't walk more than 400 yards from their vehicle.", content_type: "deer-pattern", tags: ["deer", "hunting pressure", "public land", "strategy"], richText: "deer hunting pressure | 1+ mile from roads on public land avoids most pressure" },
];

// ============================================================
// TURKEY DATA (~80 entries)
// ============================================================

const turkeyEntries: PreparedEntry[] = [
  // Spring gobble peak by state — Southeast
  { title: "turkey gobble peak: alabama", content: "Alabama spring gobble activity peaks March 15-April 5; gobblers are most vocal during the first 2 weeks of the March 15 opener.", content_type: "turkey-pattern", tags: ["turkey", "alabama", "spring", "gobble", "timing"], richText: "turkey gobble peak alabama | March 15-April 5, most vocal first 2 weeks of opener" },
  { title: "turkey gobble peak: georgia", content: "Georgia spring gobble peaks March 20-April 10; piedmont birds tend to peak a week later than mountain populations.", content_type: "turkey-pattern", tags: ["turkey", "georgia", "spring", "gobble", "timing"], richText: "turkey gobble peak georgia | March 20-April 10, piedmont later than mountains" },
  { title: "turkey gobble peak: mississippi", content: "Mississippi gobble activity peaks March 15-April 1; Delta region birds vocalize heavily in late March before hens begin nesting.", content_type: "turkey-pattern", tags: ["turkey", "mississippi", "spring", "gobble", "timing"], richText: "turkey gobble peak mississippi | March 15-April 1, Delta late March" },
  { title: "turkey gobble peak: florida", content: "Florida's Osceola turkey gobble peaks mid-March; season opens as early as March 1 in some zones, catching the tail end of henned-up gobbler frustration.", content_type: "turkey-pattern", tags: ["turkey", "florida", "spring", "gobble", "timing", "osceola"], richText: "turkey gobble peak florida | Osceola mid-March, season opens March 1" },
  { title: "turkey gobble peak: south carolina", content: "South Carolina gobble activity peaks March 20-April 5; coastal birds may peak earlier while piedmont birds hit stride in late March.", content_type: "turkey-pattern", tags: ["turkey", "south carolina", "spring", "gobble", "timing"], richText: "turkey gobble peak south carolina | March 20-April 5" },
  { title: "turkey gobble peak: north carolina", content: "North Carolina spring gobble peaks April 5-20; mountain birds may not hit full stride until mid-April.", content_type: "turkey-pattern", tags: ["turkey", "north carolina", "spring", "gobble", "timing"], richText: "turkey gobble peak north carolina | April 5-20, mountain birds peak mid-April" },
  { title: "turkey gobble peak: virginia", content: "Virginia gobble peaks April 10-25; the Blue Ridge and Shenandoah Valley produce some of the best gobbling in the eastern US.", content_type: "turkey-pattern", tags: ["turkey", "virginia", "spring", "gobble", "timing"], richText: "turkey gobble peak virginia | April 10-25, Blue Ridge outstanding gobbling" },
  { title: "turkey gobble peak: tennessee", content: "Tennessee gobble activity peaks April 1-15; the state's early April opener often catches the transition from henned-up to lonely gobbler behavior.", content_type: "turkey-pattern", tags: ["turkey", "tennessee", "spring", "gobble", "timing"], richText: "turkey gobble peak tennessee | April 1-15, catches transition to lonely gobblers" },
  { title: "turkey gobble peak: arkansas", content: "Arkansas gobble peaks March 25-April 10; Ozark mountain birds are particularly vocal in early April.", content_type: "turkey-pattern", tags: ["turkey", "arkansas", "spring", "gobble", "timing"], richText: "turkey gobble peak arkansas | March 25-April 10, Ozarks vocal early April" },
  { title: "turkey gobble peak: louisiana", content: "Louisiana gobble activity peaks March 10-25; southern parishes see earlier gobbling, often starting strong by late February.", content_type: "turkey-pattern", tags: ["turkey", "louisiana", "spring", "gobble", "timing"], richText: "turkey gobble peak louisiana | March 10-25, southern parishes earlier" },
  { title: "turkey gobble peak: texas", content: "Texas Rio Grande turkey gobble peaks mid-March through early April; the Hill Country and South Texas are premier spring hunting destinations.", content_type: "turkey-pattern", tags: ["turkey", "texas", "spring", "gobble", "timing", "rio grande"], richText: "turkey gobble peak texas | Rio Grande mid-March to early April, Hill Country prime" },
  { title: "turkey gobble peak: kentucky", content: "Kentucky gobble peaks April 10-25; the state's mid-April opener aligns well with the transition from breeding to lonely gobbler phase.", content_type: "turkey-pattern", tags: ["turkey", "kentucky", "spring", "gobble", "timing"], richText: "turkey gobble peak kentucky | April 10-25, mid-April opener well-timed" },

  // Midwest
  { title: "turkey gobble peak: missouri", content: "Missouri spring gobble peaks April 10-25; the first week of the April 15 opener is typically the best hunting of the season.", content_type: "turkey-pattern", tags: ["turkey", "missouri", "spring", "gobble", "timing"], richText: "turkey gobble peak missouri | April 10-25, first week of opener best" },
  { title: "turkey gobble peak: iowa", content: "Iowa gobble peaks April 15-30; the state's late April opener catches gobblers coming off peak breeding with increased responsiveness.", content_type: "turkey-pattern", tags: ["turkey", "iowa", "spring", "gobble", "timing"], richText: "turkey gobble peak iowa | April 15-30, late opener catches responsive birds" },
  { title: "turkey gobble peak: kansas", content: "Kansas gobble activity peaks April 10-25; the Flint Hills Rio Grande x Eastern hybrid birds are some of the most vocal in the country.", content_type: "turkey-pattern", tags: ["turkey", "kansas", "spring", "gobble", "timing"], richText: "turkey gobble peak kansas | April 10-25, Flint Hills hybrids very vocal" },
  { title: "turkey gobble peak: nebraska", content: "Nebraska Merriam's turkey gobble peaks April 15-May 1; the Pine Ridge and Niobrara Valley see peak activity late April.", content_type: "turkey-pattern", tags: ["turkey", "nebraska", "spring", "gobble", "timing", "merriams"], richText: "turkey gobble peak nebraska | Merriam's April 15-May 1, Pine Ridge late April" },
  { title: "turkey gobble peak: ohio", content: "Ohio gobble peaks April 15-30; the April 22 opener in most years catches the sweet spot between peak breeding and lonely gobbler phase.", content_type: "turkey-pattern", tags: ["turkey", "ohio", "spring", "gobble", "timing"], richText: "turkey gobble peak ohio | April 15-30, opener catches sweet spot" },
  { title: "turkey gobble peak: michigan", content: "Michigan gobble peaks April 20-May 5; Upper Peninsula birds peak about a week later than southern Lower Peninsula populations.", content_type: "turkey-pattern", tags: ["turkey", "michigan", "spring", "gobble", "timing"], richText: "turkey gobble peak michigan | April 20-May 5, UP later than southern LP" },
  { title: "turkey gobble peak: wisconsin", content: "Wisconsin gobble activity peaks April 20-May 5; the late April opener often coincides with some of the best gobbling of the year.", content_type: "turkey-pattern", tags: ["turkey", "wisconsin", "spring", "gobble", "timing"], richText: "turkey gobble peak wisconsin | April 20-May 5, late April opener well-timed" },
  { title: "turkey gobble peak: minnesota", content: "Minnesota gobble peaks April 20-May 5; the southwestern farmland region typically hears the first strong gobbling of spring.", content_type: "turkey-pattern", tags: ["turkey", "minnesota", "spring", "gobble", "timing"], richText: "turkey gobble peak minnesota | April 20-May 5, SW farmland first to gobble" },
  { title: "turkey gobble peak: indiana", content: "Indiana gobble peaks April 15-30; turkey density is highest in the southern hill country and the April 24 opener hits peak vocalization.", content_type: "turkey-pattern", tags: ["turkey", "indiana", "spring", "gobble", "timing"], richText: "turkey gobble peak indiana | April 15-30, southern hills densest populations" },
  { title: "turkey gobble peak: illinois", content: "Illinois gobble peaks April 10-25; the Shawnee National Forest in the south hears strong gobbling by early April.", content_type: "turkey-pattern", tags: ["turkey", "illinois", "spring", "gobble", "timing"], richText: "turkey gobble peak illinois | April 10-25, Shawnee NF early April" },

  // Northeast
  { title: "turkey gobble peak: pennsylvania", content: "Pennsylvania gobble peaks April 20-May 5; the May 1 opener catches the transition to lonely gobblers that are highly callable.", content_type: "turkey-pattern", tags: ["turkey", "pennsylvania", "spring", "gobble", "timing"], richText: "turkey gobble peak pennsylvania | April 20-May 5, May 1 opener catches lonely birds" },
  { title: "turkey gobble peak: new york", content: "New York gobble peaks May 1-15; the May 1 opener in most years aligns well with peak vocalization across the state.", content_type: "turkey-pattern", tags: ["turkey", "new york", "spring", "gobble", "timing"], richText: "turkey gobble peak new york | May 1-15, opener aligns with peak" },
  { title: "turkey gobble peak: west virginia", content: "West Virginia gobble peaks April 15-30; mountain hollows echo and amplify gobbling, making WV one of the most exciting spring hunting states.", content_type: "turkey-pattern", tags: ["turkey", "west virginia", "spring", "gobble", "timing"], richText: "turkey gobble peak west virginia | April 15-30, mountain echoes amplify gobbling" },
  { title: "turkey gobble peak: maryland", content: "Maryland gobble peaks April 15-30; western Garrett County birds peak about a week later than Eastern Shore populations.", content_type: "turkey-pattern", tags: ["turkey", "maryland", "spring", "gobble", "timing"], richText: "turkey gobble peak maryland | April 15-30, western later than Eastern Shore" },
  { title: "turkey gobble peak: maine", content: "Maine gobble peaks May 5-20; the late opener catches gobbling at its absolute peak as breeding winds down in northern New England.", content_type: "turkey-pattern", tags: ["turkey", "maine", "spring", "gobble", "timing"], richText: "turkey gobble peak maine | May 5-20, late opener catches peak gobbling" },
  { title: "turkey gobble peak: vermont", content: "Vermont gobble peaks May 1-15; Green Mountain gobbling kicks into high gear by the first week of May.", content_type: "turkey-pattern", tags: ["turkey", "vermont", "spring", "gobble", "timing"], richText: "turkey gobble peak vermont | May 1-15, Green Mountains high gear early May" },
  { title: "turkey gobble peak: new hampshire", content: "New Hampshire gobble peaks May 1-15; the White Mountains corridor produces consistent gobbling starting late April.", content_type: "turkey-pattern", tags: ["turkey", "new hampshire", "spring", "gobble", "timing"], richText: "turkey gobble peak new hampshire | May 1-15" },

  // West
  { title: "turkey gobble peak: colorado", content: "Colorado Merriam's turkey gobble peaks April 15-May 1; the eastern plains Rio Grande birds peak about a week earlier.", content_type: "turkey-pattern", tags: ["turkey", "colorado", "spring", "gobble", "timing", "merriams"], richText: "turkey gobble peak colorado | Merriam's April 15-May 1, plains Rio Grande earlier" },
  { title: "turkey gobble peak: montana", content: "Montana Merriam's gobble peaks April 20-May 5; the Breaks and pine-covered ridges of central Montana are prime habitat.", content_type: "turkey-pattern", tags: ["turkey", "montana", "spring", "gobble", "timing", "merriams"], richText: "turkey gobble peak montana | Merriam's April 20-May 5, central MT prime" },
  { title: "turkey gobble peak: south dakota", content: "South Dakota Merriam's gobble peaks April 15-30; the Black Hills produce consistent spring hunting with accessible public land.", content_type: "turkey-pattern", tags: ["turkey", "south dakota", "spring", "gobble", "timing", "merriams"], richText: "turkey gobble peak south dakota | Merriam's April 15-30, Black Hills public land" },
  { title: "turkey gobble peak: wyoming", content: "Wyoming Merriam's gobble peaks April 20-May 5; the Black Hills and Bighorn Mountains are primary turkey habitat.", content_type: "turkey-pattern", tags: ["turkey", "wyoming", "spring", "gobble", "timing", "merriams"], richText: "turkey gobble peak wyoming | Merriam's April 20-May 5, Black Hills and Bighorns" },
  { title: "turkey gobble peak: oregon", content: "Oregon Rio Grande turkey gobble peaks April 10-25; the eastern valleys and oak woodlands produce strong gobbling.", content_type: "turkey-pattern", tags: ["turkey", "oregon", "spring", "gobble", "timing", "rio grande"], richText: "turkey gobble peak oregon | Rio Grande April 10-25, eastern valleys" },
  { title: "turkey gobble peak: california", content: "California Rio Grande gobble peaks March 15-April 5; the Central Valley and Sierra foothill populations gobble earliest.", content_type: "turkey-pattern", tags: ["turkey", "california", "spring", "gobble", "timing", "rio grande"], richText: "turkey gobble peak california | Rio Grande March 15-April 5, Central Valley earliest" },
  { title: "turkey gobble peak: washington", content: "Washington Merriam's and Rio Grande gobble peaks April 15-30; eastern Washington valleys are the primary hunting areas.", content_type: "turkey-pattern", tags: ["turkey", "washington", "spring", "gobble", "timing"], richText: "turkey gobble peak washington | April 15-30, eastern valleys" },
  { title: "turkey gobble peak: oklahoma", content: "Oklahoma Rio Grande gobble peaks March 25-April 10; the opener typically falls during the sweet spot of vocal gobbler activity.", content_type: "turkey-pattern", tags: ["turkey", "oklahoma", "spring", "gobble", "timing", "rio grande"], richText: "turkey gobble peak oklahoma | Rio Grande March 25-April 10" },

  // Weather sensitivity
  { title: "turkey weather: wind threshold", content: "Turkey gobbling drops significantly in winds above 12-15 mph; gobblers struggle to hear hen calls and hens struggle to locate gobblers, suppressing vocal activity.", content_type: "turkey-pattern", tags: ["turkey", "weather", "wind", "gobble"], richText: "turkey weather | wind above 12-15 mph suppresses gobbling significantly" },
  { title: "turkey weather: rain shutdown", content: "Steady rain virtually eliminates gobbling from the roost; turkeys fly down silently and move to open fields where visibility compensates for suppressed hearing.", content_type: "turkey-pattern", tags: ["turkey", "weather", "rain", "gobble", "fields"], richText: "turkey weather | steady rain eliminates roost gobbling, birds move to open fields" },
  { title: "turkey weather: light rain", content: "Light mist or drizzle can produce excellent hunting; turkeys move to open fields and logging roads where they can see and their feathers dry, making them more approachable.", content_type: "turkey-pattern", tags: ["turkey", "weather", "rain", "light", "fields"], richText: "turkey weather | light mist pushes turkeys to open areas, good hunting" },
  { title: "turkey weather: post-storm", content: "The first clear morning after a multi-day storm produces explosive gobbling; cooped-up gobblers let loose with pent-up vocalization at first light.", content_type: "turkey-pattern", tags: ["turkey", "weather", "post-storm", "gobble"], richText: "turkey weather | first clear morning after storm = explosive gobbling" },
  { title: "turkey weather: temperature sweet spot", content: "Turkey gobbling is most intense on calm mornings between 40-60°F; cold snaps below freezing often delay fly-down and suppress gobbling from the roost.", content_type: "turkey-pattern", tags: ["turkey", "weather", "temperature", "gobble"], richText: "turkey weather | 40-60°F calm mornings best gobbling, below freezing suppresses" },
  { title: "turkey weather: barometric trigger", content: "A rising barometer the morning after a front passes triggers some of the most intense gobbling of the spring season; plan hunts around post-frontal mornings.", content_type: "turkey-pattern", tags: ["turkey", "weather", "pressure", "barometer", "gobble"], richText: "turkey weather | rising barometer after front triggers intense gobbling" },
  { title: "turkey weather: fog effect", content: "Thick morning fog delays fly-down by 15-30 minutes and often reduces gobbling intensity; set up closer than normal as sound doesn't carry well in fog.", content_type: "turkey-pattern", tags: ["turkey", "weather", "fog", "fly-down"], richText: "turkey weather | fog delays fly-down 15-30 min, set up closer" },
  { title: "turkey weather: warm front", content: "The arrival of a warm front with south winds and rising temps in late March/April can trigger the first big gobbling wave of spring.", content_type: "turkey-pattern", tags: ["turkey", "weather", "warm front", "spring", "gobble"], richText: "turkey weather | warm front with south winds triggers first big gobbling wave" },

  // Roosting behavior
  { title: "turkey roost: site selection", content: "Turkeys roost in the tallest trees with horizontal branches, usually along ridges, creek bottoms, or field edges; they prefer trees with open understory for safe fly-down.", content_type: "turkey-pattern", tags: ["turkey", "roost", "habitat", "trees"], richText: "turkey roosting | tall trees with horizontal branches, open understory for fly-down" },
  { title: "turkey roost: fly-down timing", content: "Turkeys fly down 15-30 minutes after sunrise in most conditions; they fly down earlier on clear calm mornings and later when foggy, windy, or rainy.", content_type: "turkey-pattern", tags: ["turkey", "roost", "fly-down", "timing"], richText: "turkey roosting | fly-down 15-30 min after sunrise, earlier calm mornings" },
  { title: "turkey roost: evening patterns", content: "Turkeys move toward roost areas 1-2 hours before dark; watching evening movements reveals roost locations for next-morning setups.", content_type: "turkey-pattern", tags: ["turkey", "roost", "evening", "scouting"], richText: "turkey roosting | move toward roost 1-2 hours before dark, scout evenings" },
  { title: "turkey roost: late season shifts", content: "As hens begin nesting in late April/May, gobblers roost alone or in pairs and become more receptive to calling; this is the 'lonely gobbler' phase.", content_type: "turkey-pattern", tags: ["turkey", "roost", "late season", "lonely gobbler"], richText: "turkey roosting | late season gobblers roost alone, very callable" },

  // Fall flock dynamics
  { title: "turkey fall: flock structure", content: "Fall turkey flocks consist of hen/poult groups and bachelor gobbler gangs; breaking up a flock and calling scattered birds back is the primary fall hunting tactic.", content_type: "turkey-pattern", tags: ["turkey", "fall", "flock", "scatter", "tactics"], richText: "turkey fall hunting | break flocks, call scattered birds back, hen/poult vs bachelor groups" },
  { title: "turkey fall: feeding patterns", content: "Fall turkeys key in on acorns, waste grain, and soft mast; scout for scratching in leaf litter under oaks to find active feeding areas.", content_type: "turkey-pattern", tags: ["turkey", "fall", "feeding", "acorns", "mast"], richText: "turkey fall hunting | acorns and waste grain, look for scratching in leaf litter" },
  { title: "turkey fall: bachelor groups", content: "Fall bachelor gobbler groups of 3-8 mature toms are tighter-bonded and harder to call back after scattering; give them 30-60 minutes before calling.", content_type: "turkey-pattern", tags: ["turkey", "fall", "bachelor", "gobbler", "tactics"], richText: "turkey fall hunting | bachelor gobbler groups tight-bonded, wait 30-60 min after scatter" },
  { title: "turkey fall: hen poult assembly", content: "Scattered hen/poult groups reassemble quickly — often within 15-20 minutes; use kee-kee and lost yelps to mimic a scattered young bird.", content_type: "turkey-pattern", tags: ["turkey", "fall", "hen", "poult", "calling"], richText: "turkey fall hunting | hen/poult groups reassemble in 15-20 min, use kee-kee calls" },

  // Calling strategies
  { title: "turkey calling: morning approach", content: "Set up 100-150 yards from a roosted gobbler before first light; start with soft tree yelps, then escalate to excited cutting and yelping after fly-down if he won't commit.", content_type: "turkey-pattern", tags: ["turkey", "calling", "morning", "roost", "setup"], richText: "turkey calling | 100-150 yards from roost, soft tree yelps, escalate after fly-down" },
  { title: "turkey calling: midday tactics", content: "Midday from 10am-2pm can be prime turkey time as gobblers lose their hens to nesting; walk and call every 100 yards to locate responsive birds.", content_type: "turkey-pattern", tags: ["turkey", "calling", "midday", "tactics"], richText: "turkey calling | midday 10am-2pm prime as hens nest, run-and-gun every 100 yards" },
  { title: "turkey calling: gobbler resistance", content: "When a gobbler hangs up at 80-100 yards and won't commit, try going silent for 15-20 minutes; curiosity often pulls him in when calling stops.", content_type: "turkey-pattern", tags: ["turkey", "calling", "hang-up", "patience", "tactics"], richText: "turkey calling | gobbler hangs up, go silent 15-20 min, curiosity pulls him in" },

  // Subspecies behavior
  { title: "turkey subspecies: rio grande", content: "Rio Grande turkeys are faster to respond to calling but also faster to leave; they thrive in open rangeland and roost along creek corridors.", content_type: "turkey-pattern", tags: ["turkey", "rio grande", "subspecies", "behavior"], richText: "turkey subspecies | Rio Grande responsive but quick to leave, creek corridor roosts" },
  { title: "turkey subspecies: merriams", content: "Merriam's turkeys are the most approachable subspecies but inhabit rugged mountain terrain; they roost in ponderosa pine and feed in mountain meadows.", content_type: "turkey-pattern", tags: ["turkey", "merriams", "subspecies", "behavior", "mountain"], richText: "turkey subspecies | Merriam's approachable but rugged terrain, ponderosa roosts" },
  { title: "turkey subspecies: eastern", content: "Eastern wild turkeys are the wariest subspecies and the most hunted; they require patient setup strategies and more realistic calling.", content_type: "turkey-pattern", tags: ["turkey", "eastern", "subspecies", "behavior"], richText: "turkey subspecies | Eastern wariest, most hunted, requires patience and realism" },
  { title: "turkey subspecies: osceola", content: "Osceola turkeys are limited to peninsular Florida; they're call-shy, swamp-dwelling, and considered the most difficult subspecies to harvest.", content_type: "turkey-pattern", tags: ["turkey", "osceola", "subspecies", "behavior", "florida"], richText: "turkey subspecies | Osceola Florida only, swamp-dwelling, most difficult to harvest" },

  // Additional states
  { title: "turkey gobble peak: new jersey", content: "New Jersey gobble peaks April 15-30; the April opener catches early vocal birds in the Pine Barrens and northwestern highlands.", content_type: "turkey-pattern", tags: ["turkey", "new jersey", "spring", "gobble", "timing"], richText: "turkey gobble peak new jersey | April 15-30" },
  { title: "turkey gobble peak: connecticut", content: "Connecticut gobble peaks April 20-May 5; the state's high turkey density means multiple gobblers often respond to calling.", content_type: "turkey-pattern", tags: ["turkey", "connecticut", "spring", "gobble", "timing"], richText: "turkey gobble peak connecticut | April 20-May 5, high density multiple responders" },
  { title: "turkey gobble peak: massachusetts", content: "Massachusetts gobble peaks April 20-May 5; late April opener coincides well with peak vocalization across the state.", content_type: "turkey-pattern", tags: ["turkey", "massachusetts", "spring", "gobble", "timing"], richText: "turkey gobble peak massachusetts | April 20-May 5" },
  { title: "turkey gobble peak: idaho", content: "Idaho Merriam's gobble peaks April 15-May 1; the Clearwater and Salmon River drainages hold strong populations.", content_type: "turkey-pattern", tags: ["turkey", "idaho", "spring", "gobble", "timing", "merriams"], richText: "turkey gobble peak idaho | Merriam's April 15-May 1, Clearwater/Salmon drainages" },
  { title: "turkey gobble peak: new mexico", content: "New Mexico Merriam's gobble peaks April 15-May 1; the Sacramento and Sangre de Cristo mountains are premier hunting areas.", content_type: "turkey-pattern", tags: ["turkey", "new mexico", "spring", "gobble", "timing", "merriams"], richText: "turkey gobble peak new mexico | Merriam's April 15-May 1, Sacramento/Sangre de Cristo" },
  { title: "turkey gobble peak: arizona", content: "Arizona Merriam's and Gould's turkey gobble peaks April 10-25; the Kaibab Plateau and southeastern sky islands are key areas.", content_type: "turkey-pattern", tags: ["turkey", "arizona", "spring", "gobble", "timing", "goulds"], richText: "turkey gobble peak arizona | Merriam's/Gould's April 10-25, Kaibab and sky islands" },
];

// ============================================================
// DOVE DATA (~50 entries)
// ============================================================

const doveEntries: PreparedEntry[] = [
  // Migration timing by flyway
  { title: "dove migration: central flyway", content: "Central Flyway dove migration peaks September 15-October 15; cold fronts in late September push massive waves of birds south from the northern plains.", content_type: "dove-pattern", tags: ["dove", "migration", "central flyway", "timing"], richText: "dove migration central flyway | peaks September 15-October 15, late Sept fronts push waves" },
  { title: "dove migration: mississippi flyway", content: "Mississippi Flyway dove migration peaks September 20-October 20; birds stage in harvested grain fields along the river corridor before pushing south.", content_type: "dove-pattern", tags: ["dove", "migration", "mississippi flyway", "timing"], richText: "dove migration mississippi flyway | September 20-October 20, staging in grain fields" },
  { title: "dove migration: atlantic flyway", content: "Atlantic Flyway dove migration peaks October 1-November 1; coastal plain fields see the heaviest flights after northeast cold fronts.", content_type: "dove-pattern", tags: ["dove", "migration", "atlantic flyway", "timing"], richText: "dove migration atlantic flyway | October 1-November 1, northeast fronts drive flights" },
  { title: "dove migration: pacific flyway", content: "Pacific Flyway dove migration peaks September 15-October 15; Central Valley and desert Southwest staging areas concentrate birds.", content_type: "dove-pattern", tags: ["dove", "migration", "pacific flyway", "timing"], richText: "dove migration pacific flyway | September 15-October 15, Central Valley staging" },

  // Field rotation patterns
  { title: "dove fields: sunflower", content: "Standing or recently cut sunflower fields are the #1 dove attractant; plant sunflowers by June 1 to have seed heads mature by dove season opener in September.", content_type: "dove-pattern", tags: ["dove", "fields", "sunflower", "habitat"], richText: "dove field pattern | sunflower fields top attractant, plant by June 1 for September" },
  { title: "dove fields: wheat stubble", content: "Freshly harvested wheat stubble with scattered grain is a prime dove feeding field; dove activity peaks in the first 2-3 weeks after harvest before grain is depleted.", content_type: "dove-pattern", tags: ["dove", "fields", "wheat", "stubble", "harvest"], richText: "dove field pattern | wheat stubble prime first 2-3 weeks after harvest" },
  { title: "dove fields: milo", content: "Milo (grain sorghum) fields attract doves heavily after harvest; the small round seeds are perfectly sized for doves and scatter well across cut stubble.", content_type: "dove-pattern", tags: ["dove", "fields", "milo", "sorghum", "harvest"], richText: "dove field pattern | milo fields attract doves after harvest, ideal seed size" },
  { title: "dove fields: corn stubble", content: "Picked corn fields attract doves but less consistently than sunflower or milo; doves feed on shattered kernels and weed seeds in the stubble.", content_type: "dove-pattern", tags: ["dove", "fields", "corn", "stubble"], richText: "dove field pattern | corn stubble attracts doves, less consistent than sunflower" },
  { title: "dove fields: rotation strategy", content: "Rotate dove hunting pressure between fields every 2-3 days; doves quickly abandon heavily-pressured fields and won't return for 3-5 days.", content_type: "dove-pattern", tags: ["dove", "fields", "rotation", "pressure", "strategy"], richText: "dove field pattern | rotate fields every 2-3 days, doves abandon pressured fields" },
  { title: "dove fields: bare ground", content: "Doves prefer to land on bare or lightly-stubbled ground; fields with thick standing cover are less attractive even if seed is present.", content_type: "dove-pattern", tags: ["dove", "fields", "habitat", "bare ground"], richText: "dove field pattern | doves prefer bare/light stubble, avoid thick standing cover" },
  { title: "dove fields: water proximity", content: "Dove fields within 1 mile of a stock pond, creek, or water source see 3-4x more traffic; doves water 1-3 times daily, usually mid-morning and late afternoon.", content_type: "dove-pattern", tags: ["dove", "fields", "water", "habitat"], richText: "dove field pattern | fields near water see 3-4x more traffic, doves water 1-3x daily" },

  // Weather windows
  { title: "dove weather: cold front trigger", content: "The first strong cold front of September triggers the most dramatic dove migration flights; watch for 15+ degree temperature drops and northwest winds.", content_type: "dove-pattern", tags: ["dove", "weather", "cold front", "migration", "trigger"], richText: "dove weather | first September cold front triggers dramatic migration, 15+ degree drop" },
  { title: "dove weather: overcast advantage", content: "Overcast skies with light wind produce the best dove hunting; doves fly lower under cloud cover and are more active throughout the day rather than just morning/evening.", content_type: "dove-pattern", tags: ["dove", "weather", "overcast", "hunting"], richText: "dove weather | overcast skies doves fly lower, active all day" },
  { title: "dove weather: heat effect", content: "On hot days (90°F+), dove activity concentrates in the first 2 hours of morning and last 2 hours before dark; midday flights drop dramatically.", content_type: "dove-pattern", tags: ["dove", "weather", "heat", "timing"], richText: "dove weather | hot days 90°F+ activity shifts to first/last 2 hours of daylight" },
  { title: "dove weather: tailwind migration", content: "Migrating doves ride tailwinds from approaching fronts; the day before a cold front arrives can produce excellent pass shooting as birds push ahead of the weather.", content_type: "dove-pattern", tags: ["dove", "weather", "tailwind", "migration", "front"], richText: "dove weather | day before cold front doves ride tailwinds, great pass shooting" },

  // Wind thresholds
  { title: "dove wind: shutdown threshold", content: "Dove field activity drops dramatically when sustained winds exceed 15 mph; birds hunker in tree lines and stop making field-to-water flights.", content_type: "dove-pattern", tags: ["dove", "wind", "threshold", "shutdown"], richText: "dove wind pattern | above 15 mph sustained shuts down field activity" },
  { title: "dove wind: ideal range", content: "Light winds of 5-10 mph produce the best dove hunting; enough breeze to give birds a preferred flight line but not enough to suppress activity.", content_type: "dove-pattern", tags: ["dove", "wind", "ideal", "hunting"], richText: "dove wind pattern | 5-10 mph ideal, gives flight line without suppressing activity" },
  { title: "dove wind: crosswind setup", content: "Set up with crosswinds so passing doves are pushed toward your position; doves rarely fly directly into strong headwinds and will alter flight paths.", content_type: "dove-pattern", tags: ["dove", "wind", "crosswind", "setup", "strategy"], richText: "dove wind pattern | crosswind pushes doves toward you, set up accordingly" },
  { title: "dove wind: dead calm", content: "Dead calm mornings produce unpredictable dove flight paths; birds come from every direction without wind to channel their approach, making shooting harder.", content_type: "dove-pattern", tags: ["dove", "wind", "calm", "flight path"], richText: "dove wind pattern | dead calm = unpredictable flight paths from all directions" },

  // First frost triggers
  { title: "dove frost: migration trigger", content: "The first frost in northern states (typically late September) triggers a major dove migration push; fields south of the frost line see a surge 1-2 days later.", content_type: "dove-pattern", tags: ["dove", "frost", "migration", "trigger", "timing"], richText: "dove frost trigger | first northern frost triggers major push, surge 1-2 days south" },
  { title: "dove frost: season end", content: "Multiple hard frosts end local dove populations; resident birds head south quickly and only transient migrants remain, making hunting inconsistent.", content_type: "dove-pattern", tags: ["dove", "frost", "season", "resident", "migration"], richText: "dove frost trigger | multiple hard frosts end local populations, only transients remain" },
  { title: "dove frost: extended summer", content: "Extended warm falls delay dove migration and stretch the hunting season; if frost holds off through October, late-season splits can produce excellent hunting.", content_type: "dove-pattern", tags: ["dove", "frost", "warm", "late season"], richText: "dove frost trigger | extended warm fall delays migration, stretches hunting" },

  // State-specific dove intel
  { title: "dove hunting: texas", content: "Texas is the top dove hunting state in the US, harvesting 5-7 million birds annually; the September 1 opener in the South Zone is a cultural event.", content_type: "dove-pattern", tags: ["dove", "texas", "harvest", "south zone"], richText: "dove hunting texas | top state 5-7 million harvest, September 1 South Zone opener cultural event" },
  { title: "dove hunting: kansas", content: "Kansas sunflower fields are legendary for dove hunting; the September opener catches resident birds before the first frost pushes migrants through.", content_type: "dove-pattern", tags: ["dove", "kansas", "sunflower", "resident"], richText: "dove hunting kansas | legendary sunflower fields, September catches residents" },
  { title: "dove hunting: oklahoma", content: "Oklahoma dove hunting peaks the first 2 weeks of September; wheat stubble and milo fields in the western half produce the best shoots.", content_type: "dove-pattern", tags: ["dove", "oklahoma", "wheat", "milo"], richText: "dove hunting oklahoma | peaks first 2 weeks September, western wheat/milo fields" },
  { title: "dove hunting: arizona", content: "Arizona whitewing dove hunting in September is world-class; the Sonoran Desert corridor produces exceptional morning shoots near grain fields.", content_type: "dove-pattern", tags: ["dove", "arizona", "whitewing", "desert"], richText: "dove hunting arizona | whitewing September world-class, Sonoran Desert corridor" },
  { title: "dove hunting: south carolina", content: "South Carolina's September dove fields are a Deep South tradition; planted sunflower fields on managed properties produce the most consistent hunting.", content_type: "dove-pattern", tags: ["dove", "south carolina", "sunflower", "tradition"], richText: "dove hunting south carolina | September tradition, managed sunflower fields" },
  { title: "dove hunting: georgia", content: "Georgia dove season opens in September with managed fields producing the best shoots; the second split in November catches migrants from the north.", content_type: "dove-pattern", tags: ["dove", "georgia", "managed fields", "split season"], richText: "dove hunting georgia | September managed fields, November split catches migrants" },
  { title: "dove hunting: alabama", content: "Alabama dove hunting peaks in September with managed agricultural fields; the Black Belt region's agricultural landscape is particularly productive.", content_type: "dove-pattern", tags: ["dove", "alabama", "black belt", "agriculture"], richText: "dove hunting alabama | September peak, Black Belt agricultural fields productive" },
  { title: "dove hunting: missouri", content: "Missouri dove hunting is strong in the September opener; public land sunflower plots managed by MDC provide accessible hunting opportunities.", content_type: "dove-pattern", tags: ["dove", "missouri", "public land", "sunflower", "mdc"], richText: "dove hunting missouri | September opener strong, MDC sunflower plots on public land" },
  { title: "dove hunting: mississippi", content: "Mississippi September dove fields are a social event; Delta agricultural fields with harvested grain attract enormous concentrations of birds.", content_type: "dove-pattern", tags: ["dove", "mississippi", "delta", "grain"], richText: "dove hunting mississippi | September Delta fields social event, huge concentrations" },
  { title: "dove hunting: north carolina", content: "North Carolina dove hunting peaks in the September opener; piedmont managed dove fields and coastal plain agriculture are prime areas.", content_type: "dove-pattern", tags: ["dove", "north carolina", "piedmont", "managed fields"], richText: "dove hunting north carolina | September opener, piedmont managed fields" },
  { title: "dove hunting: tennessee", content: "Tennessee dove hunting is productive in September with WMA managed fields providing public hunting; West Tennessee agriculture is prime habitat.", content_type: "dove-pattern", tags: ["dove", "tennessee", "wma", "public land"], richText: "dove hunting tennessee | September WMA managed fields, West Tennessee prime" },
  { title: "dove hunting: nebraska", content: "Nebraska dove season opens September 1; sunflower fields in the central and western regions attract both resident and migrating doves.", content_type: "dove-pattern", tags: ["dove", "nebraska", "sunflower", "migration"], richText: "dove hunting nebraska | September 1 opener, central/western sunflower fields" },
  { title: "dove hunting: california", content: "California dove hunting is strong in the Imperial Valley and Central Valley; the September opener catches resident birds with migrants arriving by October.", content_type: "dove-pattern", tags: ["dove", "california", "imperial valley", "central valley"], richText: "dove hunting california | Imperial/Central Valley September, migrants by October" },
  { title: "dove hunting: colorado", content: "Colorado dove hunting peaks along the Front Range and eastern plains; sunflower and milo fields near reservoirs produce the best shoots.", content_type: "dove-pattern", tags: ["dove", "colorado", "front range", "plains"], richText: "dove hunting colorado | Front Range and eastern plains, sunflower/milo near reservoirs" },

  // Timing / daily pattern
  { title: "dove daily pattern: morning flight", content: "Doves leave roost trees 30-45 minutes after sunrise and fly to feeding fields; the morning flight window from 7-10am is typically the most productive.", content_type: "dove-pattern", tags: ["dove", "timing", "morning", "flight pattern"], richText: "dove daily pattern | morning flight 7-10am most productive, 30-45 min after sunrise" },
  { title: "dove daily pattern: afternoon flight", content: "Doves make afternoon feeding flights from 3-6pm as they tank up before roosting; afternoon shoots can be as good as morning, especially on overcast days.", content_type: "dove-pattern", tags: ["dove", "timing", "afternoon", "flight pattern"], richText: "dove daily pattern | afternoon flight 3-6pm, strong on overcast days" },
  { title: "dove daily pattern: water flight", content: "Doves fly to water mid-morning (9-11am) and late afternoon (4-6pm); setting up near stock ponds or creek crossings can produce fast shooting.", content_type: "dove-pattern", tags: ["dove", "timing", "water", "flight pattern"], richText: "dove daily pattern | water flights 9-11am and 4-6pm, stock ponds produce fast shooting" },

  // Decoys and setup
  { title: "dove setup: decoy placement", content: "Place dove decoys on bare ground or fence lines 15-25 yards from your position; spinning-wing decoys are highly effective at pulling passing birds into range.", content_type: "dove-pattern", tags: ["dove", "decoys", "setup", "strategy"], richText: "dove setup | decoys 15-25 yards on bare ground/fence, spinning wing highly effective" },
  { title: "dove setup: position strategy", content: "Set up in the shade of an isolated tree or fence line within shooting range of a feeding field; doves pattern easily and will flare from exposed hunters.", content_type: "dove-pattern", tags: ["dove", "setup", "concealment", "strategy"], richText: "dove setup | shade of isolated tree near field edge, doves flare from exposed hunters" },
];

// ============================================================
// MAIN
// ============================================================

async function seedSpeciesKnowledge(label: string, entries: PreparedEntry[]): Promise<number> {
  console.log(`\nSeeding ${label} (${entries.length} entries)...`);

  let count = 0;
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    try {
      const n = await processBatch(batch);
      count += n;
      console.log(`  ${count}/${entries.length} ${label} entries embedded`);
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`  Batch ${i}-${i + batch.length} failed: ${err}`);
    }
  }

  console.log(`Seeded ${count} ${label} entries`);
  return count;
}

async function main() {
  console.log("=== Seeding species-specific hunt_knowledge ===");
  console.log(`Mode: Direct Voyage API (batch 20)`);

  const deerCount = await seedSpeciesKnowledge("deer", deerEntries);
  const turkeyCount = await seedSpeciesKnowledge("turkey", turkeyEntries);
  const doveCount = await seedSpeciesKnowledge("dove", doveEntries);

  const total = deerCount + turkeyCount + doveCount;
  console.log(`\nDone! Total: ${deerCount} deer + ${turkeyCount} turkey + ${doveCount} dove = ${total} entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

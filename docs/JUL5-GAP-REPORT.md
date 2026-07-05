# July 5 Significance Gap Report — Duck Countdown

**Scoreboard:** 31 unique verified events checked against the archive (33 found, 2 dupes: Pascagoula 1916 and the 1980 derecho each surfaced twice). **1 in archive** (2011 Phoenix haboob — and only via NCEI storm-event narratives that happen to say "haboob"). **30 missing.** Wikidata-event coverage of July 5 across all of history: **zero rows.** The archive knows the tide at Galveston on every July 5 since 1950 and cannot name a single thing that happened on any of them.

---

## 1. Best missing material, ranked by stand-there voltage

**Tier 1 — nature events the product exists for (the map should already own these):**

1. **1999 Boundary Waters blowdown (derecho, day 2).** The cruelest gap: the archive *contains the storm's own footprint* — Lake/Cook/St. Louis MN wind rows on 07-04, then WI→VT→NH(75mph)→ME rows on 07-05 tracing the dying storm exactly — but no row knows those county reports are one 1,300-mile event that flattened 25 million trees. The strings are on the crime board; nobody drew the line. One curated row converts existing data into a story.
2. **1936 Gann Valley SD 120°F + 1937 Medicine Lake MT 117°F** — two all-time state heat records, back-to-back years, same date, both in prairie-pothole duck country. "The air here once ran 120" is exactly what the map is for. Archive has moon and tides that day; not the fire.
3. **1916 Pascagoula Cat-3 / Mobile's 11.6-ft record surge** — then the earliest major US landfall ever. Gulf marsh + "the water in front of you once stood 11.6 feet higher, on this exact date."
4. **1994 Alberto / Americus GA 21.1"** — the archive's own ghcn-daily row *already prints the 21.1-inch number* with no idea it's the headline of a 33-death flood. Second case of data-without-story.
5. **2019 Ridgecrest M7.1** — missing, and diagnostic: the archive holds the M3.5 foreshocks but not the M6.4 or M7.1. The earthquake feed has an inverted magnitude band. That's a bug, not a gap (fix in §3).
6. **2024 Hurricane Beryl** (earliest Atlantic Cat 5, Tulum landfall) and **1980 "More Trees Down" derecho** (Omaha→Virginia in 15 hours — the duck-on-a-cold-front comparison writes itself).

**Tier 2 — human events with GPS-pin gravity:**

7. **1934 Bloody Thursday + 1935 Wagner Act** — two deaths on a named San Francisco street corner, and the law signed *one year to the day later*. A ready-made "this date rhymes with itself" pair.
8. **1852 Douglass, "What to the Slave is the Fourth of July?"** — deliberately given on the 5th; the archive even has same-week Ohio papers that don't mention him.
9. **1954 Elvis at Sun Studio** — a taped X on a garage-sized floor in Memphis.
10. 1950 Shadrick/Osan, 1775 Olive Branch, 1996 Dolly, 1937 Spam, 1994 Cadabra/Amazon, 1859 Midway, 2018 Klamathon Fire, 2024 Furnace Creek 127°F (another number the CA ghcn row prints anonymously).

**Tier 3 — not events, a missing layer:** rufous hummingbirds southbound July 5, first fall shorebirds at Bombay Hook, Brooks Falls sockeye peak, loon chicks vs. holiday boats, eaglets fledging, aphelion. These recur every year. No event feed will ever supply them — they need a small curated date-keyed phenology layer (or derived eBird arrival percentiles). Different fix, flag for later.

---

## 2. The systemic fix — sources evaluated (all probed live today)

**A. Wikimedia "On This Day" REST API — THE ANSWER. Do this first.**
`api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/MM/DD` — probed live: **July 5 returns 66 events, 231 births, 85 deaths, 12 holidays, and 38/66 events carry page coordinates** straight in the payload (`pages[].coordinates`). Free, no key, User-Agent header only.
- *Coverage:* all 366 days, all of recorded history, curated by Wikipedia editors. ~350 items/day → **~120–140K rows total; events-only ≈ 25–30K.** This single source takes wikidata-event coverage from 244 rows to full-calendar depth.
- *Geo:* ~55–60% of events have coords in-payload; each item links pages → Wikidata QID for P625 backfill later.
- *Effort:* one Deno script, 366 GETs, minutes of fetch. Provenance = Wikipedia article URL per row — honesty law satisfied.
- *Embedding law:* every row → Voyage → hunt_knowledge, batches of ≤20, one pipe, done in a day for events-only.

**B. Chronicling America (LOC).** Old chroniclingamerica JSON endpoint now 403s/redirects; the live API is `loc.gov/collections/chronicling-america/?dates=YYYY-MM-DD/YYYY-MM-DD&fo=json` — probed: **1,635 digitized pages exist for 1916-07-05 alone.** Any town, any date ~1777–1963, geo via place of publication.
- *Verdict:* too big to bulk-ingest, perfect as a **targeted receipt-puller**: for each curated event, fetch 1–3 front pages from the nearest town, same date. The Pascagoula hurricane's own next-morning newsprint, embedded with provenance. Rate-limited hard (loc.gov throttles ~20 req/10s) — bounded pulls only.

**C. NCEI Storm Events pre-1990.** Probed: CSVs exist back to **1950** (`StormEvents_details-ftp_v1.0_d1950…`). Caveat: 1950–54 tornadoes only; 1955–95 tornado/wind/hail only. Gets the 1980 derecho's raw reports 10 years before the current 1990 spine starts; will never contain 1916 hurricanes or 1936 heat. ~40 files, one afternoon, same schema as existing storm-event rows.

**D. Wikidata SPARQL sweeps.** Point-in-time (P585) + coords (P625) queries are timeout-prone and mostly duplicate what OTD gives with links. **Skip as a primary; use only as coordinate-enrichment** on OTD rows lacking coords.

**E. USGS FDSN earthquake backfill.** Not a new source — a bug fix. One bounded query (`minmagnitude=5.5`, 1900–present, US bbox), dedupe on time+magnitude, and Ridgecrest-class holes close permanently. Low thousands of rows.

**F. Astronomical constants.** Aphelion/perihelion/solstices/equinoxes 1950–2030 is a ~320-row deterministic table. Compute once, embed once, never touch again.

---

## 3. The one-day ingest plan (any day, this depth)

**One pipe at a time, per IO budget. Order:**

1. **Hour 1 — OTD events sweep.** Deno script: 366 fetches of `/onthisday/events/MM/DD` → normalize to `content_type=onthisday-event`, `effective_date` = real historical date, columns for MM-DD key, coords when present, provenance = article URL. ~28K rows staged.
2. **Hours 1–8 — embed.** Voyage at ≤20/batch (~1,400 batches), straight into hunt_knowledge. This is the day's pipe. Births/deaths/holidays (~100K) queue as pipe #2 tomorrow if wanted — events alone flip the product.
3. **Parallel, no embed contention — curation lane.** The 30 verified misses in this report become 30 hand-written `curated-event` rows (what/place/lat/lng/why/provenance), embedded inside the same batch stream. **This is the only way Tier-1 items like Gann Valley enter — OTD's list won't carry a South Dakota state heat record.** Any future "find the gaps" day feeds this same lane.
4. **Two small fixes, same day, tiny row counts:** USGS M5.5+ backfill (§2E) and the aphelion table (§2F).
5. **Queued next:** NCEI 1950–89 CSVs (pipe #3), Chronicling America receipt-puller as an on-demand tool per curated event, phenology layer as a designed feature.

**What July 5 answers after step 3:** ~66 dated world events + 30 curated deep-local stories + the existing weather/tide/storm spine — with the blowdown's own wind rows and Americus's own 21.1" finally attached to their names. Denominator stays honest: every row carries its source URL, and the map says "94 dated things happened on this date; here are the 6 within 100 miles of you" instead of silence.

**Cost of the whole thing:** one script, one day of one embedding pipe, ~$ single digits of Voyage. The archive stops being a weather station that slept through history.

---

## APPENDIX — all verified gaps

- **1936** — Gann Valley hit 120°F on July 5, 1936 — still the hottest temperature ever officially recorded in South Dakota, with Kennebec at 119°F and Murdo at 116°F the same afternoon. (Gann Valley, Buffalo County, South Dakota)
- **1937** — Medicine Lake recorded 117°F on July 5, 1937, tying Montana's all-time state record high, matched only by Glendive in 1893. (Medicine Lake, Sheridan County, Montana)
- **1916** — A Category 3 hurricane with 120 mph winds made landfall near Pascagoula on the afternoon of July 5, 1916 — at the time the earliest major hurricane landfall ever recorded in the U.S. — wrecking half the town's buildings and pushing a record 11.6-foot surge into Mobile. (Pascagoula, Mississippi)
- **1980** — The 'More Trees Down' derecho of July 5, 1980 raced from eastern Nebraska to Virginia in about 15 hours, killing six people and injuring roughly 70 with straight-line winds. (Eastern Nebraska (near Omaha) to Virginia — Corn Belt track through Iowa, Illinois, Indiana, Ohio)
- **1994** — Stalled remnants of Tropical Storm Alberto dumped 21.1 inches of rain on Americus in 24 hours across July 5-6, 1994, driving Flint River flooding beyond the 100-year mark and killing 33 people across Georgia. (Americus, Sumter County, Georgia (Flint River basin))
- **1999** — In the pre-dawn hours of July 5, 1999, the Boundary Waters-Canadian derecho was still killing — crossing New Hampshire and Vermont before dying over Maine, 22 hours and 1,300 miles after 90+ mph winds flattened 25 million trees across 370,000 acres of the Boundary Waters on July 4. (Boundary Waters Canoe Area Wilderness, near Ely, Minnesota (storm ended over Maine))
- **2012** — Chicago O'Hare hit 103°F on July 5, 2012 — part of a 100°F-plus streak tying records from 1911 and 1947 — as the heat wave that capped it pushed over 8,000 warm records nationwide, including roughly 350 all-time marks. (Chicago O'Hare International Airport, Illinois)
- **2019** — A magnitude 7.1 earthquake ruptured at 8:19 p.m. local time near Ridgecrest, California — the strongest quake to hit Southern California in 20 years, felt from Sacramento to Phoenix to Baja, followed by more than 14,000 aftershocks. (Ridgecrest / Searles Valley, Kern County, California (near Naval Air Weapons Station China Lake))
- **1916** — A Category 3 hurricane made landfall near Pascagoula, Mississippi with 120 mph winds, driving an 11.6-foot storm surge into Mobile — the highest on record there — sinking boats across the bay and flooding the business district. (Mobile, Alabama / Pascagoula, Mississippi (landfall on the central Gulf Coast))
- **1980** — The 'More Trees Down' derecho, born east of Omaha on the night of July 4, raced across Indiana and Ohio by morning and reached the mid-Atlantic coast by evening on July 5, killing and injuring people with falling trees along a 900-mile path. (Central Indiana (Indianapolis area) through Ohio to the mid-Atlantic coast)
- **2018** — The Klamathon Fire ignited at 12:31 p.m. from illegally burned debris near Hornbrook, California, and went on to burn 38,008 acres, destroy 82 structures, jump the state line into Oregon, and kill one person. (Hornbrook, Siskiyou County, California (Klamath River canyon, near the Oregon border))
- **2024** — Hurricane Beryl — the earliest Category 5 ever recorded in the Atlantic — made landfall just northeast of Tulum, Mexico as a Category 2 with 110 mph winds, after killing at least 11 people across Grenada, St. Vincent, Venezuela, and Jamaica. (Tulum, Quintana Roo, Mexico (Yucatan Peninsula Caribbean coast))
- **1775** — The Continental Congress adopted the Olive Branch Petition, its last direct appeal to King George III to avoid all-out war — one day after the same men had effectively made war inevitable. (Pennsylvania State House (Independence Hall), Philadelphia, Pennsylvania)
- **1852** — Frederick Douglass delivered "What to the Slave is the Fourth of July?" to about 600 people at Corinthian Hall, invited by the Rochester Ladies' Anti-Slavery Society. (Corinthian Hall site, Corinthian Street off State Street, Rochester, New York)
- **1859** — Captain N.C. Brooks of the sealing ship Gambia sighted Midway Atoll and claimed it for the United States under the Guano Islands Act. (Midway Atoll, North Pacific Ocean)
- **1934** — Police fired into striking longshoremen on "Bloody Thursday," killing Howard Sperry and Nicholas Bordoise at the corner of Steuart and Mission Streets during the West Coast waterfront strike. (Steuart and Mission Streets, San Francisco, California)
- **1935** — President Franklin Roosevelt signed the National Labor Relations Act (Wagner Act), guaranteeing private-sector workers the right to organize and strike. (The White House, Washington, D.C.)
- **1937** — Hormel Foods introduced Spam, the canned pork product that would feed GIs across two oceans in World War II. (Hormel Foods, Austin, Minnesota)
- **1950** — Private Kenneth Shadrick, a 19-year-old coal miner's son from Skin Fork, West Virginia, was reported as the first American killed in the Korean War, cut down by a T-34 tank's machine gun hours after Task Force Smith fought the war's first US battle at Osan. (Skin Fork, Wyoming County, West Virginia (Shadrick's hometown))
- **1954** — A 19-year-old truck driver named Elvis Presley recorded "That's All Right" in an unrehearsed late-night session at Sam Phillips's Sun Studio. (Sun Studio, 706 Union Avenue, Memphis, Tennessee)
- **1994** — Jeff Bezos incorporated Cadabra Inc. — renamed Amazon within months — and began building an online bookstore out of the garage of a rented house in Bellevue. (10704 NE 28th Street, Bellevue, Washington)
- **2025** — Benjamin Ferguson slow-trolled a Lake Clear Wabbler and boated a 22-inch, 6-pound-3-ounce brook trout, a new New York state record that broke a 12-year-old mark by three ounces. (A pond in the St. Regis Canoe Area, Adirondack Park, New York)
- **2014** — A Mississippi River mayfly emergence near La Crosse was so dense it lit up National Weather Service radar like light rain, part of the annual late-June-to-early-July hatch. (Upper Mississippi River at La Crosse, Wisconsin)
- **2025** — Adult male Rufous Hummingbirds, the earliest fall migrant of any North American hummingbird, begin arriving in Arizona canyons on their southbound push after leaving Pacific Northwest and Alaskan breeding grounds by late June. (Madera Canyon, Santa Rita Mountains, southeastern Arizona)
- **2025** — Sockeye salmon returning up the Brooks River peak in the first two weeks of July, drawing the highest concentration of brown bears of the year to the lip of Brooks Falls. (Brooks Falls, Katmai National Park and Preserve, Alaska)
- **2025** — The first southbound shorebirds of fall migration, adults like Lesser Yellowlegs, Short-billed Dowitchers, and Least Sandpipers, return to Atlantic coast mudflats in early July after finishing or abandoning Arctic nests. (Bombay Hook National Wildlife Refuge, Delaware Bay)
- **2024** — Common Loon eggs that hatched in late June leave young chicks riding on their parents' backs through early July, unable to dive deep, right as holiday boat traffic peaks on northern lakes. (North-central lakes country, Minnesota)
- **2022** — Bald eaglets hatched in early spring reach full adult size and fledge, taking their first flights from the nest edge, in late June and early July. (Upper Mississippi River National Wildlife and Fish Refuge)
- **2026** — Earth reaches aphelion — its farthest point from the sun for the entire year, about 94.5 million miles out. (Everywhere on Earth (event peaks 17:30 UTC, July 6))
- **1687** — Isaac Newton's Principia was published, laying out universal gravitation and the three laws of motion. (Royal Society, London, England)
- **1904** — Ernst Mayr, the ornithologist who reshaped how we define a species, was born. (Kempten, Bavaria, Germany)
- **1958** — An American team made the first ascent of Gasherbrum I (Hidden Peak), the 11th-highest mountain on Earth at 26,509 feet. (Gasherbrum I, Karakoram, Pakistan-China border)
- **1996** — Dolly the sheep, the first mammal cloned from an adult cell, was born. (Roslin Institute, near Edinburgh, Scotland)
- **2024** — Furnace Creek hit 127 degrees F, a new daily record for July 5 in the hottest place on Earth. (Furnace Creek, Death Valley National Park, California)

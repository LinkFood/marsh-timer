# Duck Countdown Thesis Test Plan

**Date:** March 21, 2026
**Purpose:** Validate whether the brain's cross-domain environmental data can retroactively identify precursor patterns for known historical events.
**Prerequisite:** `search_hunt_knowledge_v3` RPC must be live (see EMERGENCY-FIX-SEARCH-RPC.md)

---

## How to Run These Tests

Once the search RPC is restored, each test has:
1. **Query** — what to ask the brain (via chat or hunt-search API)
2. **Expected Brain Data** — which content_types should surface if the data exists
3. **Ground Truth** — verified facts from NOAA/NWS/USGS/NASA to compare against
4. **Pass Criteria** — what "the brain got it right" looks like

For each test, run the query, check what the brain returns under "FROM THE BRAIN," then compare against the ground truth. Score as: **HIT** (brain found the signal), **PARTIAL** (related data but missed the connection), or **MISS** (nothing relevant returned).

---

## TIER 1: Strong Signal Events (Brain should have direct data)

These are large-scale events where the brain's existing content types (storm-event, weather-realtime, nws-alert, usgs-water, earthquake-event) should contain direct records.

---

### TEST 1: Texas Deep Freeze — February 2021

**Query:** "What environmental conditions were present in Texas in February 2021?"

**Ground Truth (NOAA/NWS verified):**
- Dates: Feb 10-20, 2021 (worst: Feb 14-17)
- Negative Arctic Oscillation index pushed polar vortex south
- 1066mb high pressure system from Siberia reached Texas
- Temps dropped to -20°F in parts of Texas — every square mile below freezing for 8+ days
- 4.5 million power outages, burst pipes, 246 deaths
- USGS river gauges showed water infrastructure collapse
- NWS issued Winter Storm Warnings days in advance

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| storm-event | NOAA storm event records for TX Feb 2021 |
| weather-realtime | ASOS station readings showing temp crash |
| nws-alert | Winter Storm Warnings for TX |
| usgs-water | River gauge anomalies (frozen pipes, flow disruption) |
| climate-index | Arctic Oscillation going negative in Jan-Feb 2021 |
| weather-forecast | Forecast data showing the incoming cold front |

**Pass Criteria:** Brain returns storm-event or weather data showing extreme cold in TX during Feb 2021. Bonus: climate-index data showing negative AO as a precursor signal.

---

### TEST 2: Kentucky Tornado Outbreak — December 10-11, 2021

**Query:** "What happened in Kentucky in December 2021? Any severe weather signals?"

**Ground Truth (NWS/SPC verified):**
- Dec 10-11, 2021 — EF4 tornado, Mayfield KY
- 165.7 mile damage path (one of longest in US history)
- SPC issued Moderate Risk hours before the event
- 107 mph winds recorded at mesonet station before tornado touched down
- Warm sector with 70°F dewpoints in December (extremely anomalous)
- Part of a multi-state outbreak: AR, MO, TN, KY, IL

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| storm-event | NOAA tornado records for KY Dec 2021 |
| nws-alert | Tornado Warnings, Severe Thunderstorm Warnings |
| weather-realtime | Anomalous December warmth (70°F dewpoints) |
| weather-event | Detected severe weather events |

**Pass Criteria:** Brain returns storm-event records showing tornado activity in KY Dec 2021. Cross-domain bonus: anomalous warmth data in December showing the setup.

---

### TEST 3: Hurricane Ian — September 2022

**Query:** "What environmental data exists for Florida in late September 2022?"

**Ground Truth (NHC/NWS verified):**
- Cat 4 hurricane, 150 mph winds
- Sept 28, 2022 landfall at Cayo Costa, FL
- NWS issued Hurricane Warnings 48+ hours out
- Storm surge 12-18 feet in Fort Myers area
- Birds sensed barometric pressure drop before instruments flagged it
- Marine species (sharks, manatees) fled before evacuation orders

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| storm-event | Hurricane Ian records |
| nws-alert | Hurricane Warnings for FL |
| noaa-tide | Storm surge anomalies in tide gauges |
| weather-realtime | Barometric pressure drop at FL ASOS stations |
| birdcast-historical | Migration radar anomalies (birds fleeing) |
| usgs-water | River flooding post-landfall |

**Pass Criteria:** Brain returns storm-event or nws-alert data for FL Sept 2022. Cross-domain bonus: tide gauge anomalies + birdcast showing unusual movement.

---

### TEST 4: Iowa Derecho — August 10, 2020

**Query:** "Were there extreme weather events in Iowa in August 2020?"

**Ground Truth (NWS verified):**
- Aug 10, 2020 — derecho traveled 770 miles from SD to OH in 14 hours
- Wind gusts up to 140 mph in Cedar Rapids, IA
- Damage swath: 90,000+ square miles
- $11.5 billion damage — costliest thunderstorm in modern US history
- 1 million+ homes and businesses lost power across IA, IL, IN
- Crops flattened across entire counties
- Precursors: very warm/moist surface air, cold air aloft, strong upper-level winds
- Thunderstorms formed in eastern SD/NE the night before, intensified across IA

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| storm-event | NOAA derecho/thunderstorm wind records for IA Aug 2020 |
| weather-realtime | ASOS data showing pressure drop and extreme wind |
| nws-alert | Severe Thunderstorm Warnings |
| crop-data | Crop damage/loss reports for IA 2020 |

**Pass Criteria:** Brain returns storm-event records for IA Aug 2020 with extreme wind data. Cross-domain bonus: crop-data showing yield impact.

---

## TIER 2: Cross-Domain Convergence Events

These require the brain to connect data across multiple content types — the real test of the thesis.

---

### TEST 5: California Lightning Siege & Wildfires — August 2020

**Query:** "What environmental conditions converged in California in August 2020?"

**Ground Truth (CAL FIRE / NASA verified):**
- Aug 16-17, 2020: 14,000+ lightning strikes in 72 hours
- Sparked 900+ fires burning 1.5 million acres
- August Complex Fire: largest in CA recorded history (1M+ acres)
- SCU Lightning Complex: 391,578 acres (2nd largest at the time)
- Precursors: record heat (120°F land surface temps), extreme drought, dried vegetation
- September: Diablo and Santa Ana winds caused explosive growth
- Orange/red skies across San Francisco Bay Area

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| fire-activity | Fire detection data for CA Aug 2020 |
| storm-event | Lightning records, extreme heat records |
| drought-weekly | Drought monitor showing D2-D4 in CA |
| weather-realtime | Record temperatures at CA stations |
| nasa-power | Satellite-detected heat anomalies |

**Pass Criteria:** Brain connects fire + drought + heat in CA Aug 2020. The convergence is the point — no single data source tells the story.

---

### TEST 6: Maui / Lahaina Wildfire — August 8, 2023

**Query:** "What environmental conditions existed in Hawaii in early August 2023?"

**Ground Truth (NASA/NWS verified):**
- Aug 8, 2023 — Lahaina fire destroyed town, 100+ deaths (deadliest US wildfire in a century)
- Drought: moderate (D1) to severe (D2) across Maui
- Wind: 45-67 mph gusts from anomalous 1034 hPa high pressure NW of islands
- Katabatic winds funneled down Pu'u Kukui Mountain, dried and accelerated further
- Hurricane Dora (Cat 4) passed 500 miles south on Aug 8 — tightened pressure gradient
- Downed power lines ignited dried vegetation
- Cross-domain convergence: drought + anomalous high pressure + distant hurricane + terrain funneling

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| fire-activity | Fire detection for HI Aug 2023 |
| drought-weekly | Drought data showing D1-D2 in HI |
| nws-alert | Red Flag Warnings, High Wind Warnings for HI |
| weather-realtime | Wind speed anomalies, pressure readings |

**Pass Criteria:** Brain connects fire + drought + wind in HI Aug 2023. The hurricane-pressure-gradient connection would be exceptional.

---

### TEST 7: Mississippi River Drought Crisis — October 2022

**Query:** "What was happening with the Mississippi River in fall 2022?"

**Ground Truth (NOAA/USGS verified):**
- Mississippi dropped to lowest levels in a decade near Memphis and Vicksburg
- 40% of the country in drought for 101+ consecutive weeks
- US Coast Guard: 8 barges ran aground, 144 vessels and 2,253 barges backed up
- Corn/soybean transport disrupted at peak harvest season
- Precursors: months of below-normal rainfall + above-average temps across Midwest
- USGS gauges at St. Louis, Memphis, Baton Rouge all at record or near-record lows

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| usgs-water | Low water readings at MS River gauges |
| drought-weekly | Persistent drought across MS River basin |
| crop-data | Crop transport/harvest disruption |
| weather-realtime | Above-average temps, below-normal precip |
| climate-index | Drought indices (PDSI, SPI) |

**Pass Criteria:** Brain connects low water levels + drought + crop disruption. This is a slow-burn convergence — the brain needs to see months of building signals.

---

### TEST 8: Canadian Wildfire Smoke Invasion — June 2023

**Query:** "Were there air quality or atmospheric anomalies across the eastern US in June 2023?"

**Ground Truth (NOAA/NASA/AirNow verified):**
- Mid-May through June 2023: Canadian wildfires sent smoke thousands of miles south
- First week of June: Great Lakes region fires covered eastern US
- AQI exceeded 300+ in NYC, Pittsburgh, DC (hazardous levels)
- Smoke affected Chicago to Maryland corridor
- Particulate matter readings off the charts at ground-level monitors

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| weather-realtime | Unusual visibility/particulate readings at ASOS stations |
| nws-alert | Air Quality Alerts across eastern states |
| fire-activity | Canadian fire data (if captured) |
| birdcast-historical | Migration radar disruption from smoke (birds avoid) |
| nasa-power | Satellite-detected aerosol/smoke plumes |

**Pass Criteria:** Brain finds NWS air quality alerts + weather station anomalies for eastern US June 2023. Cross-domain bonus: any bird behavior changes correlated with smoke.

---

### TEST 9: Pacific Northwest Heat Dome — June 25-29, 2021

**Query:** "What extreme temperatures were recorded in the Pacific Northwest in late June 2021?"

**Ground Truth (NOAA/NWS verified):**
- June 25-29, 2021 — 1-in-1,000 year event
- Portland OR hit 116°F on June 28 (previous record: 107°F, smashed by 9°F)
- Seattle hit 108°F (previous record: 103°F)
- Lytton, BC: 121°F — then destroyed by wildfire the next day
- Atmospheric cause: polar vortex split → Omega Block (low/high/low) centered over PNW
- Subsidence/adiabatic heating + sustained solar radiation
- 800+ excess deaths in OR, WA, BC combined

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| storm-event | Extreme heat records for OR, WA June 2021 |
| weather-realtime | ASOS stations showing 110°F+ in Portland, Seattle |
| nws-alert | Excessive Heat Warnings |
| climate-index | Any signals of the Omega Block setup |
| fire-activity | Wildfires triggered by the heat (Lytton, etc.) |

**Pass Criteria:** Brain returns extreme heat records for PNW June 2021. Cross-domain bonus: fire data showing heat → wildfire cascade.

---

## TIER 3: Subtle Pattern Recognition (The Real Thesis Test)

These test whether the brain can detect patterns that only emerge from cross-domain data — signals that no single data source would reveal.

---

### TEST 10: Bird Migration Timing Shifts as Climate Indicator

**Query:** "Are there any patterns in spring bird migration timing across the eastern US?"

**Ground Truth (eBird/BirdCast/Audubon verified):**
- Birds arriving ~7 days earlier on average than historical norms
- ~1 day earlier per 1°C temperature increase
- eBird data (48M+ observations since 2002) shows spring green-up moving earlier, but long-distance migrants not keeping pace
- Phenological mismatch: birds arriving after peak food availability
- Some wading birds actually migrating LATER (delayed long-distance migration)
- Recent study: godwit population arriving nearly a week later than a decade ago

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| birdcast-historical | Historical radar migration data (2021-2025) |
| birdcast-daily | Recent migration intensity readings |
| migration-spike-* | Detected migration timing anomalies |
| bio-environmental-correlation | Correlations between temp and bird arrival |
| photoperiod | Photoperiod data (the clock birds should follow) |
| weather-realtime | Temperature trends showing warming |

**Pass Criteria:** Brain connects birdcast migration timing data with temperature/photoperiod data and surfaces any correlation entries. This is exactly the kind of cross-domain synthesis the brain is built for.

---

### TEST 11: Drought → Crop Failure → Bird Population Decline Chain

**Query:** "How did the 2022 drought affect different environmental systems in the Great Plains?"

**Ground Truth (USDA/USFWS/Drought.gov verified):**
- 40% of US in drought for 101+ weeks through 2022
- Texas cotton crop: 69% abandonment rate
- Corn/soybean yields significantly reduced in IA, MO
- Grassland bird populations declining — drought is a primary driver
- Direct mechanisms: dehydration, hyperthermia in birds
- Indirect: vegetation loss → insect decline → food scarcity for birds
- Central/Southern Great Plains hardest hit: NE through TX

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| drought-weekly | Persistent D2-D4 drought across Great Plains |
| crop-data | Crop abandonment/yield loss data |
| birdweather-daily | Bird detection anomalies in drought areas |
| usgs-water | Low stream flows across plains states |
| bio-environmental-correlation | Drought ↔ bird population correlations |
| bio-absence-signal | Bird absence detections in drought zones |

**Pass Criteria:** Brain connects drought + crop + bird data across the Great Plains. The cascade effect (drought → crop → bird) is THE thesis in action. Even a partial connection scores.

---

### TEST 12: Earthquake Activity and Biological Response

**Query:** "Were there any earthquake events in the central US and unusual animal behavior nearby?"

**Ground Truth (USGS/Scientific literature):**
- USGS: Anecdotal evidence of animal behavior changes before earthquakes, but no scientifically consistent mechanism proven
- Birds may detect low-frequency sounds (<40 Hz) and magnetic field changes before quakes
- Peru study: significant decrease in animal activity 3 weeks before M7.0 earthquake
- ICARUS project (Max Planck): tracked animal movement patterns near seismic zones
- New Madrid Seismic Zone: most active intraplate zone in US (AR, MO, TN, KY)

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| earthquake-event | 70K+ earthquake records |
| birdweather-daily | Bird detection data near seismic zones |
| birdcast-historical | Migration radar near New Madrid zone |
| geomagnetic-kp | Geomagnetic field disturbance data |
| bio-environmental-correlation | Any earthquake ↔ biological correlations |

**Pass Criteria:** This is the hardest test. If the brain finds ANY temporal correlation between earthquake events and bird behavior anomalies in the same region, that's a major thesis validation. Even finding the data exists in proximity is a win.

---

### TEST 13: Multi-System Convergence — Spring 2023 Eastern US

**Query:** "What environmental patterns converged across the eastern US in spring 2023?"

**Ground Truth (multiple agencies):**
- Late frost events damaged crops after early warm spell
- Tornado season shifted earlier (La Niña aftermath)
- Canadian wildfire smoke began affecting air quality by late May
- Spring migration was disrupted by unusual weather patterns
- Mississippi River recovering from 2022 drought but still below normal
- Multiple NWS severe weather events across tornado alley

**Expected Brain Data:**
| Content Type | What Should Surface |
|---|---|
| weather-realtime | Temperature whiplash (warm → frost) |
| storm-event | Severe weather records |
| nws-alert | Frost advisories + severe weather warnings |
| birdcast-historical | Migration pattern data |
| usgs-water | River recovery readings |
| crop-data | Frost damage to crops |
| convergence-score | Daily convergence scores for eastern states |

**Pass Criteria:** Brain surfaces multiple simultaneous environmental stresses. The test isn't whether it predicts anything — it's whether it recognizes that multiple systems were stressed at once. That recognition IS the product.

---

## Scoring Summary

| Test | Event | Tier | What It Proves |
|---|---|---|---|
| 1 | Texas Freeze 2021 | 1 | Brain has the basic data |
| 2 | Kentucky Tornado 2021 | 1 | Brain has the basic data |
| 3 | Hurricane Ian 2022 | 1 | Brain has the basic data |
| 4 | Iowa Derecho 2020 | 1 | Brain has the basic data |
| 5 | CA Wildfires 2020 | 2 | Cross-domain convergence works |
| 6 | Maui Fire 2023 | 2 | Cross-domain convergence works |
| 7 | MS River Drought 2022 | 2 | Slow-burn convergence detection |
| 8 | Canadian Smoke 2023 | 2 | Atmospheric cross-domain detection |
| 9 | PNW Heat Dome 2021 | 2 | Extreme event detection |
| 10 | Migration Timing Shifts | 3 | Subtle biological pattern recognition |
| 11 | Drought-Crop-Bird Chain | 3 | Multi-system cascade detection |
| 12 | Earthquake + Biology | 3 | The hardest — frontier pattern matching |
| 13 | Spring 2023 Convergence | 3 | Multi-system stress recognition |

**Scoring:**
- **Tier 1 (Tests 1-4):** 4/4 = brain data is solid. 3/4 = some gaps. <3 = backfill needed.
- **Tier 2 (Tests 5-9):** 4/5 = cross-domain convergence is working. 3/5 = promising. <3 = brain needs synthesis layer.
- **Tier 3 (Tests 10-13):** ANY hit = thesis has legs. 2+ = thesis is validated. 0 = brain needs more data or synthesis layer isn't working yet.

**Overall:** 8/13+ = "Show don't predict" is real. 5-7/13 = promising, needs more data/synthesis. <5 = architecture issue, not data issue.

---

## After Running: What To Do With Results

1. **All Tier 1 passes:** The brain has good data. Move to optimizing search and synthesis.
2. **Tier 1 fails:** Identify which content types are missing. Run targeted backfills.
3. **Tier 2 passes:** The convergence model works. The brain CAN connect dots across domains.
4. **Tier 2 fails:** The data exists in silos but search isn't connecting them. Tune match_threshold, boost signal_weight on cross-domain entries, or add AI synthesis layer.
5. **Tier 3 passes:** This is the money. The brain found patterns that humans couldn't see by looking at single data sources. Write it up.
6. **Tier 3 fails:** Expected at this stage. These are the hardest patterns. The synthesis layer (hunt-brain-synthesizer) is what will eventually crack these.

---

## Web Sources Used for Ground Truth

- [NWS Des Moines - 2020 Derecho](https://www.weather.gov/dmx/2020derecho)
- [NWS Davenport - Midwest Derecho Aug 2020](https://www.weather.gov/dvn/summary_081020)
- [NESDIS - GOES East Watches Derecho](https://www.nesdis.noaa.gov/news/day-2020-goes-east-watches-derecho-slam-the-midwest)
- [CAL FIRE - August Complex Fire](https://www.fire.ca.gov/incidents/2020/8/16/august-complex-includes-doe-fire)
- [NASA Earth Observatory - California Fires 2020](https://earthobservatory.nasa.gov/images/147182/august-fires-leave-vast-burn-scars-in-california)
- [NESDIS - Canadian Wildfire Smoke](https://www.nesdis.noaa.gov/news/noaa-satellites-monitor-canadian-wildfires-and-smoke)
- [NASA - Canadian Wildfire Smoke 2023](https://science.nasa.gov/earth/earth-observatory/widespread-smoke-from-canadian-fires-154641/)
- [NOAA Repository - PNW Heatwave 2021 Causes](https://repository.library.noaa.gov/view/noaa/40148)
- [NCEI - June 2021 Climate Assessment](https://www.ncei.noaa.gov/news/national-climate-202106)
- [NOAA - October 2022 Drought](https://www.noaa.gov/news/warm-dry-october-intensifies-us-drought)
- [Drought.gov - Midwest Drought Sept 2022](https://www.drought.gov/drought-status-updates/drought-status-update-midwest-us-9-2-22)
- [NASA - Devastation in Maui](https://earthobservatory.nasa.gov/images/151688/devastation-in-maui)
- [NASA GMAO - Maui Wildfire Meteorologic Analysis](https://gmao.gsfc.nasa.gov/science-snapshots/meteorologic-analysis-of-the-august-2023-maui-wildfires/)
- [USGS - Animals & Earthquake Prediction](https://www.usgs.gov/programs/earthquake-hazards/animals-earthquake-prediction)
- [Audubon - Spring Migration Shifts](https://www.audubon.org/magazine/spring-shifts-earlier-many-migrating-birds-are-struggling-keep)
- [USFWS - Modeling Bird Responses to Drought](https://www.fws.gov/project/modeling-bird-responses-drought)

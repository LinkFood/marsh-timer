---
name: Energy & Infrastructure Data Pipes — Full Design Spec
description: 10 high-value energy/transportation/infrastructure data pipes with exact API specs, field maps, narrative examples, scale estimates, and gotchas. EIA (5 pipes), NTSB, BTS, NRC, NOAA weather fatalities, USGS minerals. Designed for time machine product — every pipe optimized for date-based retrieval and cross-domain narrative fusion. Generated 2026-04-03.
type: project
---

# Energy & Infrastructure Data Pipes — Full Design Spec

## The Vision

Energy is the CIRCULATORY SYSTEM of civilization. When you pick a date in the time machine, energy data tells you what was happening to the *body* — not just the weather or the wildlife, but the industrial heartbeat. Oil prices spike? That's inflation hitting farmers, truckers rerouting, airlines cutting routes, refineries straining. A nuclear plant trips offline? That's grid stress cascading through 5 states. A plane goes down? That's weather, mechanical failure, bird strikes — all converging at a single point in spacetime.

These 10 pipes turn the time machine from "what was happening in nature" to "what was happening to EVERYTHING."

---

## PIPE 1: EIA Daily Energy Prices (The Heartbeat)

### The API
```
Endpoint: https://api.eia.gov/v2/petroleum/pri/spt/data/
Auth: Free API key (register at eia.gov/opendata/register.php)
Rate limit: No documented hard limit. ~100 req/min safe.
Method: GET with query params
```

### Key Series
| Series ID | Description | Start Date | Frequency |
|-----------|-------------|------------|-----------|
| PET.RWTC.D | WTI Crude Oil Spot ($/bbl) | 1986-01-02 | Daily |
| PET.EMM_EPMR_PTE_NUS_DPG.D | US Regular Gas Retail ($/gal) | 1993-04-05 | Daily (Mon) |
| PET.EMD_EPD2DXL0_PTE_NUS_DPG.D | Ultra-Low Sulfur Diesel ($/gal) | 2006-06-12 | Daily (Mon) |
| NG.RNGWHHD.D | Henry Hub Natural Gas Spot ($/MMBtu) | 1997-01-07 | Daily |
| ELEC.PRICE.US-ALL.M | Avg Retail Electricity Price (cents/kWh) | 2001-01 | Monthly |

### Query Pattern
```
GET https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key={KEY}
  &frequency=daily
  &data[0]=value
  &facets[series][]={SERIES_ID}
  &start={YYYY-MM-DD}
  &end={YYYY-MM-DD}
  &sort[0][column]=period
  &sort[0][direction]=asc
  &length=5000
```

### The Data (per entry in hunt_knowledge)
```
content_type: "eia_energy_price"
state: "US" (national) or state code for regional
title: "WTI Crude Oil: $147.27/bbl (2008-07-11) — All-time high"
content: "WTI crude oil spot price reached $147.27 per barrel on July 11, 2008, 
  the highest price in history. This represented a 94% increase from $75.96 one year 
  prior. At this price level, US gasoline averaged $4.11/gallon. Energy costs at this 
  level cascade through every economic sector — transportation costs spike, agricultural 
  input costs surge, consumer spending contracts."
metadata: {
  series: "PET.RWTC.D",
  commodity: "crude_oil",
  product: "wti_spot",
  value: 147.27,
  unit: "$/bbl",
  period: "2008-07-11",
  frequency: "daily",
  pct_change_7d: 5.2,
  pct_change_30d: 12.8,
  pct_change_365d: 94.0,
  percentile_all_time: 99.8
}
```

### Narrative Examples

**1973 Oil Embargo (Oct 1973 - Mar 1974):**
"On October 17, 1973, OPEC announced an oil embargo against the United States. Within 4 months, crude oil prices quadrupled from $3.00 to $12.00 per barrel. Gasoline rationing began. Interstate speed limits dropped to 55 mph. This is the moment energy became a weapon — and every data domain in the brain shows the shockwave. Agricultural diesel costs doubled. Airline traffic fell 20%. Heating oil shortages hit the Northeast hard."

**2020 Negative Oil Prices (April 20, 2020):**
"For the first time in history, WTI crude oil futures went negative: -$37.63/barrel. Traders were paying people to take oil off their hands. Storage at Cushing, Oklahoma was at 83% capacity. The COVID lockdown had crushed demand by 30 million barrels/day. Cross-reference this date with aviation data (flights down 96%), air quality (PM2.5 plummeting to historic lows), and wildlife observations (animals entering cities)."

**Hurricane Katrina (Aug 29, 2005):**
"Natural gas prices spiked 43% in 2 weeks after Katrina knocked out 95% of Gulf of Mexico production. Gasoline hit $3.07/gal nationally — a record at the time. 8 refineries went offline. This cascade shows up across every domain: power outages in 5 states, aviation disrupted, wildlife displacement across the Gulf Coast."

### Scale
- Daily crude + gas + diesel + nat gas: ~39 years x 252 trading days x 4 series = ~39,000 entries
- Monthly electricity prices by state: 25 years x 12 months x 50 states = ~15,000 entries
- **Total: ~55,000 entries**

### Gotchas
- EIA API v2 returns max 5,000 rows per request. Paginate with `offset` param.
- Daily series skip weekends/holidays. Don't assume continuous dates.
- Some series have different start dates. Check `startPeriod` in metadata.
- API key goes in query string, NOT header.
- Rate limit is undocumented — throttle to 2 req/sec to be safe.
- Retail gas prices are WEEKLY on Mondays, not truly daily. The "daily" label is misleading.

---

## PIPE 2: EIA Electricity Generation by Source/State (The Grid Anatomy)

### The API
```
Endpoint: https://api.eia.gov/v2/electricity/electric-power-operational-data/data/
Auth: Same EIA key
```

### Key Series
| Facet | Description | Start | Freq |
|-------|-------------|-------|------|
| fueltypeid=ALL, sectorid=99 | Total generation by state | 2001-01 | Monthly |
| fueltypeid=NUC | Nuclear generation by state | 2001-01 | Monthly |
| fueltypeid=SUN | Solar generation by state | 2014-01 | Monthly |
| fueltypeid=WND | Wind generation by state | 2001-01 | Monthly |
| fueltypeid=COL | Coal generation by state | 2001-01 | Monthly |
| fueltypeid=NG | Natural gas generation by state | 2001-01 | Monthly |

### Query Pattern
```
GET https://api.eia.gov/v2/electricity/electric-power-operational-data/data/?api_key={KEY}
  &frequency=monthly
  &data[0]=generation
  &facets[fueltypeid][]={TYPE}
  &facets[stateid][]={STATE}
  &start=2001-01
  &end=2026-03
  &sort[0][column]=period
  &sort[0][direction]=asc
  &length=5000
```

### The Data
```
content_type: "eia_electricity_generation"
state: "TX" (per-state)
title: "Texas electricity: 46,832 GWh total — Wind 22%, Gas 52%, Coal 14% (2024-03)"
content: "In March 2024, Texas generated 46,832 GWh of electricity. Natural gas 
  dominated at 52% (24,353 GWh), followed by wind at 22% (10,303 GWh), coal at 14% 
  (6,557 GWh), nuclear at 8% (3,747 GWh), and solar at 4%. Texas has transformed 
  from 95% fossil in 2001 to 26% renewable — the fastest grid transition of any major 
  state. Wind generation in March was 34% above the 5-year average."
metadata: {
  state: "TX",
  period: "2024-03",
  total_gwh: 46832,
  breakdown: {
    natural_gas: { gwh: 24353, pct: 52.0 },
    wind: { gwh: 10303, pct: 22.0 },
    coal: { gwh: 6557, pct: 14.0 },
    nuclear: { gwh: 3747, pct: 8.0 },
    solar: { gwh: 1872, pct: 4.0 }
  },
  yoy_change_pct: 3.2,
  wind_vs_5yr_avg_pct: 34.0
}
```

### Narrative Examples

**Texas Winter Storm Uri (Feb 2021):**
"In February 2021, Texas generation collapsed from ~40,000 GWh to ~28,000 GWh as the grid crisis unfolded. Natural gas plants froze. Wind turbines iced up. Nuclear plants tripped. Coal piles froze solid. 4.5 million customers lost power. Cross-reference with: NOAA weather data showing temperatures 40F below normal, power outage data showing the largest blackout in US history, and natural gas prices spiking from $3 to $400/MMBtu at the Houston Ship Channel hub."

**Coal-to-Gas Switchover:**
"Pick any month in West Virginia in 2005 vs 2024. In 2005: coal generated 98% of the state's electricity. By 2024: coal dropped to 72%, gas rose to 20%. This structural shift shows up in the brain as a slow-motion regime change — coal employment data, rail traffic, air quality improvements, land use changes around former mines."

### Scale
- 50 states x 25 years x 12 months x 6 fuel types = ~900,000 entries
- But de-duplicating to one composite entry per state-month: 50 x 300 = ~15,000 composite entries
- **Recommended approach: one rich composite entry per state-month = ~15,000 entries**
- Optional: individual fuel-type entries for deeper drill-down = ~90,000 entries

### Gotchas
- Some states report zero for solar/wind in early years. Embed zeros as "no solar generation existed" — that IS the story.
- Alaska and Hawaii have very different grid structures. Still valuable but context matters.
- "All sectors" (sectorid=99) includes industrial self-generation. For grid-only, use sectorid=1 (electric utility) + sectorid=2 (independent power producers).
- Data lags ~3 months. Current month won't be available.

---

## PIPE 3: EIA Oil & Gas Production by State (The Supply Side)

### The API
```
Endpoint: https://api.eia.gov/v2/petroleum/crd/crpdn/data/ (crude production)
         https://api.eia.gov/v2/natural-gas/prod/sum/data/ (gas production)
Auth: Same EIA key
```

### Key Series
| Series | Description | Start | Freq |
|--------|-------------|-------|------|
| Crude oil production by state | Thousand barrels/month | 1981-01 | Monthly |
| Natural gas gross withdrawals by state | MMcf/month | 1991-01 | Monthly |
| Petroleum product supplied (demand) | Thousand barrels/day | 1981-01 | Monthly |

### The Data
```
content_type: "eia_oil_gas_production"
state: "ND" (per-state)
title: "North Dakota crude: 1,174 Kbbl/month — Bakken boom at 89% of peak (2024-06)"
content: "North Dakota produced 1,174 thousand barrels of crude oil in June 2024, 
  89% of its all-time peak of 1,320 Kbbl in November 2019. The state went from producing 
  98 Kbbl/month in 2005 to over 1,000 by 2014 — the Bakken shale revolution reshaped 
  the state's economy, landscape, and wildlife corridors. At this production level, 
  approximately 17,000 active wells are pumping across western ND."
metadata: {
  state: "ND",
  period: "2024-06",
  crude_kbbl: 1174,
  pct_of_peak: 89.0,
  peak_value: 1320,
  peak_date: "2019-11",
  yoy_change_pct: -3.2
}
```

### Narrative: Fracking Revolution
"In January 2005, Texas produced 1,077 Kbbl/month of crude oil. By January 2015, it produced 3,300 Kbbl/month — a tripling driven by hydraulic fracturing in the Permian Basin. This is the single largest peacetime increase in oil production by any political entity in history. The environmental fingerprint: flaring visible from space, groundwater chemistry changes, prairie habitat fragmentation, nocturnal light pollution disrupting wildlife corridors. Every one of those shows up in other data domains."

### Scale
- Crude: 50 states x 43 years x 12 months = ~25,800 entries (but many states produce 0 — realistically ~15,000)
- Gas: 50 states x 33 years x 12 months = ~19,800 (realistically ~12,000)
- **Total: ~25,000 entries**

### Gotchas
- Many states produce zero oil/gas. Still embed "zero production" — the ABSENCE is the data.
- Production data lags 6+ months for final numbers. Preliminary data appears ~2 months.
- State-level gas production data is less reliable than oil — some states estimate.
- The "1000 barrels" unit is a trap. EIA uses Kbbl for monthly, bbl/day for daily context. Convert carefully.

---

## PIPE 4: NTSB Aviation Accident Database (The Incident Archive)

### The API
```
Endpoint: https://data.ntsb.gov/carol-repgen/api/Aviation/ReportMain/GenerateNestedReport/
  Or bulk CSV: https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=...
Auth: NONE. Fully public.
Rate limit: Undocumented. Bulk download preferred.
Alternative: AviationDB REST API at https://app.ntsb.gov/aviationquery/
```

**Best approach:** Bulk download the full database (~150MB CSV), parse locally, embed. Updated monthly. Files at: `https://data.ntsb.gov/avdata`

### The Data
Each accident record contains:
```
Fields:
  EventId, InvestigationType, AccidentNumber
  EventDate (YYYY-MM-DD), City, State, Country
  AirportCode, AirportName, Latitude, Longitude
  AircraftCategory, Make, Model, RegistrationNumber
  AmateurBuilt, NumberOfEngines, EngineType
  FARDescription (Part 91, 121, 135, etc.)
  Schedule (scheduled vs non-scheduled)
  AirCarrier
  TotalFatalInjuries, TotalSeriousInjuries, TotalMinorInjuries, TotalUninjured
  WeatherCondition (VMC/IMC)
  BroadPhaseOfFlight (takeoff, cruise, approach, landing)
  ProbableCause (text narrative — GOLD for embedding)
  PublicationDate
```

```
content_type: "ntsb_aviation_accident"
state: "NY"
title: "US Airways 1549: Airbus A320 ditched in Hudson River after dual bird strike (2009-01-15)"
content: "US Airways Flight 1549, an Airbus A320 carrying 155 passengers and crew, 
  struck a flock of Canada geese at 2,818 feet during climb-out from LaGuardia Airport. 
  Both engines lost thrust. Captain Chesley Sullenberger ditched the aircraft in the 
  Hudson River. All 155 survived. The probable cause was the ingestion of large birds 
  into both engines, resulting in a nearly complete loss of thrust. This event directly 
  connects to: wildlife strike patterns, Canada goose population data, January migration 
  patterns, and FAA bird strike mitigation programs that followed."
metadata: {
  event_id: "20090115X73510",
  event_date: "2009-01-15",
  city: "Weehawken",
  state: "NJ",
  latitude: 40.7742,
  longitude: -74.0076,
  aircraft_make: "Airbus",
  aircraft_model: "A320-214",
  registration: "N106US",
  operator: "US Airways",
  far_description: "Part 121",
  total_fatal: 0,
  total_serious: 5,
  total_minor: 78,
  total_uninjured: 72,
  weather: "VMC",
  phase_of_flight: "climb",
  probable_cause: "ingestion of large birds into both engines..."
}
```

### Narrative Examples

**9/11 Aftermath — The Ground Stop:**
"On September 11, 2001, the FAA issued a full ground stop of US airspace — the first in history. For 3 days, zero scheduled flights operated. The NTSB data shows a hole: no accident records from 9/11 through 9/14. But surrounding dates tell a story — the spike in incidents during the chaotic restart as 4,500 aircraft were repositioned. Cross-reference with BTS data showing airline traffic dropping 32% for the entire month."

**TWA Flight 800 (July 17, 1996):**
"TWA 800, a Boeing 747, exploded and crashed into the Atlantic Ocean off East Moriches, NY, killing all 230 aboard. Initial theories ranged from missile strike to bomb. The 4-year investigation concluded a center fuel tank explosion caused by an electrical short. On the same date: sea surface temperature off Long Island was 72F, air temperature was 81F, and the fuel tank had been heat-soaked on the tarmac for hours. The temperature differential is the cross-domain connection — weather data completes the causal chain."

**Alaska Bush Flying:**
"Alaska alone accounts for ~15% of all NTSB records despite having 0.2% of the US population. Pick any week in Alaska and you'll find incident reports — weather, terrain, remote strips, wildlife on runways. The density of Alaska aviation accidents is itself a data signal about wilderness accessibility, weather severity, and the infrastructure gap."

### Scale
- ~83,000 accident/incident records (1962 - present)
- Each gets one rich embedding
- **Total: ~83,000 entries**

### Gotchas
- The NTSB API is old and unreliable. Bulk CSV download is the only sane approach.
- ProbableCause field is sometimes blank for ongoing investigations. Embed what's available, backfill later.
- EventDate is the accident date, not the report date. Publication can lag years.
- Some records have lat/lon, some don't. Geocode from city/state for missing ones.
- Injury counts can be null (not zero). Treat null as unknown, not zero.
- "Incidents" (no damage/injury) are included alongside "Accidents." Both valuable.
- The CSV encoding is messy — watch for embedded commas in the ProbableCause field. Use a proper CSV parser.

---

## PIPE 5: BTS Air Traffic & Transportation Statistics (The Movement Pulse)

### The API
```
Endpoint: https://www.transtats.bts.gov/api/
  Or direct download: https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoession_id=0&Table_ID=236
Auth: NONE. Public data.
Best approach: Monthly bulk CSV downloads from TranStats
```

### Key Datasets
| Dataset | Table | Description | Start | Freq |
|---------|-------|-------------|-------|------|
| T-100 Domestic Segment | 259 | Passengers + freight by route | 1990-01 | Monthly |
| On-Time Performance | 236 | Flight delays, cancellations | 1987-10 | Monthly |
| Air Carrier Statistics | 298 | Revenue, fuel, employees by carrier | 1990-Q1 | Quarterly |
| Freight Analysis Framework | FAF | Commodity flow by mode | 2007 | Annual |

### The Data
```
content_type: "bts_air_traffic"
state: "US" (national or by origin/dest state)
title: "US domestic air passengers: 73.2M in March 2024 — 104% of pre-COVID March 2019"
content: "73.2 million domestic passengers flew in March 2024, finally surpassing the 
  pre-COVID baseline of 70.5M in March 2019. The recovery took 4 years. Average load 
  factor was 84.3%. Total domestic departures were 843,000 — still 8% below 2019 due 
  to pilot shortages and regional carrier consolidation. Fuel costs averaged $2.87/gallon 
  jet fuel, up 12% from the prior year. Cross-reference with: EIA jet fuel prices, 
  airport-area wildlife strike data, weather-related cancellation patterns."
metadata: {
  period: "2024-03",
  passengers_domestic: 73200000,
  departures: 843000,
  load_factor_pct: 84.3,
  avg_delay_min: 18.2,
  cancellation_rate_pct: 1.8,
  pct_of_2019: 104.0,
  jet_fuel_per_gallon: 2.87
}
```

### Narrative Examples

**Post-9/11 Aviation Collapse:**
"September 2001: US domestic passengers fell from 55.8M (August) to 35.1M — a 37% month-over-month collapse unprecedented in aviation history. October partially recovered to 41.2M. But the industry didn't fully recover to September 2000 levels until March 2004 — a 3.5 year hole. The time machine shows this alongside: NTSB ground stop data, EIA jet fuel demand cratering, airport employment drops, and the cascading economic effects on hotel, rental car, and restaurant industries in airport cities."

**COVID Trough (April 2020):**
"April 2020: 2.9 million domestic passengers. Down 96% from April 2019's 75.3M. TSA checkpoint data showed days with fewer than 90,000 travelers nationwide — the level of a single busy day at Atlanta Hartsfield. Airlines were flying nearly empty planes to maintain gate rights. Cross-reference with: negative oil prices (same month), PM2.5 improvements (same month), wildlife entering urban areas (same month)."

### Scale
- Monthly national summary: 34 years x 12 months = ~408 entries
- Monthly by state-pair (top 200 routes): 34 years x 12 x 200 = ~81,600
- **Recommended: national monthly + top 50 state-origin summaries = ~20,000 entries**

### Gotchas
- TranStats website is from 2002 and it shows. Downloading is painful — CSV export with manual field selection.
- Data lags 3-4 months.
- T-100 data is by CARRIER-ROUTE, not by passenger. Aggregation needed.
- Freight data is separate from passenger data. Both worth embedding.
- International flights are in a separate table (T-100 International).
- The API is unreliable. Bulk download and local processing is the way.
- File sizes can be 500MB+ for full on-time performance data. Filter to monthly aggregates.

---

## PIPE 6: NRC Nuclear Plant Events (The Grid's Nervous System)

### The API
```
Endpoint: https://www.nrc.gov/reading-rm/doc-collections/event-status/event/
  Event Notification Reports: https://www.nrc.gov/reading-rm/doc-collections/event-status/event/en.html
  Power Reactor Status: https://www.nrc.gov/reading-rm/doc-collections/event-status/reactor-status/
  Operating reactor list: https://www.nrc.gov/info-finder/reactors/
Auth: NONE. Public.
Rate limit: Standard web scraping courtesy.
```

**Best approach:** NRC publishes daily reactor status as HTML tables + monthly Event Notification Reports as text files. Parse both.

### The Data
```
content_type: "nrc_nuclear_event"
state: "PA"
title: "Three Mile Island Unit 2: Partial core meltdown — reactor scrammed, hydrogen bubble formed (1979-03-28)"
content: "At 4:00 AM on March 28, 1979, Three Mile Island Unit 2 in Dauphin County, PA 
  experienced a loss-of-coolant accident that led to a partial core meltdown. A stuck-open 
  pressurizer relief valve combined with operator error allowed the reactor core to become 
  partially uncovered. A hydrogen bubble formed in the reactor vessel. 140,000 residents 
  within 20 miles were advised to evacuate. The event was classified as INES Level 5 
  (Accident with Wider Consequences). TMI-2 never operated again. This is the defining 
  moment in US nuclear history — it halted all new reactor construction for 30 years. 
  Cross-reference with: Pennsylvania electricity generation shifting from 35% nuclear to 
  heavy coal dependence, NWS weather data for the evacuation period, population displacement patterns."
metadata: {
  event_number: "EN-1979-001",
  event_date: "1979-03-28",
  facility: "Three Mile Island",
  unit: 2,
  state: "PA",
  county: "Dauphin",
  latitude: 40.1531,
  longitude: -76.7247,
  event_type: "partial_core_meltdown",
  ines_level: 5,
  reactor_type: "PWR",
  capacity_mw: 906,
  power_level_pct: 97,
  duration_days: "permanent",
  evacuees: 140000,
  injuries: 0,
  fatalities: 0
}
```

### Key Data Streams
1. **Event Notification Reports (ENs):** ~200-400/year. Equipment failures, scrams, security events, environmental releases. Back to 1980.
2. **Daily Reactor Status:** Power level (0-100%) for each of 93 operating reactors. Updated daily.
3. **Licensee Event Reports (LERs):** Detailed technical write-ups. ~300/year. Lag 60 days.

### Narrative: Fukushima's US Shadow (March 2011)
"After Fukushima on March 11, 2011, the NRC ordered 'stress tests' at all 104 US reactors. Event Notification Reports spiked 40% as plants reported items that had previously gone unreported. Vermont Yankee's license renewal was denied. San Onofre in California began its shutdown process. The post-Fukushima era shows up as: nuclear generation declining nationally, natural gas generation surging to fill the gap, and a wave of early retirements — Indian Point (NY), Pilgrim (MA), Fort Calhoun (NE)."

### Scale
- Event Notification Reports: ~10,000 records (1980-present)
- Daily reactor status: 93 reactors x 40 years x 365 days = ~1.36M individual readings
  - **Recommended: aggregate to daily national + per-plant monthly = ~55,000 entries**
- **Total: ~65,000 entries**

### Gotchas
- NRC data is in HTML/text, not API. Scraping required.
- Event Notification Reports use inconsistent formatting across decades.
- Reactor names change (Indian Point 2 vs Indian Point Energy Center).
- Some events are classified/redacted (security-related). Accept gaps.
- "Power level 0%" can mean refueling outage (planned) or emergency shutdown (unplanned). The Event Notification Report distinguishes them.
- Decommissioned plants (34 units) still have historical data. Include them — that's the TIME MACHINE value.

---

## PIPE 7: EIA Weekly Petroleum Status (The Real-Time Supply)

### The API
```
Endpoint: https://api.eia.gov/v2/petroleum/stoc/wstk/data/
Auth: Same EIA key
```

### Key Series
| Series | Description | Start | Freq |
|--------|-------------|-------|------|
| PET.WCESTUS1.W | US Commercial Crude Stocks (Kbbl) | 1982-08 | Weekly |
| PET.WCRSTUS1.W | Strategic Petroleum Reserve (Kbbl) | 1982-08 | Weekly |
| PET.WGTSTUS1.W | US Motor Gasoline Stocks (Kbbl) | 1990-01 | Weekly |
| PET.WKJSTUS1.W | US Jet Fuel Stocks (Kbbl) | 1990-01 | Weekly |
| PET.W_EPM0F_YPT_NUS_MBBLD.W | US Refinery Utilization (%) | 1990-01 | Weekly |

### The Data
```
content_type: "eia_petroleum_inventory"
state: "US"
title: "US crude stocks: 440.2M bbl — 12% above 5-year avg, SPR at historic low of 347M bbl (2024-03-15)"
content: "US commercial crude oil inventories stood at 440.2 million barrels for the 
  week ending March 15, 2024 — 12% above the 5-year seasonal average. Meanwhile, the 
  Strategic Petroleum Reserve held just 347 million barrels, its lowest level since 1983, 
  after the Biden administration released 180M barrels in 2022 to combat prices. Refinery 
  utilization was 87.5%. Gasoline stocks were 234M barrels (5% below average — tight). 
  Jet fuel stocks were 41.2M barrels (normal). The commercial-to-SPR ratio of 1.27:1 
  means commercial stocks now exceed the strategic reserve — a condition that has only 
  existed since late 2022."
metadata: {
  week_ending: "2024-03-15",
  crude_stocks_kbbl: 440200,
  spr_kbbl: 347000,
  gasoline_stocks_kbbl: 234000,
  jet_fuel_stocks_kbbl: 41200,
  refinery_utilization_pct: 87.5,
  crude_vs_5yr_avg_pct: 12.0,
  crude_imports_kbbl_d: 6320,
  crude_production_kbbl_d: 13100
}
```

### Scale
- Weekly composites: 43 years x 52 weeks = ~2,236 entries
- **Total: ~2,500 entries** (lightweight but high-narrative-density)

### Gotchas
- Weekly data drops every Wednesday at 10:30 AM ET. Schedule cron for Wednesday afternoon.
- The 5-year average calculation EIA publishes shifts each year. Calculate your own for consistency.
- SPR releases are political events. The narrative MUST mention the policy context.
- Hurricane season disrupts refinery utilization predictably — build that into the narrative template.

---

## PIPE 8: EIA Monthly Energy Review (The Macro View)

### The API
```
Endpoint: https://api.eia.gov/v2/total-energy/data/
Auth: Same EIA key
```

### Key Series
| Series | Description | Start | Freq |
|--------|-------------|-------|------|
| TOTALENERGY.TETCBUS.M | Total primary energy consumption (Quad BTU) | 1973-01 | Monthly |
| TOTALENERGY.TERCBUS.M | Renewable energy consumption | 1973-01 | Monthly |
| TOTALENERGY.TEPRBUS.M | Total energy production | 1973-01 | Monthly |
| TOTALENERGY.TEIMP.M | Energy imports | 1973-01 | Monthly |
| TOTALENERGY.TEEXP.M | Energy exports | 1973-01 | Monthly |

### The Data
```
content_type: "eia_energy_balance"
state: "US"
title: "US energy: net exporter for 3rd consecutive month — producing 103.2 Quad BTU/yr pace (2024-03)"
content: "In March 2024, the US produced energy at an annualized rate of 103.2 
  quadrillion BTU, while consuming at 97.8 Quad BTU — a net export position. This is a 
  structural reversal: the US was a net importer from 1953 through 2019 (66 consecutive 
  years). The shift was driven by shale oil/gas. Renewable energy now accounts for 13.4% 
  of consumption, up from 6.2% in 2000. Coal's share fell from 23% to 10%. The energy 
  independence story is the macro context for everything — it changes trade balances, 
  foreign policy, and the economics of every industry in the brain."
metadata: {
  period: "2024-03",
  production_quad_btu: 8.60,
  consumption_quad_btu: 8.15,
  imports_quad_btu: 2.13,
  exports_quad_btu: 2.58,
  net_position: "exporter",
  renewable_pct: 13.4,
  fossil_pct: 79.2,
  nuclear_pct: 7.4
}
```

### Scale
- 50+ years x 12 months x 5 key series = ~3,000 entries
- **Total: ~3,000 entries**

### Gotchas
- Quad BTU is the universal energy unit but non-intuitive. Always include context (e.g., "enough to power X million homes").
- Import/export data includes both oil AND natural gas AND electricity AND coal. The total can mask shifts.
- Monthly data since 1973 = covers BOTH oil crises, Three Mile Island, Gulf War, 9/11, Katrina, 2008, COVID. This is the BACKBONE series.

---

## PIPE 9: NOAA Storm-Related Fatalities (The Human Cost)

### The API
```
Endpoint: https://www.ncdc.noaa.gov/stormevents/ftp.jsp
  FTP: ftp://ftp.ncdc.noaa.gov/pub/data/swdi/stormevents/csvfiles/
Auth: NONE
Method: Bulk CSV download, annual files
```

**Note:** This is DIFFERENT from Storm Events Database (already in brain as hunt-disaster-watch). Storm Events has event details. This is the FATALITY detail table — who died, where, how.

### The Data
```
content_type: "noaa_storm_fatality"
state: "FL"
title: "Hurricane Andrew fatalities: 15 direct, 26 indirect in Dade County FL (1992-08-24)"
content: "Hurricane Andrew made landfall in southern Dade County, FL at 4:40 AM on 
  August 24, 1992 as a Category 5 with 165 mph winds. 15 people died directly from the 
  storm (structural collapse, flying debris, drowning). 26 additional indirect deaths 
  followed (heat exposure from power loss, carbon monoxide from generators, cleanup 
  accidents). 65,000 homes destroyed. $27.3 billion in damage. The fatality pattern 
  reveals that indirect deaths exceeded direct deaths by 73% — a pattern that repeats 
  in virtually every major hurricane. Cross-reference with: power outage data, EIA 
  electricity disruption, wildlife displacement, and the 6-month recovery signature 
  in every data domain."
metadata: {
  event_date: "1992-08-24",
  event_type: "hurricane",
  state: "FL",
  county: "Dade",
  direct_deaths: 15,
  indirect_deaths: 26,
  total_deaths: 41,
  fatality_type_breakdown: {
    structural: 6,
    drowning: 4,
    flying_debris: 3,
    other_direct: 2,
    heat_exposure: 8,
    carbon_monoxide: 7,
    cleanup: 6,
    other_indirect: 5
  },
  property_damage_usd: 27300000000
}
```

### Scale
- Annual fatality detail files from 1996 to present
- ~1,500-3,000 fatality records per year
- **Total: ~60,000 entries (30 years)**

### Gotchas
- This is the FATALITY detail table, not the event table. Link them via episode_id.
- Fatality location (lat/lon) is sometimes where the person was found, not where the event started.
- "Direct" vs "indirect" classification is subjective. NWS has guidelines but edge cases abound.
- Heat deaths are chronically undercounted (attributed to heart failure instead).
- Pre-1996 fatality data is in a different format and much less detailed.
- Already have storm events in hunt-disaster-watch — these COMPLEMENT, don't duplicate.

---

## PIPE 10: USGS Mineral Production (The Industrial Skeleton)

### The API
```
Endpoint: https://www.usgs.gov/centers/national-minerals-information-center
  Data tables: https://www.usgs.gov/centers/nmic/commodity-statistics-and-information
  MRDS database: https://mrdata.usgs.gov/mrds/
Auth: NONE
Method: Published spreadsheets + PDF yearbooks → parse
```

### Key Commodities
| Mineral | Why It Matters | Data Start |
|---------|---------------|------------|
| Coal | Energy transition story | 1949 |
| Gold | Economic stress indicator | 1900 |
| Copper | Infrastructure/electrification proxy | 1900 |
| Sand & Gravel | Construction activity = habitat disturbance | 1971 |
| Cement | Same as sand/gravel | 1971 |
| Rare Earths | Tech supply chain | 2000 |

### The Data
```
content_type: "usgs_mineral_production"
state: "WV"
title: "West Virginia coal: 68.4M short tons (2023) — down 62% from 1997 peak of 181M"
content: "West Virginia produced 68.4 million short tons of coal in 2023, continuing a 
  25-year decline from the state's 1997 peak of 181 million tons. In 2023, WV was the 
  #2 coal-producing state (behind Wyoming). Surface mining accounted for 47% of production. 
  The decline represents ~35,000 lost mining jobs, hundreds of abandoned mine sites, and 
  a fundamental restructuring of Appalachian ecology. Former surface mines are now some 
  of the most ecologically active landscapes in the eastern US — early successional 
  habitat that supports diverse wildlife populations. Cross-reference with: electricity 
  generation data (coal-to-gas switching), air quality improvements, economic/employment 
  data, and ecological succession on reclaimed mine lands."
metadata: {
  state: "WV",
  year: 2023,
  commodity: "coal",
  production_short_tons: 68400000,
  unit: "short_tons",
  rank_national: 2,
  pct_of_peak: 37.8,
  peak_year: 1997,
  peak_production: 181000000,
  surface_pct: 47,
  underground_pct: 53
}
```

### Scale
- Coal by state: 50 states x 75 years = ~3,750 (but ~30 states produce coal → ~2,250)
- Gold, copper, other minerals: ~15 commodities x 50 states x 50 years = ~37,500 (but most are sparse)
- **Realistic total: ~15,000 entries**

### Gotchas
- USGS mineral data is in PDFs and Excel files, NOT an API. Parsing required.
- Annual only — no monthly or daily granularity.
- State-level data is sometimes withheld to protect proprietary info (< 3 producers in a state).
- Units vary wildly by commodity (short tons, metric tons, troy ounces, kilograms).
- Coal data is the richest and most complete. Other minerals are spotty at state level.
- The MRDS (Mineral Resources Data System) has mine locations with lat/lon — could map every mine in the US.

---

## CROSS-DOMAIN NARRATIVE POWER

The real magic isn't any single pipe. It's what happens when you pick a date and ALL of them talk:

### July 11, 2008 — Peak Oil Price
- **EIA Prices:** WTI crude hits $147.27/bbl (all-time high)
- **EIA Inventory:** SPR at 707M bbl (Bush admin reluctant to release)
- **BTS Traffic:** Airlines cut 11% of domestic flights vs prior year
- **EIA Generation:** Natural gas plants throttling due to fuel costs
- **USGS Coal:** Production surge as utilities switch from gas back to coal
- **NOAA Fatalities:** Heat deaths rising as low-income households cut A/C to pay energy bills

### March 11, 2011 — Fukushima
- **NRC Events:** Stress test orders issued to all 104 US reactors within 48 hours
- **EIA Nuclear Gen:** US nuclear capacity factor drops from 90% to 85% as inspections begin
- **EIA Gas Production:** Natural gas ramp accelerates to replace nuclear (gas surpasses coal for first time by 2016)
- **NTSB Aviation:** Normal day in US aviation — the contrast with Japan's aviation shutdown is itself a data point

### February 15, 2021 — Texas Freeze
- **EIA Generation TX:** Collapse from 40,000 GWh to 28,000 GWh
- **EIA Gas Prices:** Henry Hub spikes 300%+, Houston Ship Channel spot price hits $400/MMBtu
- **Power Outages (existing pipe):** 4.5M customers dark
- **NOAA Fatalities TX:** 246 deaths (210 hypothermia, 36 other)
- **NRC Events:** South Texas Project reactor auto-scrams on low frequency
- **BTS Traffic:** DFW and Houston airports closed 5 days
- **NTSB:** Multiple GA accidents from ice

---

## IMPLEMENTATION PRIORITY

| Priority | Pipe | Entries | Effort | Cross-Domain Impact |
|----------|------|---------|--------|-------------------|
| 1 | EIA Daily Energy Prices | ~55K | Low (clean API) | EXTREME — touches everything |
| 2 | NTSB Aviation Accidents | ~83K | Medium (CSV parse) | HIGH — 60 years of incidents |
| 3 | EIA Electricity by Source | ~15K | Low (clean API) | HIGH — grid anatomy |
| 4 | NRC Nuclear Events | ~65K | Medium (scraping) | HIGH — dramatic events |
| 5 | EIA Weekly Petroleum | ~2.5K | Low (clean API) | MEDIUM — supply context |
| 6 | BTS Air Traffic | ~20K | Medium (CSV parse) | HIGH — mobility pulse |
| 7 | EIA Oil/Gas Production | ~25K | Low (clean API) | MEDIUM — supply geography |
| 8 | EIA Monthly Energy Review | ~3K | Low (clean API) | HIGH — 50yr macro backbone |
| 9 | NOAA Storm Fatalities | ~60K | Low (CSV parse) | HIGH — human cost layer |
| 10 | USGS Mineral Production | ~15K | High (PDF/Excel parse) | MEDIUM — industrial geology |

**Total new entries: ~344,000**
**Total new content types: 10**
**EIA API key: 1 key, 5 pipes**

---

## THE META-NARRATIVE

These 10 pipes complete the "civilization layer" of the time machine. You already have nature (weather, water, wildlife, soil, fire, seismic, phenology). You already have the atmosphere (air quality, space weather, climate indices). Now you're adding the HUMAN SYSTEMS that interact with both:

- **Energy** = how civilization powers itself (EIA prices, generation, production, inventory, macro)
- **Transportation** = how civilization moves (BTS, NTSB)
- **Infrastructure** = the physical grid (NRC, power outages)
- **Extraction** = what civilization takes from the earth (USGS minerals)
- **Consequence** = what nature does to civilization (NOAA fatalities)

When someone picks a date in 1973, they should feel the oil embargo in EVERY data stream. When someone picks 9/11, they should see the aviation hole alongside the energy market chaos alongside the air quality improvement alongside the wildlife behavioral changes. That's what makes this a time machine and not a dashboard.

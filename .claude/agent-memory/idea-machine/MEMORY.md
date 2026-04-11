# Idea Machine Memory

## Audit History
- See `audit_2026_03_14.md` — Full product audit of Duck Countdown. Brutally honest assessment of vision vs reality gap.

## Data Source Research
- See `data_source_recon_v2.md` — 30 untapped free public data sources for wildlife movement intelligence. Tiered by impact. Generated 2026-03-14.
- See `data_source_recon_v3_beyond.md` (in `~/.claude/agent-memory/idea-machine/`) — 43 unconventional/proxy sources. FAA strikes, deer-vehicle, power grid, phenocam, acoustic, Canada/Mexico. Generated 2026-03-14.
- See `data_source_recon_v4_biological_pattern_engine.md` — 50 NEW sources for expanded "biological pattern engine" vision. GPS tracking, acoustic, camera traps, marine, insects, phenology, government surveys, research DBs, wildcards, plus "environmental state vector" meta-architecture. Generated 2026-03-19.
- See `data_source_recon_v5_insane_asylum.md` — 75 NET-NEW ideas across 10 categories: proxy signals, social media sensors, economic signals, infrastructure bio-sensors, historical/cultural data, unused predictive inputs, platform-as-sensor, wild connections, emergent product features, monetization angles. Key themes: every human system touching nature = inadvertent sensor, economic behavior = highest-fidelity signal, macro climate indices give multi-week lead times, county-level intelligence is the monetizable resolution, B2B may be bigger than B2C. Generated 2026-03-19.
- See `data_source_recon_v6_signal_hunter.md` — 15 net-new sources filling critical gaps. Top 4: NDWI water extent (the waterfowl holy grail), NPN first frost/green-up (phenological clock), CPC soil moisture anomalies (invisible water variable), USGS bird banding encounters (actual migration routes = ground truth). Also: seismic (ComCat), mast production (FIA), storm events (NOAA historical), air quality (EPA AQS), lake ice phenology (NSIDC), fire perimeters, FAA wildlife strikes, SST anomalies, water quality, geomagnetic Kp, WNV surveillance. Generated 2026-03-20.

## Economic/Financial Data Architecture
- See `economic_data_pipes_2026_04_03.md` — 6 pipes, 221K entries. FRED (40 series, 137K), stock market history (71K), BLS CPI detail (6K), USDA commodities (26K), NBER events (200), FOMC decisions (500). Exact APIs, series IDs, narrative templates, gotchas, phased execution plan.

## Energy/Infrastructure Data Architecture
- See `data_pipes_energy_infrastructure_2026_04_03.md` — 10 pipes, ~344K new entries. EIA prices (55K), NTSB aviation (83K), EIA electricity gen (15K), NRC nuclear (65K), EIA petroleum inventory (2.5K), BTS air traffic (20K), EIA oil/gas production (25K), EIA energy balance (3K), NOAA storm fatalities (60K), USGS minerals (15K). 5 EIA pipes share 1 API key. Cross-domain narrative templates for oil crisis, 9/11, Katrina, Fukushima, Texas freeze. The "civilization layer."

## Health/Disease Data Architecture
- See `data_source_recon_v7_health_disease_pipes.md` — 6 pipes, 2.3-4M new entries. Project Tycho 1888-2013 (2.5M, the motherlode), FluView via Delphi (85K), NNDSS via SODA API (800K), JHU COVID archive (64K), COVIDcast sensor fusion (600K), WHO outbreaks (3.5K). Exact APIs, auth, rate limits, narrative templates, gotchas. Doubles the brain. Build order: Tycho -> COVID -> FluView -> NNDSS -> COVIDcast -> WHO. Generated 2026-04-03.

## Agriculture & Nature Data Architecture
- See `brainstorm_ag_nature_pipes_2026_04_03.md` — 7 pipe designs + 8 synthesis ideas. NASS crop progress deep historical (1997-2025, 1.2M), NASS production/yields (1950+, 500K), livestock inventory (30K), NPN historical phenology (1956+, 200-500K), NOAA divisional PDSI (1895+, 78-536K), commodity prices via FRED+NASS (370K), Journey North (50K). ~2.5-3.5M new entries total. Priority: PDSI first (Dust Bowl visibility), then crop progress deep backfill. Plus: Agricultural Calendar fingerprints, Phenological Wavefront tracking, GDD accumulation, Crop-Wildlife Collision Calendar, Farm Economy Indicator, Census of Agriculture.

## Cross-Domain Time Machine Data Sources
- See `data_source_recon_v8_cross_domain_time_machine.md` — 55 net-new sources across 12 non-environmental domains. Sports (MLB/NFL/Olympics), astronomy (sunspots/eclipses/asteroids), crime (FBI UCR, FARS), politics (Congress/SCOTUS/elections), culture (NYT/Billboard/Wikidata/Ngrams), transport (FAA ops/bridges/AIS), demographics (census/baby names/immigration), science (patents/Nobel), disasters (EM-DAT/volcanoes/IBTrACS), economy (World Bank/trade/bank failures), religion/calendars, environment deep cuts (TRI/paleoclimate/landslides). 24-44M entries total. Top picks: Wikidata Events, NYT Archive, FBI Crime, IBTrACS, Congress.gov, CDC WONDER, MLB Retrosheet, Sunspot Record, Global Volcanism, SSA Baby Names. Generated 2026-04-03.

## Real Use Cases Analysis
- See `use_cases_real_2026_04_03.md` — 17 brutally honest use cases. Top B2B: insurance/ag commodity/energy/event insurance/legal. Top consumer: weather nerds/hunters/allergy. Top viral: date explorer/argument settler/climate anxiety SEO. Strategy: viral consumer = front door, API = business.
- See `brainstorm_audience_personas_2026_04_10.md` — 10 deep-specificity personas with Wednesday problems. Emergency mgr (FEMA precedent), crop adjuster ($180K claims), litigation support (construction defect), energy site assessor, phenology hobbyist (viral), cat bond analyst, TV weather producer, water utility operator (50K systems TAM), event insurance underwriter, environmental journalist (credits in stories). 3 structural patterns: compound context gap, "compared to what?" as core value, grading loop = compliance.

## User Preferences
- James thinks like a trader building a terminal. Data density > pretty UI.
- "Bloomberg Terminal for animal movement" is the north star metaphor.
- Loves cross-referencing signals: "last N times this happened, here's what followed."
- Wants the product to feel ALIVE — data flowing, brain reacting.
- 5 species: duck, goose, deer, turkey, dove. Duck/goose are strongest. Deer/turkey/dove need more data sources badly.
- 2026-03-19: James declared vision BIGGER THAN HUNTING — "biological pattern engine." Animals as environmental sensors, every kingdom, cross-species. This is the new north star alongside the Bloomberg Terminal metaphor.

## Company-Defining Brainstorm
- See `brainstorm_company_defining_2026_04_03.md` — THE brainstorm. 100+ ideas across 10 dimensions. "Human Record" data sources (sports/music/obituaries/patents/wire feeds), visual cross-referencing (Constellation/Sediment Core/Domain Pulse Bars), query-loop visibility, 6 revenue models (API/reports/subscriptions/partnerships/licensing/prediction market), viral features (Date Card/Birthday Report/Argument Settler), daily engagement (Today in Brain/Streak/Watchlist), proof mechanisms (Coincidence Score/Null Test/Replication Button), partnerships (Ancestry/TWC/insurance/NatGeo), 1B entry vision, naming (Earthmind recommended). 7 bonus sparks (Twin Date, What If slider, Embed Your Own Data, Audio Brain).

## Prioritized Roadmap
- See `roadmap_april_2026.md` — 15-item roadmap. THIS WEEK: Date Card + Backfill Blitz + /date/ route + Today Feed + Feedback loop. NEXT WEEK: API v1 + Compare Dates + Wikidata + Email + Catalog. THIS MONTH: Embeddable widget + Newspapers + Birthday Report + Prediction Market + CLI. If only 3: Backfill + Date Card + /date/ route.

## JAC Agent OS — Future Direction
- See `brainstorm_jac_agent_os_future_2026_04_09.md` — 17 ideas. Core thesis: JAC should become the agent/ops/conversational layer for DCD, not a standalone product. Top 5: Brain Bridge (JAC searches hunt_knowledge), Cron Management (JAC manages DCD's 88 crons), Conversational Ops (Slack = ops dashboard), Kill the Dashboard (chat-only), Phone Widget (1-sec dump). Key tension: James's stated "no interface" principles vs 12 routes + 20 widgets actually built.

## Interface Rethinking
- See `brainstorm_kill_the_chat_2026_04_09.md` — 20 ideas for replacing chat-first interface. Core thesis: stop translating data into words. Top 5: The Tape (real-time ticker), Conviction Charts (state as stock), Autopsy Table (cinematic grading), The Receipt (structured query response), Inverse Search (condition-first temporal query). Also: Ledger, Equalizer, Calendar Heatmap, Diff View, Evidence Locker, Ambient Mode, Nervous System Map, Trust Thermometer, Narrated Replay, plus 5 bonus sparks.

## Naming / Identity
- See `brainstorm_naming_the_thing_2026_04_10.md` — THE identity session. Core synthesis: "artificial hippocampus for the Earth." Top category name: "observational intelligence." Key insight: DCD is a new MEDIUM, not a known category.
- **Intellectual Identity (2026-04-10):** Breakthrough = "hypothesis-free causal discovery via narrative embedding geometry." Best metaphor = "Earth state space telescope." 5 moats: grading corpus, emergent topology, scanBrainOnWrite meta-knowledge, narrative embedding (non-obvious), temporal density (time-locked). 3 discoveries at 100M: earthquake bio-precursors, cross-domain teleconnections with lag times, regime shift early detection. Closest analog: IC fusion centers minus human analysts -- cosine similarity IS the analyst.

## The Definitive "What Is This" Brainstorm
- See `/Users/jameschellis/marsh-timer/docs/brainstorm-what-is-this.md` — THE identity document (written to project docs/). 8 sections: 6 framings (Bloomberg for Earth, fusion center, self-assembling encyclopedia, Wayback+pattern completion, domain-agnostic environmental memory, hypothesis-free causal discovery), 5 metaphors (core sample, seismograph for everything, palimpsest, multi-wavelength telescope, crime board), 5 intellectual breakthroughs (narrative as universal schema, write-time autonomous discovery, self-grading = Popperian falsificationism, temporal holography, embedding topology as discovery), 10 one-liners, 10 named personas, 5 at-scale discoveries, 6 moats, 10 missing pieces. Key NEW insights: "witness" framing for legal/insurance markets, "printing press for environmental data" analogy, Metcalfe's Law for domain count, temporal embedding as feature not filter, "null result as feature" product concept. Generated 2026-04-10.

## Brainstorm History
- See `brainstorm_ux_visualization_2026_03_19.md` — 15 specific ideas for surfacing 213K data points. Core problem: data trapped in vectors, UI is 6 static cards. Top recommendations: sparklines everywhere, convergence decomposition chart, brain activity monitor.
- See `brainstorm_synthesis_agent_2026_03_26.md` — 40+ ideas across 8 categories for the synthesis agent. Architecture, arc data model, narrative gen, visualization, v1 scope, embedding tricks, grading visibility, wild novelty. Top picks: Arc Reactor Lite, Dual-Loop, Heartbeat model, Arc Fingerprinting, Hindsight Machine.
- See `brainstorm_ux_architecture_2026_03_27.md` — 8 UX architecture proposals for front door problem. Recommended sequence: Swap (now) -> Cascade state pages -> Radar Scope -> Newsroom.
- See `brainstorm_ux_navigation_2026_03_27.md` — 12 product-reference patterns for unifying Intel + Map. Bloomberg bar, Grafana drill-down, Windy floating panels, FR24 entity select, Robinhood two-level, Notion sidebar, Linear Cmd+K, Earth arc replay, mobile card stack, intel-as-default, shared state bus, history mode. Top 3: Bloomberg Bar + Shared State Bus + FR24 Entity Selection.
- See `brainstorm_frontend_redesign_2026_03_27.md` — 10 net-new visualization concepts for making brain thinking visible. Conviction Meter, Domain Collision Timeline, Autopsy Drawer, Pressure Differential scatter, PFD Strip, Ghost Layer, Handshake Counter, Split Verdict, Regime Detector, Brain's Bookmarks. Plus 4 bonus sparks. All trader-metaphor native.
- See `brainstorm_data_viz_concepts_2026_03_27.md` — 10 zero-text viz concepts organized by zoom level. 6 fully novel (Signal Chain DAG, Arc Heartbeat waveform, Domain Waterfall bar, Correlation Web, Fingerprint Overlay, Pulse Grid), 4 variants on prior ideas. Country/system/state hierarchy = trading terminal progressive disclosure.
- See `brainstorm_paradigm_shift_2026_03_27.md` — 8 non-dashboard paradigms (Flight Deck, CIA Briefing, Trading Floor, ESPN Broadcast, ICU Monitor, Strategy Game, Mixing Board, Newspaper). Hybrid recommendation: 3-layer architecture (Deviation Board for scan + Watchlist/Tape for operation + Waveform Stack for deep dive). Key insight: product needs LAYERS of zoom, not one zoom level.
- See `brainstorm_pattern_engine_pivot_2026_04_03.md` — 40+ ideas for pattern matching engine pivot. Landing (Google Moment / Recipe Wall / Proof Shot), query (Three-Knob Console / Filter Funnel / "More Like This"), pattern viz (Dossier / Scorecard Stack / Fingerprint Overlay / Season Wheel), map as support, fusion reveal (Peeling Layer / Coincidence Score), honest track record, mobile (Card Stack / Voice / Pocket Brief), wild (Time Machine / Environmental Genome / Brain's Diary / Prove Me Wrong / Embeddable Widgets).
- See `brainstorm_ocean_coastal_pipes_2026_04_03.md` — 7 ocean/coastal pipe designs totaling ~5.5M new entries. CO-OPS verified water levels + residuals (2.5-3M), NDBC deep buoy history (2.2M), ERSST v5 SST 1854+ (163K), PSMSL sea level 150yr (47K), Coral Reef Watch (62K), storm surge derived (5-10K), tsunami/DART wildcard (110K). Key insight: tide residual = pure meteorological signal.

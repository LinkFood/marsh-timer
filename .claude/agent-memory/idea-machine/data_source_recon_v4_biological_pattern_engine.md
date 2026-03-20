---
name: Data Source Recon V4 — Biological Pattern Engine (50 Sources + Meta-Play)
description: 50 new data sources for expanding Duck Countdown beyond hunting into a full biological pattern engine. Covers GPS tracking, acoustic monitoring, camera traps, marine/fish, insects, phenology, citizen science, government surveys, research databases, and wildcard signals. Plus the "environmental state vector" meta-idea. Generated 2026-03-19.
type: project
---

## Context
James declared the vision bigger than hunting: animals as biological sensors, environmental inputs -> biological outputs. V2 had 30 sources, V3 had 43 unconventional sources. V4 goes beyond both with 50 new sources organized by signal type, plus the "data fusion embedding" meta-architecture.

## Sources by Category

### Tier 1: Live Animal Tracking (5)
1. Movebank — 2.5B GPS locations, REST API, free. ACTUAL MOVEMENT VECTORS, not observations.
2. ICARUS (Max Planck) — Satellite tracking with body temp/heart rate telemetry.
3. Ocean Tracking Network — 3,000 acoustic receivers, fish/shark/turtle tracks, ERDDAP API.
4. Motus (expanded scope) — 1,800 radio towers, birds+bats+dragonflies, near-real-time, signal strength=altitude.
5. Wildlife Computers SPOT/SPLASH — Marine tags, dive depth profiles, public portal.

### Tier 2: Acoustic Monitoring (4)
6. BirdWeather / BirdNET — 5,000+ always-on stations, NOCTURNAL migration detection, public API, real-time.
7. Arbimon (Rainforest Connection) — 100K+ sites, birds+frogs+insects+mammals from sound.
8. NABat (USGS bat monitoring) — Echolocation acoustic detectors, bat activity = live barometer.
9. Whale Alert / Whale Map — Real-time whale acoustic + sighting data, NOAA hydrophones.

### Tier 3: Camera Trap Networks (3)
10. Wildlife Insights (Google) — 30M+ images, AI-classified, API, 1000+ projects.
11. eMammal (Smithsonian) — North American mammals, timestamp/location/species.
12. Snapshot USA — Standardized 1,500+ sites all 50 states, occupancy modeling.

### Tier 4: Marine & Aquatic (4)
13. ERDDAP (NOAA) — Unified ocean data API: SST, chlorophyll, currents, salinity.
14. REEF — Volunteer fish surveys, species abundance by location.
15. USGS Nonindigenous Aquatic Species — Invasive species as food web disruptors.
16. Global Fishing Watch — Vessel tracking as proxy for fish/prey distribution.

### Tier 5: Insects & Pollinators (4)
17. iNaturalist arthropods — Monarch, firefly as phenological calibration signals.
18. Journey North — Decades of first-arrival dates, monarchs/hummingbirds/robins/tulips.
19. USA National Phenology Network (expanded) — Pheno Forecast maps, predicted emergence.
20. Bumble Bee Watch — Pollinator emergence as biological thermometer.

### Tier 6: Phenology & Vegetation (4)
21. PhenoCam Network — 700+ cameras, Green Chromatic Coordinate, deer rut predictor.
22. MODIS/VIIRS Active Fire — Real-time fire detection, post-burn animal concentration.
23. Copernicus Sentinel-2 Phenology — 10m resolution field-level harvest detection.
24. CropScape spatial layer — 30m crop type + harvest timing = waterfowl staging prediction.

### Tier 7: Citizen Science Platforms (4)
25. GBIF — 2.6B records, aggregator of all aggregators, single API for everything.
26. Herp Mapper — Reptile/amphibian emergence as temperature calibration.
27. Mushroom Observer — Fungal fruiting as moisture+temp proxy, API available.
28. Zooniverse (cherry-picked projects) — Camera trap trigger counts as activity indices.

### Tier 8: Government Surveys (5)
29. USFWS Waterfowl Breeding Population Survey — Gold standard since 1955.
30. Christmas Bird Count (Audubon) — 120+ years midwinter distribution.
31. North American Breeding Bird Survey (USGS) — 58 years population trends.
32. Midwinter Waterfowl Survey (USFWS) — January aerial counts by flyway.
33. State Wildlife Action Plans — GIS habitat layers, migration corridors.

### Tier 9: Research Databases (4)
34. Dryad — Open research datasets with animal movement + environmental covariates.
35. DataOne — Federation of 44 earth/environmental data repositories.
36. NEON — 81 standardized sites: small mammals, birds, beetles, ticks, phenocams, all open API.
37. Animal Diversity Web — Behavioral ecology knowledge base (why patterns exist).

### Tier 10: Wildcards (13)
38. Roadkill observation systems — Involuntary census, zero observer bias.
39. Airport Wildlife Hazard Assessments — Detailed seasonal species inventories.
40. Power Line Collision Data (APLIC) — Bird collisions + weather conditions at collision time.
41. ASOS mic feeds — Dawn chorus index from existing weather station audio.
42. FeederWatch (Cornell) — Irruptive species = harsh condition signal.
43. HIP Registration (reframed) — Hunter distribution as human prediction market.
44. Fishing license sales + creel surveys — Catch per effort as biological sensor.
45. USGS Wildlife Disease Surveillance — HPAI/CWD outbreaks change movement patterns.
46. VIIRS Light Pollution — Artificial light affects nocturnal migration + mammal activity.
47. USDA SCAN/SNOTEL Soil Temperature — 2000+ stations, hidden variable for spring phenology.
48. Pollen monitoring — Phenological marker for vegetation development stage.
49. Cicada emergence tracking — Soil temp calibration + food bonanza signal.
50. River ice-out dates — Controls spring waterfowl arrival, decades of historical data.

## Meta-Play: Environmental State Vectors
Nightly composite embedding per county: ALL available signals concatenated into one "fingerprint." Search for historical days with similar fingerprints across ALL dimensions simultaneously. Not 50 separate signals — one unified biological-environmental state space.

## User Reaction
- James explicitly asked for sources beyond hunting — "bigger than hunting, biological pattern engine"
- Specifically called out: Movebank, acoustic, camera traps, fish/marine, insects, phenology
- Strong resonance with cross-kingdom thinking

---
name: Data Source Recon V2 — 30 Untapped Public Sources
description: Comprehensive survey of free public data sources for wildlife movement intelligence. 30 sources identified, tiered by impact and ease of ingest. Generated 2026-03-14.
type: project
---

## Summary
30 free public data sources identified beyond what's already ingested. Organized into 3 tiers:

### Fill First (high signal, easy ingest)
1. US Drought Monitor — weekly REST API, no auth, all 5 species
2. NOAA Snow Cover (NOHRSC/SNODAS) — daily, hardest migration signal
3. Great Lakes Ice (GLERL) — daily CSV, flyway bottleneck signal
4. USDA Weekly Crop Progress — already have NASS API key
5. iNaturalist — eBird equivalent for deer/turkey/dove, REST API no auth
6. NWS River Forecasts (AHPS) — predictive flood stages, XML API
7. USACE Pool Levels — managed habitat events, the insider signal

### Massive Unlock (harder but transformative)
8. Movebank — GPS animal tracking, REST API, free registration
9. USDA Forest Service Mast Surveys — annual, state DNR PDFs/tables
10. State Game Agency Harvest Reports — ground truth, varies by state
11. NASA NDVI via AppEEARS — vegetation health, 16-day composites
12. SMAP Soil Moisture via AppEEARS — ephemeral wetland detection

### Bloomberg Terminal Flex (makes product feel alive)
13. CPC 6-14 Day Outlooks — macro temperature predictor
14. SPC Severe Weather Outlooks — migration trigger prediction
15. NEXRAD Roost Departures — morning bird locations from radar
16. Motus Wildlife Tracking — individual bird detections near real-time

### Also Identified
17. National Phenology Network — green-up, leaf-off, frost timing
18. NOAA Buoy Data — coastal water temp, sea duck distribution
19. eBird Status and Trends — modeled abundance surfaces
20. OpenAQ — smoke/visibility affecting flight behavior
21. National Wetland Inventory — baseline habitat map
22. State WMA Waterfowl Counts — weekly aerial surveys
23. PRISM Climate — 4km resolution temp/precip grids
24. NEXRAD Dual-Pol — bio vs precip discrimination
25. USGS Bird Banding Lab — actual migration route data
26. USGS Real-time Streamflow — 15-min flood detection (upgrade to existing)
27. NOAA Jet Stream / Upper Air — macro migration predictor
28. NIFC Active Fire / Prescribed Burns — dove/turkey habitat creation
29. HIP Registration Data — hunting pressure signal
30. SPC Storm Outlooks — frontal passage prediction

## Status
- None built yet as of 2026-03-14
- Drought Monitor, Snow Cover, and iNaturalist are lowest-hanging fruit
- USDA Crop Progress can piggyback on existing NASS API key

**Why:** Brain is ~103K entries, mostly weather/eBird/DU. These 30 sources push toward the 1M+ target and fill critical gaps especially for non-avian species (deer, turkey, dove have almost no real-time data feeds today).

**How to apply:** Build one at a time following the existing pattern: ingest function + backfill script + pg_cron. Respect the 1-pipe-at-a-time rule.

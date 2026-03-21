# BACKFILL API MASTER LIST

Last updated: 2026-03-20 9:00 PM ET
Brain: 295K+ entries, 36 sources live | Target: 4M+

---

## BUILT & DONE

| # | Source | API Endpoint | Content Type | Auth | Entries | Notes |
|---|--------|-------------|--------------|------|---------|-------|
| 1 | USGS Water Gauges | `waterservices.usgs.gov/nwis/dv/` | `usgs-water` | None | 267K | All 50 states, 2021-2026 |
| 2 | NOAA Tides | `api.tidesandcurrents.noaa.gov/` | `noaa-tide` | None | 28.6K | All coastal stations |
| 3 | Photoperiod | Pure math (solar calcs) | `photoperiod` | None | 37K | All 50 states |
| 4 | GBIF Biodiversity | `api.gbif.org/v1/occurrence/search` | `gbif-monthly` | None | 6.9K | 10 species |
| 5 | US Drought Monitor | `usdmdataservices.unl.edu/api/` | `drought-monitor` | None | 8.4K | 50 states, 168 weeks |
| 6 | BirdWeather | `app.birdweather.com/graphql` | `birdweather-daily` | None | 10.8K | Acoustic detections |
| 7 | iNaturalist | `api.inaturalist.org/v1/` | `inaturalist-observation` | None | 4K | Deer/turkey/dove |
| 8 | NIFC Fire Activity | `services3.arcgis.com/.../FeatureServer` | `fire-activity` | None | 11.8K | Active fires |
| 9 | Climate Indices | `psl.noaa.gov/data/correlation/` | `climate-index` | None | 4.6K | AO/NAO/PNA/PDO/ENSO, 1950-present |
| 10 | USDA Crop Progress | `quickstats.nass.usda.gov/api/api_GET` | `crop-progress` | NASS_API_KEY | 17.8K | 33 states, 5 crops |
| 11 | USDA CropScape | `quickstats.nass.usda.gov/api/api_GET` | `crop-data` | NASS_API_KEY | 10.7K | County-level acreage |
| 12 | Weather History | `archive-api.open-meteo.com/` | `hunt_weather_history` table | None | 45K+ | 5-year archive |
| 13 | USFWS Breeding Survey | Manual data entry | `usfws-breeding-survey` | None | — | WBPHS population estimates |

## BUILT & RUNNING NOW

| # | Source | API Endpoint | Content Type | Auth | Rate Limit | Status |
|---|--------|-------------|--------------|------|------------|--------|
| 14 | eBird History | `api.ebird.org/v2` | `hunt_migration_history` table | EBIRD_API_KEY | 200 req/hr | CT, ~45hr remaining |
| 15 | Snow Cover | `ncei.noaa.gov/access/monitoring/daily-snow/` | `snow-cover-monthly` | None | 300ms delay | 2K+ entries, finishing soon |

## BUILT & RUNNING (LIVE CRONS)

| # | Function | API / Source | Content Type | Schedule |
|---|----------|-------------|--------------|----------|
| 16 | `hunt-weather-watchdog` | `open-meteo.com` | `weather-forecast-event` | Daily 6am UTC (2x25 states) |
| 17 | `hunt-weather-realtime` | `aviationweather.gov/api/data/metar` | `weather-realtime-event` | Every 15 min (130 stations) |
| 18 | `hunt-migration-monitor` | `ebird.org/ws/data/obs/geo_recent/` | `migration-spike-alert` | Daily 7:00-7:20 UTC |
| 19 | `hunt-birdcast` | `birdcast.info` (HTML parse) | `birdcast-migration-intensity` | Daily 10am UTC |
| 20 | `hunt-nasa-power` | `power.larc.nasa.gov/api/temporal/daily/point` | `nasa-power-satellite` | Daily 6:30 UTC (2x25) |
| 21 | `hunt-nws-monitor` | `api.weather.gov/alerts/active` | `nws-severe-alert` | Every 3hr |
| 22 | `hunt-du-map` | `webapi.ducks.org/migrationmap` | `du-migration-report` | Weekly Mon 12pm UTC |
| 23 | `hunt-du-alerts` | DU website scrape | `du-migration-alert` | Weekly Mon 6am UTC |
| 24 | `hunt-convergence-engine` | Internal (multi-source) | `convergence-score-daily` | Daily 8am UTC |
| 25 | `hunt-solunar-precompute` | Pure math | `solunar-calendar-yearly` | Weekly Sun 6am UTC |
| 26 | `hunt-power-outage` | `ornl.opendatasoft.com/api/` (ODIN) | `power-outage` | On demand |
| 27 | `hunt-extract-patterns` | Claude Sonnet API | `pattern-discovery` | Manual |
| 28 | `hunt-log` | User actions | `user-interaction-log` | On demand |
| 29 | `hunt-forecast-tracker` | Internal | forecast grading | Daily 10am UTC |
| 30 | `hunt-migration-report-card` | Internal | prediction grading | Daily 11am UTC |
| 31 | `hunt-convergence-report-card` | Internal | model performance | Weekly Sun noon UTC |

## BUILT BUT PARTIAL / BLOCKED

| # | Source | Script | Content Type | Issue | Entries |
|---|--------|--------|--------------|-------|---------|
| 32 | NOAA ACIS | `backfill-noaa-acis.ts` | `climate-normal` | Partial run, 800 entries. Resume from last state. | 800 |
| 33 | Historical News | `backfill-historical-news.ts` | `historical-newspaper` | LOC IP ban (triggered 2026-03-19). 3s+ between requests. | Blocked |
| 34 | eBird Hotspots | `backfill-ebird-hotspots.ts` | `ebird-hotspot` | Not started | 0 |

## EDGE FUNCTIONS BUILT — STATUS UNKNOWN

These exist in `supabase/functions/` but may be stubs. Check before scheduling.

| # | Function | What It Should Do | Check |
|---|----------|-------------------|-------|
| 35 | `hunt-phenology` | NPN first frost/green-up dates | Verify it calls usanpn.org |
| 36 | `hunt-movebank` | Wildlife GPS tracking | May need Movebank account |
| 37 | `hunt-snotel` | Soil temp from NRCS stations | Verify endpoint works |
| 38 | `hunt-disaster-watch` | Multi-source disaster monitoring | May be analysis not ingest |
| 39 | `hunt-search-trends` | Google Trends proxy signals | Check if functional |
| 40 | `hunt-query-signal` | User query pattern analysis | Check if functional |

---

## PLANNED — TIER 1: Game Changers

| # | Source | API Endpoint | Why It Matters | Auth | Est. Entries |
|---|--------|-------------|----------------|------|-------------|
| 41 | **NDWI Water Extent** | `appeears.earthdatacloud.nasa.gov/api/` (Landsat) | Where water APPEARED or disappeared on the landscape. The waterfowl holy grail. Satellite-derived surface water change detection. | NASA Earthdata (free) | 50-200K |
| 42 | **NPN First Frost / Green-up** | `data.usanpn.org/npn_portal/observations/` | Phenological clock. First frost = migration gun. Green-up = turkey season. 45 years of biological timing data. | None | ~100K |
| 43 | **CPC Soil Moisture Anomalies** | `cpc.ncep.noaa.gov/products/soilmoist/` (gridded) | Bridge between "it rained" and "there are ducks." Invisible water variable. Since 1948. | None | ~400K |
| 44 | **USGS Bird Banding (BBL)** | `sciencebase.gov/catalog/item/632b2d7bd34e71c6d67bc161` (bulk) | Actual origin → destination migration routes. The only source showing where a bird CAME FROM and where it ENDED UP. Ground truth. | None (bulk download) | ~1M |

## PLANNED — TIER 2: Major Fills

| # | Source | API Endpoint | Why It Matters | Auth | Est. Entries |
|---|--------|-------------|----------------|------|-------------|
| 45 | **NOAA Storm Events** | `ncdc.noaa.gov/stormevents/ftp.jsp` (bulk CSV) | 75 years of environmental cause → effect records. What happened after weather patterns. Retrospective complement to live NWS alerts. | None | ~300K |
| 46 | **USGS Earthquake Catalog** | `earthquake.usgs.gov/fdsnws/event/1/query` | Seismic gap in disaster thesis. Animals detect foreshocks. Free REST API, JSON, back to 1900. | None | ~50K (NA M3.0+) |
| 47 | **USDA FIA Mast Production** | `apps.fs.usda.gov/fia/datamart/` (bulk CSV) | #1 deer/turkey signal. Mast (acorn/beechnut/hickory) drives EVERYTHING for those species. Brain has zero mast data. | None | ~50K |
| 48 | **EPA Air Quality (PM2.5)** | `aqs.epa.gov/data/api/dailyData/byState` | Smoke redirects migration. Disaster co-signal. 4,000 stations nationwide. | EPA AQS key (free, email reg) | ~500K |

## PLANNED — TIER 3: Deep Signals

| # | Source | API Endpoint | Why It Matters | Auth | Est. Entries |
|---|--------|-------------|----------------|------|-------------|
| 49 | **NSIDC Lake Ice Phenology** | `nsidc.org/data/g01377/versions/1` (bulk) | Ice-off = ducks arrive within 48 hours. 800 lakes, 100+ years. Tightest predictor in waterfowl ornithology. | NASA Earthdata | ~80K |
| 50 | **NIFC Fire Perimeters** | `data-nifc.opendata.arcgis.com/` (ArcGIS) | Historical burn boundaries. Habitat succession mapping. 40 years of fire perimeters. May overlap existing NIFC active fires. | None | ~100K |
| 51 | **FAA Wildlife Strikes** | `wildlife.faa.gov/` (bulk CSV) | Involuntary 24/7 bird census from 500+ airports. Species, altitude, date, conditions. 300K+ records since 1990. | None | ~300K |
| 52 | **NOAA SST Anomalies** | `psl.noaa.gov/data/gridded/data.noaa.oisst.v2.highres.html` | Gulf sea surface temps drive flyway moisture. Hurricane prediction signal. | None | ~40K |
| 53 | **USGS Water Quality (NAWQA)** | `waterqualitydata.us/` (WQP API) | Nutrients drive food chain. Phosphorus/nitrogen = aquatic vegetation = waterfowl food. Hidden variable. | None | ~200K |
| 54 | **Geomagnetic Kp Index** | `services.swpc.noaa.gov/products/noaa-planetary-k-index.json` | Bird navigation uses Earth's magnetic field. Kp storms = disorientation = grounding events. Since 1932. | None | ~34K |
| 55 | **CDC WNV Surveillance** | `cdc.gov/west-nile-virus/data-maps/` (annual CSV) | Proxy for wetland mosquito conditions and predator dynamics. County-level since 1999. | None | ~50K |
| 56 | **NOAA Great Lakes Ice (GLERL)** | `glerl.noaa.gov/data/ice/` | Daily ice cover since 1973 + 3-day forecasts. Critical for Great Lakes flyway states. | None | ~30K |
| 57 | **NOAA CPC Temp Outlooks** | `cpc.ncep.noaa.gov/products/predictions/` | 6-10 day and 8-14 day temperature probability outlooks. Forward-looking signal. | None | ~10K |
| 58 | **NASA NDVI (MODIS)** | `modis.ornl.gov/rst/api/v1/` | Vegetation health index. Where food/habitat is growing vs stressed. Clean REST API. | None | ~300K |
| 59 | **NOAA SNODAS** | `nsidc.org/data/g02158` (daily gridded) | Daily 1km snow depth + snow water equivalent. Melt timing predicts spring conditions. | NASA Earthdata | ~100K |

## PLANNED — TIER 4: Bonus Sources

| # | Source | API Endpoint | Why It Matters | Auth | Est. Entries |
|---|--------|-------------|----------------|------|-------------|
| 60 | **NASS QuickStats Expanded** | `quickstats.nass.usda.gov/api/api_GET` | Already have key. Expand beyond crops: planting dates, yield, livestock numbers. | NASS_API_KEY | ~100K |
| 61 | **Insect Emergence (AgWeather)** | `agweather.cals.wisc.edu/api` | Degree-day pest models. Insect emergence triggers biological chain reactions. | None | ~50K |
| 62 | **NatureServe Explorer** | `explorer.natureserve.org/api-docs/` | Species-habitat affinity data. Background knowledge for smarter brain search. | API key (free reg) | ~20K |
| 63 | **Copernicus ERA5** | `cds.climate.copernicus.eu/api/v2` | Global reanalysis climate data. Hourly back to 1940. Fills gaps in US-only coverage. | CDS key (free reg) | ~500K |
| 64 | **USGS National Water Dashboard** | `dashboard.waterdata.usgs.gov/api/` | Real-time flood/drought alerting layer on existing USGS water data. | None | Supplement |

---

## API KEYS NEEDED FOR PLANNED SOURCES

| API | Registration | Cost | Unlocks |
|-----|-------------|------|---------|
| **NASA Earthdata** | `urs.earthdata.nasa.gov/users/new` | Free | NDWI, NDVI, NSIDC lake ice, SNODAS (3 sources, 1 login) |
| **EPA AQS** | `aqs.epa.gov/aqsweb/documents/data_api.html` | Free | PM2.5 air quality |
| **NatureServe** | `explorer.natureserve.org/api-docs/` | Free | Species-habitat data |
| **Copernicus CDS** | `cds.climate.copernicus.eu/user/register` | Free | ERA5 reanalysis |

Keys already in hand that cover more: NASS_API_KEY (QuickStats), EBIRD_API_KEY (all eBird endpoints).

---

## BACKFILL SEQUENCE (after current pipes finish)

| Order | Source | Script | Est. Time | Est. Entries |
|-------|--------|--------|-----------|-------------|
| 1 | NOAA Storm Events | `backfill-storm-events.ts` (new) | 1-2 days | ~300K |
| 2 | USGS Earthquakes | `backfill-earthquakes.ts` (new) | 1 day | ~50K |
| 3 | CPC Soil Moisture | `backfill-soil-moisture.ts` (new) | 1-2 days | ~400K |
| 4 | USGS Bird Banding | `backfill-bird-banding.ts` (new) | 2-3 days | ~1M |
| 5 | NPN Phenology | activate `hunt-phenology` + backfill | 1 day | ~100K |
| 6 | NDWI Water Extent | `backfill-ndwi.ts` (new) | 2-3 days | ~200K |
| 7 | EPA PM2.5 | `backfill-air-quality.ts` (new) | 2 days | ~500K |
| 8 | FAA Wildlife Strikes | `backfill-wildlife-strikes.ts` (new) | 1 day | ~300K |
| 9 | FIA Mast Data | `backfill-mast.ts` (new) | 0.5 day | ~50K |
| 10 | NSIDC Lake Ice | `backfill-lake-ice.ts` (new) | 1 day | ~80K |
| 11 | NASA NDVI | `backfill-ndvi.ts` (new) | 2 days | ~200K |
| 12 | NOAA SST | `backfill-sst.ts` (new) | 1 day | ~40K |
| 13 | Geomagnetic Kp | `backfill-kp-index.ts` (new) | 0.5 day | ~34K |
| 14 | GLERL Great Lakes Ice | `backfill-glerl-ice.ts` (new) | 0.5 day | ~30K |
| 15 | SNODAS Snow | expand `backfill-snow-cover.ts` | 1 day | ~100K |

**Total new: ~3.4M entries**
**Brain after completion: ~3.7M from 55+ sources**

---

## RULES

- **One heavy pipe at a time.** Supabase Pro IO budget. Exception: slow pipes (eBird @ 200 req/hr) can run alongside faster ones.
- **THE EMBEDDING LAW.** No data enters without a Voyage AI 512-dim vector. No exceptions.
- **Pin supabase-js@2.84.0.** Unpinned @2 crashes Deno isolates.
- **Never retry 4xx.** Only 5xx and network errors.
- **Max 20 per embed batch.** Voyage times out above 20.
- **3s+ between LOC requests.** They IP ban aggressively.
- **Every backfill script must support resume** via env vars (START_STATE, START_YEAR, etc.).
- **Add to orchestrator** when building new pipes. Update PIPES array in `scripts/orchestrator.ts`.

## INFRASTRUCTURE

| Component | Details |
|-----------|---------|
| Embedding | Voyage AI `voyage-3-lite` 512-dim. Max 20/batch. Edge fn fallback: `hunt-generate-embedding` |
| Vector DB | Supabase pgvector, IVFFlat index on `hunt_knowledge.embedding` |
| Orchestrator | `scripts/orchestrator.ts` — sequential pipe runner with checkpoint resume |
| Cron Logging | All crons → `hunt_cron_log` via `logCronRun`. Health at `hunt-cron-health` |
| Daily Indices | launchd `com.duckcountdown.daily-indices` at 7am daily |

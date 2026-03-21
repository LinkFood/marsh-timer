# Backfill API Master List — Every Free API You Need

**Date:** 2026-03-20
**Brain status:** 486K entries, 21 sources live
**Goal:** 3M+ entries from 40+ sources

---

## ALREADY RUNNING / DONE (You Have These)

These are live crons or completed backfills. Don't rebuild — just verify they're healthy.

| # | Source | API Endpoint | Auth | Status | Entries |
|---|--------|-------------|------|--------|---------|
| 1 | eBird | `https://api.ebird.org/v2/data/obs` | EBIRD_API_KEY | Live cron + backfill running | 40K+ |
| 2 | Open-Meteo | `https://api.open-meteo.com/v1/forecast` | None | Live cron (2x daily) | 45K+ |
| 3 | ASOS/METAR | `https://aviationweather.gov/api/data/metar` | None | Live cron (every 15 min) | Continuous |
| 4 | NASA POWER | `https://power.larc.nasa.gov/api/temporal/daily/point` | None | Live cron (daily) | 50K+ |
| 5 | NWS Alerts | `https://api.weather.gov/alerts/active` | None | Live cron (every 3hr) | Continuous |
| 6 | BirdCast | (scraped from birdcast.info) | None | Live cron (daily) | 18K+ |
| 7 | DU Migration | `https://www.ducks.org/.../api.json` | None | Live cron (weekly) | 2K+ |
| 8 | US Drought Monitor | `https://usdmdataservices.unl.edu/api/StateStatistics` | None | Done | 8,400 |
| 9 | iNaturalist | `https://api.inaturalist.org/v1/observations` | None | Done | 4,050 |
| 10 | GBIF | `https://api.gbif.org/v1/occurrence/search` | None | Done | 6,880 |
| 11 | BirdWeather | `https://app.birdweather.com/api/v1/stations` | None | Done | 10,807 |
| 12 | NIFC Fires | `https://services3.arcgis.com/.../query` | None | Done | 11,767 |
| 13 | Climate Indices | `https://psl.noaa.gov/data/correlation/...` | None | Done | 4,594 |
| 14 | Photoperiod | Calculated locally | None | Done | 35,077 |
| 15 | USDA Crop Progress | `https://quickstats.nass.usda.gov/api/api_GET` | NASS_API_KEY | Backfill running | 17,824 |
| 16 | USGS Water | `https://waterservices.usgs.gov/nwis/iv/` | None | Backfill running | 74K+ |
| 17 | NOAA Tides | `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` | None | Backfill running | 28.6K |
| 18 | NOAA ACIS | `https://data.rcc-acis.org/StnData` | None | Backfill running | 800+ |
| 19 | Snow Cover | `https://nohrsc.noaa.gov/snow_model/GIS/...` | None | Backfill queued | Pending |
| 20 | ODIN Power Outage | `https://ornl.opendatasoft.com/api/...` | None | Edge fn built | On demand |
| 21 | USFWS Surveys | (Python ingest scripts) | None | Edge fn built | On demand |

---

## EDGE FUNCTIONS BUILT BUT NOT ACTIVE (Activate These)

You already wrote the code for these. Check if they work, fix if needed, schedule as crons.

| # | Source | Edge Function | What It Does | Needs |
|---|--------|-------------- |-------------|-------|
| 22 | NPN Phenology | `hunt-phenology` | First frost, green-up, leaf-out dates | Verify it calls usanpn.org API, schedule as weekly cron |
| 23 | Movebank GPS | `hunt-movebank` | Animal GPS tracking data | Verify API access, may need Movebank account |
| 24 | SNOTEL Soil Temp | `hunt-snotel` | Soil temperature from NRCS stations | Verify endpoint, schedule as daily cron |
| 25 | Historical News | `hunt-historical-news` | Past event context | Check if functional |
| 26 | Disaster Watch | `hunt-disaster-watch` | Multi-source disaster monitoring | Check if functional |
| 27 | Anomaly Detector | `hunt-anomaly-detector` | Cross-source anomaly detection | Check — this may be an analysis fn, not ingest |
| 28 | Correlation Engine | `hunt-correlation-engine` | Cross-dataset correlation finding | Check — likely analysis fn |
| 29 | Search Trends | `hunt-search-trends` | Google Trends proxy signals | Check if functional |
| 30 | Query Signal | `hunt-query-signal` | User query pattern analysis | Check if functional |

**Action:** Open each of these edge functions, see if the code is complete or a stub, and activate the ones that are ready. This is free velocity — the ingest → embed → store pipeline is already wired.

---

## NEW APIs TO BUILD (Your V6 List + Additions)

### TIER 1 — Highest environmental signal value. Build first.

| # | Source | API Endpoint | Auth | Free? | Est. Entries | What to Build |
|---|--------|-------------|------|-------|-------------|---------------|
| 31 | **NDWI Water Extent** | `https://appeears.earthdatacloud.nasa.gov/api/` | NASA Earthdata login (free) | Yes | ~200K | New backfill script. AppEEARS API gives Landsat-derived water index. Shows where water appeared/disappeared on the landscape. |
| 32 | **NPN First Frost / Green-up** | `https://www.usanpn.org/npn_portal/observations/getObservations.json` | None | Yes | ~100K | You may already have `hunt-phenology`. If not, new backfill. 45 years of phenological data — when biological systems shift timing. |
| 33 | **CPC Soil Moisture** | `https://www.cpc.ncep.noaa.gov/soilmst/w.shtml` (FTP/gridded) | None | Yes | ~400K | New backfill script. Parse CPC monthly gridded soil moisture anomalies since 1948. Determines whether rain becomes flood or gets absorbed. |
| 34 | **NOAA Storm Events** | `https://www.ncdc.noaa.gov/stormevents/ftp.jsp` (bulk CSV) | None | Yes | ~300K | New backfill script. 75 years of environmental cause → effect records. What happened after weather patterns. Tornado, flood, hail, wind outcomes. |
| 35 | **USGS Bird Banding** | `https://www.sciencebase.gov/catalog/item/632b2d7bd34e71c6d67bc161` (bulk download) | None | Yes | ~1M | New backfill script. Origin-to-destination movement records. Biological sensors documenting where they went and when. |

### TIER 2 — Major fills. Build after Tier 1.

| # | Source | API Endpoint | Auth | Free? | Est. Entries | What to Build |
|---|--------|-------------|------|-------|-------------|---------------|
| 36 | **USGS Earthquake Catalog** | `https://earthquake.usgs.gov/fdsnws/event/1/query` | None | Yes | ~500K | New backfill script. REST API, returns JSON. Mag 2.5+ since 1900. Seismic precursor signals. |
| 37 | **USDA FIA Mast Data** | `https://apps.fs.usda.gov/fia/datamart/CSV/datamart_csv.html` (bulk CSV) | None | Yes | ~50K | New backfill script. Download CSVs, parse mast production (acorn, beechnut, hickory). Updates every 5-10 years. One-time backfill. |
| 38 | **EPA Air Quality PM2.5** | `https://aqs.epa.gov/data/api/dailyData/byState` | EPA AQS key (free, email reg) | Yes | ~500K | New backfill script. Register at https://aqs.epa.gov/aqsweb/documents/data_api.html. Smoke and particulate data from 4,000 stations. |
| 39 | **NSIDC Lake Ice Phenology** | `https://nsidc.org/data/g01377/versions/1` (bulk download) | NASA Earthdata login | Yes | ~80K | New backfill script. 800 lakes, 100+ years. Ice-on/ice-off dates — when surface water transitions state. |
| 40 | **NOAA SST Anomalies** | `https://psl.noaa.gov/data/gridded/data.noaa.oisst.v2.highres.html` (NetCDF) | None | Yes | ~40K | New backfill script. Sea surface temperature anomalies. Gulf temps drive continental moisture patterns. |
| 41 | **FAA Wildlife Strikes** | `https://wildlife.faa.gov/search` (bulk download CSV) | None | Yes | ~300K | New backfill script. 300K records from 500+ airports. Species, altitude, conditions. Continuous biological monitoring. |
| 42 | **NOAA SNODAS** | `https://nsidc.org/data/g02158` (daily gridded) | NASA Earthdata login | Yes | ~100K | New backfill script. Daily 1km snow depth + snow water equivalent. Melt timing predicts spring conditions. You already have `backfill-snow-cover.ts` — check if this is SNODAS or something else. |
| 43 | **NASA NDVI** | `https://appeears.earthdatacloud.nasa.gov/api/` | NASA Earthdata login | Yes | ~200K | New backfill script. Vegetation health index. Where food/habitat is growing vs stressed. Same API as NDWI (#31). |

### TIER 3 — Deep signals. Build when bandwidth allows.

| # | Source | API Endpoint | Auth | Free? | Est. Entries | What to Build |
|---|--------|-------------|------|-------|-------------|---------------|
| 44 | **Geomagnetic Kp Index** | `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json` | None | Yes | ~20K | Simple backfill. Real-time JSON endpoint. Magnetic storm intensity — biological disorientation signal. |
| 45 | **USGS Water Quality** | `https://www.waterqualitydata.us/data/Result/search` | None | Yes | ~200K | New backfill. Water Quality Portal REST API. Nutrients, contaminants, pH — ecosystem health indicators. |
| 46 | **CDC West Nile** | `https://www.cdc.gov/west-nile-virus/data-maps/` (annual CSV) | None | Yes | ~10K | Small backfill. Annual county-level surveillance. Proxy for wetland/mosquito conditions. |
| 47 | **NIFC Fire Perimeters** | `https://data-nifc.opendata.arcgis.com/` (ArcGIS REST) | None | Yes | ~50K | Check if your existing NIFC data (11K entries) includes perimeters or just active fires. If just active, add perimeters for habitat succession mapping. |
| 48 | **NOAA Great Lakes Ice (GLERL)** | `https://www.glerl.noaa.gov/data/ice/` | None | Yes | ~30K | New backfill. Daily ice cover since 1973 + 3-day forecasts. Already listed in your CLAUDE.md as "ready to build." |
| 49 | **NOAA CPC Temperature Outlooks** | `https://www.cpc.ncep.noaa.gov/products/predictions/...` | None | Yes | ~10K | New cron. 6-10 day and 8-14 day temperature probability outlooks. Forward-looking signal. |

### TIER 4 — Sources I found that aren't on your lists.

| # | Source | API Endpoint | Auth | Free? | Est. Entries | Why It Matters |
|---|--------|-------------|------|-------|-------------|----------------|
| 50 | **NASA NDVI/EVI (MODIS)** | `https://modis.ornl.gov/rst/api/v1/` | None | Yes | ~300K | Daily vegetation indices at 250m. ORNL DAAC has a clean REST API. Faster coverage than AppEEARS. |
| 51 | **NASS QuickStats** | `https://quickstats.nass.usda.gov/api/api_GET` | NASS_API_KEY (you have this) | Yes | ~100K | You already have the key and a crop script. But QuickStats goes deeper — county-level planting dates, yield, livestock numbers. Expand the existing pipe. |
| 52 | **Insect Emergence (AgWeather)** | `https://agweather.cals.wisc.edu/api` | None | Yes | ~50K | Degree-day pest models. When insects emerge, it triggers biological chain reactions across ecosystems. |
| 53 | **NatureServe Explorer** | `https://explorer.natureserve.org/api-docs/` | API key (free registration) | Yes | ~20K | Species-habitat affinity data. Background knowledge that makes brain search smarter — what conditions organisms prefer. |
| 54 | **Copernicus CDS (ERA5)** | `https://cds.climate.copernicus.eu/api/v2` | CDS API key (free registration) | Yes | ~500K | Global reanalysis climate data. Fills gaps in US-only coverage. Hourly data back to 1940. |
| 55 | **USGS National Water Dashboard** | `https://dashboard.waterdata.usgs.gov/api/` | None | Yes | Supplement | Real-time flood/drought alerting layer on top of your existing USGS water data. |

---

## API KEYS YOU NEED TO GET

Most of these sources are free with no auth. Here are the ones that need registration:

| API | Registration URL | Cost | What You Get |
|-----|-----------------|------|-------------|
| **NASA Earthdata** | https://urs.earthdata.nasa.gov/users/new | Free | Access to AppEEARS (NDWI, NDVI), NSIDC (lake ice, SNODAS), MODIS |
| **EPA AQS** | https://aqs.epa.gov/aqsweb/documents/data_api.html | Free | Email-based key for PM2.5 air quality data |
| **NatureServe** | https://explorer.natureserve.org/api-docs/ | Free | Species-habitat data |
| **Copernicus CDS** | https://cds.climate.copernicus.eu/user/register | Free | ERA5 reanalysis, seasonal forecasts |
| **Movebank** | https://www.movebank.org/cms/movebank-main | Free | Animal GPS tracking (check if hunt-movebank already has creds) |

**Keys you already have that cover more than you're using:**
- `NASS_API_KEY` — covers QuickStats (expand beyond just crop progress)
- `EBIRD_API_KEY` — covers all eBird endpoints
- NASA Earthdata login — one account covers AppEEARS, NSIDC, MODIS, POWER

---

## BACKFILL SEQUENCE (One Pipe At A Time)

**Let current orchestrator queue finish first**, then:

| Order | Source | Script to Build/Use | Est. Time | Est. Entries |
|-------|--------|-------------------|-----------|-------------|
| 1 | NDWI Water Extent | `backfill-ndwi.ts` (new) | 2-3 days | ~200K |
| 2 | NOAA Storm Events | `backfill-storm-events.ts` (new) | 1-2 days | ~300K |
| 3 | CPC Soil Moisture | `backfill-soil-moisture.ts` (new) | 1-2 days | ~400K |
| 4 | USGS Bird Banding | `backfill-bird-banding.ts` (new) | 2-3 days | ~1M |
| 5 | NPN Phenology | Activate `hunt-phenology` + backfill | 1 day | ~100K |
| 6 | USGS Earthquakes | `backfill-earthquakes.ts` (new) | 1 day | ~500K |
| 7 | EPA PM2.5 | `backfill-air-quality.ts` (new) | 2 days | ~500K |
| 8 | FAA Wildlife Strikes | `backfill-wildlife-strikes.ts` (new) | 1 day | ~300K |
| 9 | NOAA SST | `backfill-sst.ts` (new) | 1 day | ~40K |
| 10 | NSIDC Lake Ice | `backfill-lake-ice.ts` (new) | 1 day | ~80K |
| 11 | USDA FIA Mast | `backfill-mast.ts` (new) | half day | ~50K |
| 12 | NASA NDVI | `backfill-ndvi.ts` (new) | 2 days | ~200K |
| 13 | Geomagnetic Kp | `backfill-kp-index.ts` (new) | half day | ~20K |
| 14 | GLERL Great Lakes Ice | `backfill-glerl-ice.ts` (new) | half day | ~30K |
| 15 | SNODAS Snow | Expand existing `backfill-snow-cover.ts` | 1 day | ~100K |

**Total new entries: ~3.8M**
**Brain after completion: ~4.3M entries from 40+ sources**

---

## AFTER BACKFILL — NEW CRONS TO SCHEDULE

Once backfilled, these need recurring crons to stay current:

| Source | Frequency | Edge Function |
|--------|-----------|--------------|
| NDWI Water Extent | Weekly | New: `hunt-ndwi` |
| NPN Phenology | Weekly (spring/fall) | Existing: `hunt-phenology` |
| CPC Soil Moisture | Monthly | New: `hunt-soil-moisture` |
| NOAA Storm Events | Monthly | New: `hunt-storm-events` |
| EPA PM2.5 | Daily | New: `hunt-air-quality` |
| NOAA SST | Weekly | New: `hunt-sst` |
| Geomagnetic Kp | Daily | New: `hunt-kp-index` |
| GLERL Ice | Daily (winter) | New: `hunt-glerl-ice` |
| CPC Temp Outlooks | Twice weekly | New: `hunt-temp-outlook` |
| USGS Earthquakes | Daily | New: `hunt-earthquakes` |
| FAA Wildlife Strikes | Monthly | New: `hunt-wildlife-strikes` |

---

## NOTES

- Every source follows the embedding law: ingest → Voyage AI 512-dim → hunt_knowledge → query-on-write brain scan
- Every backfill script must use `logCronRun` on all exit paths
- Never run 2 pipes simultaneously (Supabase Pro IO constraint)
- Pin supabase-js to @2.84.0 in all edge functions
- Check `backfill-snow-cover.ts` — it may already be SNODAS, which would remove #15 from the build list
- Check `hunt-phenology` — if it's functional, NPN backfill is just activating an existing edge function
- NASA Earthdata login is one registration that unlocks 3 sources (NDWI, NDVI, lake ice)

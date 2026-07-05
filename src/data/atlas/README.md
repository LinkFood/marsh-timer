# Atlas static lookup tables

Frontend-only, zero-database reference constants used to place dots on the
Atlas map. Nothing here is read from or written to the 8M-row archive — these
are well-known geographic constants, safe to ship as static assets.

## Shipped

### `stateCentroids.ts`
Approximate geographic center `[lng, lat]` for all 50 US states. Used **now**
to plot state-level weather-anomaly dots. Coordinates are in GeoJSON /
MapLibre order (longitude first).

### `usStates.geojson.ts`
Simplified polygons for all 50 states + DC (51 features), each with
`properties.state` = 2-letter USPS abbr. The **default drill level (1)** for
the nested-box map: fill each state box by its current activity, click to drill
in. Public-domain TIGER-lineage boundaries, coords rounded to ~2 decimals.

**Next asset:** counties GeoJSON (US Census TIGER, drill level 2) — the boxes
inside the state boxes.

## Next additions (planned, not yet built)

Per the scout, point-resolved weather / buoy / tide dots need coordinate
lookup tables so each reading can be placed at its true location instead of a
state centroid. These are external, well-defined public reference tables — to
be added as vetted static assets (or fetched once and cached), **never** by
touching the archive DB.

| Table | What it resolves | Source |
|-------|------------------|--------|
| County-FIPS centroids | County-level readings (drought, USDM, etc.) | US Census TIGER / Gazetteer county centroids — https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html |
| ASOS / ICAO station coords | Airport weather-station point dots | OurAirports (https://ourairports.com/data/) and NOAA/NWS ASOS metadata (https://www.ncei.noaa.gov/) |
| NDBC buoy stations | Ocean buoy point dots (SST, waves) | NOAA NDBC station table — https://www.ndbc.noaa.gov/data/stations/station_table.txt |
| CO-OPS tide stations | Coastal tide/water-level point dots | NOAA CO-OPS metadata API — https://api.tidesandcurrents.noaa.gov/mdapi/prod/ |

### Rules for these tables
- Do **not** fabricate large station tables. Pull from the source URLs above,
  verify, then commit as a static asset. Until then, only `stateCentroids.ts`
  is trusted for placement.
- Keep coordinates `[lng, lat]` (GeoJSON order) for consistency with
  `stateCentroids.ts` and MapLibre.
- Everything here stays read-only relative to the archive DB.

---
name: Agriculture & Nature Data Pipe Designs (7 Pipes + 8 Ideas)
description: Complete pipe designs for agricultural/botanical data. 7 pipes covering NASS crop progress (deep historical 1997-2025), NASS production/yields (1950+), NASS livestock inventory, NPN historical phenology (1956+), NOAA divisional PDSI (1895+), commodity prices (FRED+NASS), Journey North phenological timing. Plus 8 synthesis ideas (Agricultural Calendar fingerprints, Phenological Wavefront tracking, GDD accumulation, Crop-Wildlife Collision Calendar, Farm Economy Indicator, Harvest Progress Timer, Cross-Pollination architecture, Census of Agriculture). Estimated ~2.5-3.5M new entries total. Priority order: PDSI first (Dust Bowl visibility), then crop progress deep backfill, then commodity prices, then production/yields, then NPN historical, then livestock, then Journey North. Generated 2026-04-03.
type: project
---

## What Already Exists
- hunt-crop-progress: Weekly crop progress, 4 crops, 19 flyway states, current year only
- backfill-crop-progress: 5 crops, 33 states, 2023-2025 only
- backfill-usda-crops: County-level AREA HARVESTED, 6 crops, 2019-2025
- hunt-drought-monitor: Weekly D0-D4, 50 states, current
- backfill-drought-monitor: 3 years weekly drought
- hunt-phenology: NPN 6 indicator species, last 30 days only
- hunt-soil-monitor: Open-Meteo soil temp/moisture, 50 states
- climate-indices: AO/NAO/PNA/ENSO/PDO, 76 years

## Critical Gaps Identified
- Crop progress only goes back to 2023 (NASS has data to 1997)
- Crop acreage only to 2019 (NASS has production/yield data to 1950)
- Phenology is live-only, no historical depth (NPN has 1956+ records)
- ZERO commodity prices
- ZERO agricultural production data (bushels, yields)
- ZERO livestock inventory data
- Dust Bowl era invisible (need PDSI to 1895)
- No crop CONDITION ratings (good/excellent vs poor/very poor)

## 7 Pipes Designed (see full conversation for API details)
1. NASS Deep Historical Crop Progress (1997-2025, 800K-1.2M entries)
2. NASS Production & Yields (1950-2025, ~500K entries)
3. NASS Livestock Inventory (1950-2025, ~30K entries)
4. NPN Historical Phenology Bulk (1956-2025, 200K-500K entries)
5. NOAA Divisional PDSI (1895-2025, ~78K-536K entries) -- THE DUST BOWL PIPE
6. CME Commodity Prices via FRED + NASS (1926-2025, ~370K entries)
7. Journey North Phenological Timing (1997-2025, ~50K entries)

## Priority Order
1. PDSI (if not already in brain as climate index)
2. Crop Progress deep backfill (extend existing code from 3 years to 28)
3. Commodity Prices (FRED + NASS price received)
4. Production & Yields
5. NPN Historical Phenology
6. Livestock Inventory
7. Journey North

## Key Gotcha: NASS API Key
Already hardcoded in hunt-crop-progress/index.ts line 9. Should be in Vault.

## 8 Synthesis Ideas
1. Agricultural Calendar Fingerprints (one entry per state-year telling full season story)
2. Phenological Wavefront Tracking (bloom wave velocity as signal)
3. Growing Degree Day Accumulation content type
4. Crop-Wildlife Collision Calendar (harvest date = movement trigger)
5. Farm Economy Indicator (price x yield x acreage composite index)
6. Harvest Progress as Real-Time Timer
7. Cross-Pollinate Drought x Crops x Price (scanBrainOnWrite connections)
8. USDA Census of Agriculture (county-level every 5 years since 1840)

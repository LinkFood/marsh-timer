---
name: Health/Disease Data Pipes Design (6 Sources)
description: Full pipe designs for embedding historical health/disease/epidemic data into the brain. 6 sources: Project Tycho (1888-2013, 2.5M entries), CDC FluView via Delphi (1997-present, 85K), NNDSS via data.cdc.gov SODA API (2014-present, 800K), JHU COVID archive (2020-2023, 64K), Delphi COVIDcast sensor fusion (2020-present, 600K), WHO Disease Outbreak News (1996-present, 3.5K). Total: 2.3-4M new entries. Doubles the brain. Each pipe has exact API endpoints, auth, rate limits, fields, example narratives, scale estimates, and gotchas. Build order: Tycho -> COVID JHU -> FluView -> NNDSS -> COVIDcast -> WHO. New content type group: 'health' with 6 content types. Generated 2026-04-03.
type: project
---

## 6 Health/Disease Data Pipes

### Pipe 1: Project Tycho (THE MOTHERLODE)
- **API:** `https://www.tycho.pitt.edu/api/query?apikey=KEY` — CSV, 20K row max, paginate with offset
- **Auth:** Free API key (register at tycho.pitt.edu). Add TYCHO_API_KEY to Vault.
- **Data:** 1888-2013, weekly case counts by state, 58 diseases / 92 conditions
- **Key diseases:** influenza, measles, polio, smallpox, TB, diphtheria, whooping cough, scarlet fever, typhoid, pneumonia, hepatitis, mumps, rubella, chickenpox, malaria, plague, cholera
- **Content type:** `disease-weekly`
- **Scale:** 1.5-2.5M entries (DOUBLES the brain alone)
- **Gotchas:** Rate limits undocumented (add delays), data ends 2013, some city-level needs aggregation, fatality data spotty, MASSIVE backfill (split by disease)

### Pipe 2: CDC FluView via Delphi Epidata
- **API:** `https://api.delphi.cmu.edu/epidata/fluview/` — JSON, register for unlimited key
- **Data:** 1997-present, weekly ILI rates by state, weighted + unweighted %
- **Content type:** `flu-surveillance-weekly`
- **Scale:** ~85K entries
- **Gotchas:** Epiweek format YYYYWW (not date), anonymous rate limited, state coverage improves over time, Delphi is research project (no SLA)

### Pipe 3: CDC NNDSS via data.cdc.gov SODA API
- **API:** `https://data.cdc.gov/resource/x9gk-5huc.json` — JSON, SoQL queries, free app token recommended
- **Data:** 2014-present, weekly, 120+ notifiable diseases by state
- **Content type:** `notifiable-disease-weekly`
- **Scale:** 500K-800K entries
- **Gotchas:** Overlaps Tycho 2013 (handle seam), provisional data, some city reporting areas (NYC separate), app token needed for backfill rate limits

### Pipe 4: COVID-19 JHU CSSE Archive
- **Source:** Static CSVs on GitHub `CSSEGISandData/COVID-19` — no API, direct download
- **Data:** 2020-01-22 to 2023-03-10, daily by state, cumulative cases/deaths (compute deltas)
- **Content type:** `covid-daily-state`
- **Scale:** ~64K entries
- **Gotchas:** Cumulative data (must compute deltas), reporting corrections cause negative deltas, repo is archived (finite backfill), state names not abbreviations

### Pipe 5: Delphi COVIDcast Sensor Fusion
- **API:** `https://api.delphi.cmu.edu/epidata/covidcast/` — JSON, register for key
- **Data:** Feb 2020-present, daily/weekly, 6-8 signal types (doctor visits, symptom surveys, mobility, Google searches, hospitalizations)
- **Content type:** `covid-sensor-daily`
- **Scale:** 200K-600K entries
- **Gotchas:** Many signals discontinued (FB survey ended 2022, SafeGraph varies), cryptic signal names, check metadata endpoint first, some signals lagged 2-3 weeks

### Pipe 6: WHO Disease Outbreak News
- **API:** `https://www.who.int/api/news/diseaseoutbreaknews` — JSON, OData, no auth
- **Data:** 1996-present, per-outbreak reports, global
- **Content type:** `who-outbreak-report`
- **Scale:** ~3,500 entries
- **Gotchas:** Global not US-specific, unstructured body text (need secondary call for content blocks), WHO API historically flaky, multiple updates per outbreak

## Build Order
1. Tycho (125 years, biggest impact per day of work)
2. COVID JHU (finite, easy, emotionally resonant)
3. FluView (bridges Tycho-to-present for flu)
4. NNDSS (bridges Tycho-to-present for everything else)
5. COVIDcast (experiential layer)
6. WHO (global context)

## New Content Type Group
- key: 'health', label: 'Health & Disease', icon: Activity, color: rose-400
- Types: disease-weekly, flu-surveillance-weekly, notifiable-disease-weekly, covid-daily-state, covid-sensor-daily, who-outbreak-report

## Total Scale: 2.3M - 4.05M new entries (doubles the brain from 3.2M to 5.5-7.2M)

## Bonus Ideas
- Disease-weather convergence (flu + cold snaps, Lyme + warm winters, WNV + drought)
- Absence narratives (smallpox vanishing 1949, polio plummeting 1955)
- "Birthday Plague Report" feature
- Pandemic Timeline Overlay view
- Herd immunity transition detection via embedding clustering

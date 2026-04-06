---
name: Economic/Financial Data Pipe Design (6 Pipes, 221K Entries)
description: Complete architecture for economic/financial data layer. 6 pipes: FRED (40 series, 137K entries), Yahoo/AV stock history (71K), BLS CPI detail (6K), USDA commodities (26K), NBER events (200), FOMC decisions (500). Exact API endpoints, series IDs, narrative templates, gotchas. Phase 1-5 execution plan.
type: project
---

## Summary
Designed 6 economic/financial data pipes for the time machine, totaling ~221,000 new entries.

### Pipes
1. **FRED (Federal Reserve Economic Data)** — 40 series, ~137K entries. The God API. GDP, CPI, unemployment, VIX, treasuries, yield curve, oil, gold, Fed balance sheet, financial stress. Free API, 120 req/min.
2. **Yahoo Finance / Alpha Vantage** — Pre-2014 stock market history. S&P/DJIA/NASDAQ/Russell daily. ~71K entries. AV free tier = 25 req/day (enough for one-time backfill).
3. **BLS CPI by Category** — 10 subcategory series (food, housing, rent, gas, medical, education, etc.). ~6K entries. Shows what things actually cost.
4. **USDA Agricultural Commodities** — Corn, wheat, soybeans, rice, cotton, beef, pork via FRED series. ~26K entries. WHERE ENVIRONMENT MEETS ECONOMY.
5. **NBER Events Timeline** — ~200 hand-curated major economic events since 1929. High-density narratives.
6. **FOMC Decisions** — ~500 entries. Every rate decision with vote, language, market reaction.

### Key Design Decisions
- Narrative template enriches every entry with cross-references to what ELSE was happening
- FRED vintaged data (realtime_start/end) captures what people ACTUALLY SAW at the time vs. revisions
- Phase 1 (FRED) and Phase 2 (stock history) run in parallel, Week 1
- Daily/weekly/monthly crons for ongoing updates after backfill
- Agricultural commodities cross-reference with existing crop-progress and drought data

### Wild Ideas That Emerged
- Recession Predictor: yield curve + VIX + jobless claims + drought data = novel compound signal
- Cost of Weather: auto-detect commodity price moves following weather events
- Economic Seasons: 9th convergence domain (Economy)
- Misery Map: unemployment + inflation + gas + weather severity per state
- Farmer's Edge: B2B agricultural intelligence product hiding inside the data

### FRED Series IDs (40 total)
Tier 1 (Big 5): UNRATE, CPIAUCSL, FEDFUNDS, GDP, A191RL1Q225SBEA
Tier 2 (Markets): SP500, DJIA, NASDAQCOM, VIXCLS, DGS10, DGS2, T10Y2Y, BAMLH0A0HYM2
Tier 3 (Real Economy): PAYEMS, ICSA, CCSA, HOUST, RSAFS, UMCSENT, INDPRO
Tier 4 (Money/Inflation): M2SL, WALCL, MORTGAGE30US, PCEPI, CPILFESL, GASREGW
Tier 5 (Commodities): DCOILWTICO, GOLDAMGBD228NLBM, DCOILBRENTEU, WPU0121, WPU0131, APU0000708111, PCU311615311615
Tier 6 (Fear/Stress): STLFSI2, DRTSCILM, USREC, TEDRATE, JHDUSRGDPBR, GEPUCURRENT

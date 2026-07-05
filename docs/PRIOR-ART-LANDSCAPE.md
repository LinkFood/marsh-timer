# DUCK COUNTDOWN — THE PRIOR-ART VERDICT

Short answer to your Google intuition: you're right, and you're righter than you think. Google is the *substrate* of this idea and the structural reason it won't build it. Across 35 candidates, nobody scores above **6 out of 10**, and nobody clears the core verb — rhyme retrieval with odds shown — on your exact ground across more than one domain. The idea is not un-thought. It has been named, sketched, and buried repeatedly. But the *whole thing, assembled*, is open ground.

---

## 1. THE VERDICT — is anyone doing the whole thing?

No. The field splits into two camps that never touch: **archives that keep the diary but never read it back** (Weather Underground, Visual Crossing, the Almanac, MSN, Apple) and **models that read a diary back but hide the receipts and call it a forecast** (DeerCast, Fishbrain, onX, Spartan Forge, World Climate Service). The gap between those camps — *read the real diary back, for your spot, with the odds naked* — is empty.

The five closest, by pillar (place / time-deep / rhyme / odds / two-depths, max 10):

| Candidate | P | T | R | O | 2D | Total | What it's missing |
|---|---|---|---|---|---|---|---|
| **eBird Bar Charts** | 2 | 1 | 0 | 2 | 1 | **6** | No rhyme — calendar-week keyed, not condition-keyed. Single domain. Answers "what's usually here this week," never "when did it last look like *today* and what followed." |
| **CIPS Historical Analogs** | 1 | 1 | 2 | 1 | 0 | **5** | The one operational proof of your verb — but it rhymes a *model forecast* (not your observed ground) against a 31-yr weather-only archive at regional grid scale, for meteorologists. Losing its institutional home. |
| **Delle Monache AnEn** | 2 | 0 | 1 | 1 | 0 | **4** | Productized per-place analog retrieval yielding an honest outcome distribution — but the analog is a *past forecast*, the output is a forecast, the user is a grid operator no human ever sees. |
| **Climate Engine / GEE** | 2 | 2 | 0 | 0 | 0 | **4** | Deepest place+time analytics in the field. No rhyme verb, no odds, no wonder axis. A land-manager's anomaly chart. |
| **World Climate Service** | 0 | 1 | 0 | 1 | 0 | **2** | Commercial "days like today → probability of what followed" — but index/hemisphere-keyed (ENSO/NAO), weather-only, forecast-framed, sold to energy traders. Right mechanic, every other pillar inverted. |

Read the scores across the whole field and the pattern is stark: **place-resolved is cheap and everywhere (many 2s). Time-deep is cheap (ERA5 is free back to 1940). Odds shown honestly is rare (only eBird and Apple score high, and Apple stops at deviation-from-average). Rhyme retrieval is nearly extinct in any product a human touches — the only 2s are a research paper (Lorenz) and a dying academic tool (CIPS). Two-depths — practitioner *and* kid at one table with no dumbing down — literally nothing scores 2.** The five pillars each exist somewhere. The assembly exists nowhere.

**What Google IS in this frame, and why it won't build it.** Google is three of your substrate layers at once: Earth Engine is the petabyte EO catalog (Landsat, ERA5, MODIS green-up — your Tier-1 layers, already hosted); Earth Timelapse is the wonder-machine film of your exact ground 1984–2020; and geosearch/Knowledge Graph is the "who stood here" index. Google owns the library, the projector, and the card catalog. It will not build the reading room, and the reason is structural, not oversight:

- **Google indexes and visualizes; it does not take an editorial stance.** Your product's entire value is a *refusal* — never a fused score, never a forecast dressed as fact, "no good precedent" said out loud. That is an author's judgment. Google's business is to be the neutral pipe, not the almanac writer.
- **Its incentives are inverted.** Ads and engagement reward a confident daily number and a push notification (see MSN's "Trendbuster"). Your honest-window law forbids exactly the thing that drives Google's metrics.
- **GEE is BYO-code with no end-user product.** Google deliberately stops at the API and sells the compute. Turning it into a consumer instrument for a hunter is a market Google has structurally declined for a decade.

Google hands everyone the diary. It has never once offered to read it back to you honestly. That's the whole opening.

---

## 2. THE THREATS — who could pivot, how fast, what the moat really is

**Fast movers (they own the audience, not the verb):** onX Hunt, DeerCast, Fishbrain, Spartan Forge. These already have place-resolution and paying practitioners. A precedent-cards feature is a quarter of engineering away. But every one of them is *built on the fused-score religion* — their brand promise is "we did the thinking, here's your number." Bolting on honest naked odds contradicts the product they sell. DeerCast Past (4 years, manual comparison) is the closest any of them has crept, and it's still a records shelf, not a rhyme engine. **Threat: real but slow, because it requires them to disown their core pitch.**

**The one with the verb already:** World Climate Service. They run retrieve-analogs-then-show-probability commercially today. A consumer, place-resolved, multi-domain version is conceivable — but they're an energy-trading data shop with zero consumer DNA and no reason to leave a lucrative B2B niche. **Threat: low, wrong-market inertia.**

**The giants who won't:** Apple and Microsoft already ship the place+time archive at OS scale (WeatherKit HistoricalComparisons, MSN Climate Insights, 50–70 years). Neither will ever say "this happened 5 of 7 times, here's what followed" — that's an outcome *claim*, and their brand-risk posture forbids it. Apple deliberately stops at deviation-from-average and keeps only 3 years of day-level data. **Threat: none on the honest product; they've chosen the liability-safe ceiling.**

**Now the honest part about the moat. It is not the archive.** The raw material is commodity: Visual Crossing sells any-spot 50-year history for pennies, ERA5 is free to 1940, 20CRv3 reconstructs to 1836, eBird and USA-NPN are free. Anyone can assemble your Pillar 1+2. **The moat is two things, and you should be clear-eyed that neither is a patent:**

1. **The unified multi-domain clock + the retrieval verb as a finished product.** Everyone has one domain on one axis. Nobody has weather + tide + moon + storms + wildlife + human events on *one queryable clock with a rhyme query on top*. That's an integration and taste moat — real, but earned by execution, not owned.
2. **Incentive-incompatibility with everyone bigger.** Your honesty laws are *copyable in an afternoon* and *structurally un-adoptable* by the incumbents whose economics depend on the confident number. That's the durable edge: not that they can't, but that they won't, because doing it well would break their own model.

Verdict on the moat: **thin on technology, strong on positioning and incentive.** Don't defend it by hoarding data. Defend it by being the one product in the category that will say "we don't know, here's how often it went each way" — and building the brand around that refusal before an incumbent's PM ever gets permission to.

---

## 3. THE TEACHERS — the five most borrowable things found

1. **The CIPS/AnEn output object — steal it wholesale.** Retrieve top-N most-similar past days, then report the *frequency of what followed across those N* (not a fused score). This is your Pillar 3+4 already validated in operational meteorology. Take Delle Monache's AnEn **similarity metric specifically**: a weighted distance over a *short time window of a few predictor variables at that exact station* — it already solves "which variables, how wide a window" for per-place matching.

2. **eBird's denominator discipline.** "Frequency 0.4 = reported on 40% of complete checklists here this week." That's the cleanest honest base-rate UI in existence — nobody accuses a bar chart of forecasting. Copy the *frequency-over-a-stated-denominator* presentation as the literal template for your receipts law. Bonus: the dataset is Tier-1 ingestible today.

3. **The Fitzpatrick/Mahony sigma-dissimilarity metric.** A rigorous multivariate "closeness" score with a *built-in novelty flag* — it tells you when a state has no good analog. This is exactly how you score rhyme-quality AND honestly light up "today has no real precedent" instead of forcing a bad match. Directly load-bearing for the honest_note field.

4. **The NOAA Model-Analogs learned-mask (Landsberg et al., 2025).** Interpretable AI that identifies *which drivers make an analog trustworthy vs. a false rhyme.* Borrow the idea to show not just "5 of 7 times" but "and here's why these 7 days are genuinely comparable" — a research-backed way to separate a real rhyme from a coincidence.

5. **The datasets + the solo-dev playbook.** Free time-deep substrate: ERA5 (1940+), 20CRv3 (to 1836, physically consistent — but label it *reconstruction*, not recorded fact), USA-NPN lilac series (1955+), Hawthorne Valley NY phenology (1819–1872). And from OldNYC's 2024 rebuild: modern LLM OCR/geocoding turns a messy legacy archive into a weekend job, and MapLibre/OSM is the free mapping stack (you already cut Mapbox). Its real lesson — *one deep dataset done completely beats thirty shallow ones* — is the same dagger your own gettability audit drew.

---

## 4. THE SCIENCE — when "days like today" works, when it fails, and what your honest_note must say

The analog method has a 57-year paper trail, and it proved two laws that are *good news dressed as caveats* — because they are the mathematical justification for your entire honesty posture.

**Lorenz 1969** searched 5 years of twice-daily hemispheric fields across 1,003 grid points and found "numerous mediocre analogues but no truly good ones." The atmosphere is too high-dimensional for near-identical full-state rhymes to occur in short records — and analog skill decays fast (error doubling ~8 days). Two consequences, both non-negotiable:

- **Rhyme on a deliberately reduced feature set per domain, never the full state.** Match on the 3–5 variables that carry the signal for *that* question (front passage: pressure drop + wind shift + temp; green-up: accumulated growing-degree-days). Full-vector matching guarantees mediocre matches — Lorenz proved it.
- **Never sell retrieval as forecast.** Analog skill collapses quickly; that is *precisely why* "precedent, not prediction, odds always shown" is the scientifically correct stance, not merely a nice ethical choice. You are not being humble. You are being right.

**Delle Monache et al. (AnEn)** adds the operational finding: analog skill *improves with archive depth and degrades with lead time*. That directly parameterizes your honesty UI.

So every `honest_note` field should carry, as recorded fact:
- **N** — how many precedents were found ("7 days in 41 years resembled today").
- **The feature set matched** — "on pressure-drop + wind-shift, not full weather state."
- **The archive depth** — "from 41 years of this station's own record."
- **The base rate + control** — "5 of those 7 were followed by a front within 48h, vs a 1-in-6 climatological baseline."
- **A novelty flag** — when sigma-dissimilarity says no good analog exists, *say so*: "today doesn't rhyme with anything on record here — that itself is the finding."

Your denominator law isn't a UX preference. It's the only honest output the analog literature permits. Lorenz wrote your terms of service in 1969.

---

## 5. THE ANCESTORS — the lineage, for your brand story

You are not inventing a genre; you are the machine-built heir to one of the oldest human habits there is — *writing down what the ground did, so someone later could ask.* The line runs from the Kyoto court diarists who logged cherry-blossom full-bloom dates from 812 AD (the longest phenological record on Earth, still readable, still rhyming), through Robert Marsham's English "Indications of Spring" begun in 1736 and kept by his family for two centuries, through Thoreau's Concord notebooks, through Aldo Leopold's Sauk County ledgers of the 1930s–40s — the very records later used to prove spring is arriving early — through the Old Farmer's Almanac since 1792 and the lilac networks that became Nature's Notebook. Every one of them kept the diary by hand, for one place, and could only read it back the way a scholar reads a manuscript: slowly, and alone. Nature has been keeping this diary for twelve centuries. **Duck Countdown is the first place that reads all of it back — for the exact ground you stand on, in the time it takes to ask — and is honest enough to tell you when the page is blank.**

That's the story, and it's true. Don't claim you're first to the *dream* — the deep-mappers named it 15 years ago, WhatWasThere and PhilaPlace died chasing the wonder half, LocalWiki proved volunteers won't write it. Claim what's actually yours: **first to build the machine that keeps the whole diary honestly and reads it back on command.**

---

## Top-10 scored candidates

- eBird Bar Charts / Hotspot Frequencies (and Merlin's likelihood ranking built on them) — 6/10 (teacher)
- CIPS Historical Analog Guidance (Saint Louis University / moving to Univ. of Missouri) — 5/10 (teacher)
- Weather Underground History — 4/10 (teacher)
- Climate Engine (DRI/UC Merced, on Google Earth Engine) — 4/10 (teacher)
- Delle Monache et al. 2013 — Analog Ensemble (AnEn) — 4/10 (teacher)
- Deep Mapping / Spatial Humanities movement (Bodenhamer, Corrigan & Harris, 'Deep Maps and Spatial Narratives') — 4/10 (ancestor)
- Clio (theclio.com) — 4/10 (teacher)
- WhatWasThere (dead) — 4/10 (ancestor)
- OldNYC — 4/10 (teacher)
- Apple WeatherKit HistoricalComparisons + Weather app 'Averages' — 4/10 (teacher)

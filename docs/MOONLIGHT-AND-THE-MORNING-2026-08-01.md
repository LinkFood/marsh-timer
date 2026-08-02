<!-- Produced 2026-08-01 by a 9-agent workflow: 6 blind research angles (waterfowl ecology,
     adjacent taxa, practitioner record, telemetry/radar, agricultural science, harvest data),
     an adversarial reviewer instructed to REFUTE, and a confounder analyst. Agents were told
     the owner holds a strong prior from 30 seasons and that a flattering answer is worse than
     useless. The load-bearing result is in section 2(c). -->

# The Moon, the Marsh, and the Morning: what the record can and cannot carry

## 1. THE ANSWER IN ONE PARAGRAPH

**The first half of your mechanism is real and measured. The second half — the half your product depends on — has never been measured by anyone, and the one time it was measured (in this dossier, on the best available North American duck telemetry) it came back at zero.** Waterfowl demonstrably feed at night, and they demonstrably feed and move *more* when there is more usable light: barnacle geese add 3.6 ± 0.4 minutes of foraging per hour of moonlight ([Lameris et al. 2021](https://doi.org/10.1093/beheco/araa152), n=23 GPS+accelerometer birds), mallard nightly movement rises 2.1× from new to full moon ([Osborne et al. 2024](https://doi.org/10.1002/wlb3.01309), n=120 GPS ducks, Mississippi Alluvial Valley), geese sleep ~2 hours less on full-moon nights ([van Hasselt et al. 2021](https://doi.org/10.1093/sleep/zsaa244), n=13). But no published study in any taxon regresses **next-morning** flight on the **previous night's** usable light. When that regression was run for the first time on Osborne's public Dryad data (1,984 bird-days, 105 birds, 225 dates, with a properly built illumination × moon-altitude × cloud index and ERA5 cloud cover), the previous-night coefficient in hunting season was **b = −0.0007 (SE 0.0090, p = 0.94)** — a dark-overcast-to-bright-clear swing changes next-day movement by **−0.4%, 95% CI [−9.0%, +9.1%]** — while the *same-night* effect was strongly **positive** (+23.3% [+11.4%, +36.5%]). Worse for the mechanism: the moon effect exists **only during hunting season** (pre-hunt p=0.69, hunt p=0.005, post-hunt p=0.46), which photons cannot explain and hunting pressure can. And you hunt tidal marsh, where a confound nobody in this literature has ever named — **the lunar-locked tidal clock, worth 19 inches of water at 07:00 between spring and quarter moons at Bishops Head** — produces your exact symptom with zero photons involved. **Honest verdict: your belief is not disproven, it is unmeasured at the one link that matters, the nearest evidence points the wrong direction, and the app cannot carry it as a prediction. It can carry it as a count.**

---

## 2. WHAT IS ESTABLISHED

### (a) Waterfowl feed at night — **ESTABLISHED. Not in dispute.**

| Source | Sample | Finding |
|---|---|---|
| [Lameris et al. 2021, *Behav Ecol*](https://pmc.ncbi.nlm.nih.gov/articles/PMC8177807/) | 23 barnacle geese, GPS + 20 Hz accelerometer, random-forest behavior classifier (0.86 precision on foraging) | 4–6 h night foraging around full moon; **26% ± 19% of total daily foraging** occurred at night on nights with >12 moonlit hours. Without night foraging, modeled winter mass decline was **twice as rapid**, ending >100 g lighter |
| [Beatty et al. 2024, *Ecol Appl*](https://doi.org/10.1002/eap.2952) | **426 GPS mallards** | Mallards avoided human-accessible areas by day, then selected the best high-energy foraging patches **nocturnally**; "freed from these constraints nocturnally" |
| [Parejo et al. 2019, *PLoS ONE*](https://doi.org/10.1371/journal.pone.0220400) | GPS-GSM northern pintails, Iberia | All birds roosted by day, foraged rice fields **at night** — obligate nocturnal feeding system |
| [Shirkey et al. 2020, *JWM*](https://doi.org/10.1002/jwmg.21872) | Female mallards, Ohio | Nocturnal foraging adopted as a strategy in food-rich landscapes, rendering birds **unavailable to daytime hunters** — driver identified as *hunting disturbance*, not light |
| [Ducks Unlimited, "Night Moves"](https://www.ducks.org/conservation/waterfowl-research-science/understanding-waterfowl-night-moves) (Hagy, Cohen, Osborne, 2022) | Popular synthesis | Evening foraging flights up to 30 miles; whole nights in one location. **Does not mention moon, moonlight, or lunar phase once.** Attributes night movement to food and disturbance |

Confidence: **high**. This is the premise, and it holds.

### (b) They feed/move MORE when there is more usable light — **ESTABLISHED for movement and foraging duration; the direction is consistently POSITIVE; the cloud half is essentially untested in waterfowl.**

| Source | Sample | Effect size |
|---|---|---|
| [Lameris et al. 2021](https://doi.org/10.1093/beheco/araa152) | 23 barnacle geese, 2,901 night-observations | **+3.6 ± 0.4 min foraging per hour of moon-above-horizon** (agricultural); 2.6 ± 1.2 (natural); **4.6 ± 0.7 in Jan–Feb**. Critically: **total daily foraging also rose 5.3–6.4 min/h** — moonlight *adds* intake, it does not merely reallocate it |
| [Osborne et al. 2024](https://doi.org/10.1002/wlb3.01309) | 31 mallards, 51 GW teal, 38 wigeon, 2 winters, Arkansas MAV | Moon illumination raised nocturnal movement in **all three species**; mallard nightly distance **×2.1 new→full — during hunting season only**, absent pre- and post-season |
| [Körner et al. 2016, *Anim Behav*](https://kops.uni-konstanz.de/bitstreams/3d938f45-cbf0-49cf-ac67-0858b312d436/download) | 15 mallards, GPS+accel, 2 sites | **The only duck study testing phase × moon-above-horizon.** Lake Constance: interaction **P = 0.002**, activity up "somewhat" at full moon *only when the moon was up*. But effect ≈ **0.3–0.5 units vs ~1.1 for 2 mm of rain**; at the other site activity rose at **both new AND full** moon. Authors' own summary: activity allocation "largely independent of moon, weather and season" |
| [van Hasselt et al. 2021, *Sleep*](https://doi.org/10.1093/sleep/zsaa244) | 13 barnacle geese, EEG | **~2 hours less NREM sleep** on full-moon vs new-moon nights |
| [Portugal et al. 2019, *Ecol Evol*](https://pmc.ncbi.nlm.nih.gov/articles/PMC6662397/) | 6 wild barnacle geese, full-year biologgers | **The only waterfowl study with a real cloud term.** Significant three-way lunar phase × lunar distance × **cloud cover** on nighttime body temperature, **β = −0.0028 (SE 0.0012, p = 0.02)**, highest on clear perigee-full nights. But heart rate showed *no* matching interaction — usable light reaches the bird; it does not demonstrably make the bird feed |
| Reconstruction on Osborne's Dryad data (this dossier) | 1,984 bird-days, 105 birds | Same-night usable light: **+0.0344 (SE 0.0119, p = 0.004)** all seasons; **+0.0409 (p = 0.0001)** hunt season. GW teal strongest: +0.0635 (p < 0.0001) |

**Every measured light effect on waterfowl points the same way: MORE activity, not less.** That is a worse premise for "the morning will be dead" than the null is. It is equally consistent with more traffic at first light. The practitioner record itself contains that counter-claim (r/Duckhunting: birds "move in large groups" after a full moon; Duck Hunting Chat: puddle ducks "fly early" on full moons).

**On cloud:** no waterfowl paper has ever modeled illumination × cloud against feeding. Lameris downloaded NCEP cloud at each goose's location and used it only for thermoregulation cost. Osborne had NOAA `HourlySkyConditions` in the raw file and did not analyze it. The one direct field observation of the clear/overcast contrast — [Ydenberg, Prins & van Dijk 1984, *Wildfowl* 35:93–96](https://tidsskrift.dk/Wildfowl/article/download/155047/197610/341828), ~3,200 barnacle geese — reports the full-moon behavioral inversion happening **without the photons**: *"light intensity does not seem to be important. Many of the nocturnal visits to the polder were made on nights of heavy overcast or dense fog, while no visits were made on bright clear nights with, for example, a half moon."*

### (c) Overnight feeding SUPPRESSES dawn flight — **NOT ESTABLISHED. Not measured by anyone. First direct estimate is a zero.**

This is the load-bearing link and it is the empty one.

- Europe PMC full-text searches for `moon AND ("morning flight" OR "dawn flight") AND (waterfowl OR mallard)` return **zero hits**. Same for `("moon phase" OR moonlight) AND waterfowl AND (hunt OR harvest)`. OpenAlex for dawn flight timing in waterfowl returns 1890s natural-history books.
- The canonical peer-reviewed hunter-success model, [Stafford et al. 2010, *Wildlife Biology*](https://www.bioone.org/doi/pdf/10.2981/09-071) — 221 site-years, 11 Illinois check stations, 21 seasons — contains **zero occurrences of moon, lunar, cloud, illumination, nocturnal or night** in the paper *or its 40-item reference list*. And it records why: daily check-station records "were discarded or unavailable." The resolution needed to test your hypothesis was destroyed.
- The only structural evidence for a 24-hour trade-off is [Körner et al. 2016](https://kops.uni-konstanz.de/bitstreams/3d938f45-cbf0-49cf-ac67-0858b312d436/download): excess night activity is followed by below-expected next-day activity. **But the alternation was asynchronous across individuals** (mean pairwise residual correlation **0.03** and **0.11**). A population-wide dead morning requires synchrony. The one study that looked for it found none. That is quietly the strongest argument against the whole idea.
- **The first-ever direct test**, run on Osborne's CC0 data with the correct variable:

| Model | Previous-night usable light | Same-night |
|---|---|---|
| All seasons (n=1,984) | +0.0076 (SE 0.0120, **p = 0.53**) | +0.0344 (p = 0.004) |
| **Hunting season (n=1,064, 78 birds)** | **−0.0007 (SE 0.0090, p = 0.94)** | +0.0409 (p = 0.0001) |
| Mallards only (n=756) | −0.0046 (p = 0.70) | +0.0230 (p = 0.059) |

p10→p90 previous-night swing → **−0.4% next-day movement, 95% CI [−9.0%, +9.1%]**. The CI excludes any suppression larger than ~9%.

**Caveats I will not paper over:** daily-total movement is blunt. A suppression confined to the 30–90 minutes after legal light could hide inside a daily total. The hourly file that would settle it (`Hourly_Movement_DabblingDuck`, containing `minutes_sunrise`, a `moved >500 m` binary, and `HourlySkyConditions`) sits behind an AWS WAF and was not retrieved. **That specific test remains undone and is the single highest-value open item in this entire dossier.** Also: movement ≠ decoying ≠ birds in the bag.

---

## 3. WHAT IS NOT KNOWN — stated as a study design

> **Nobody has ever regressed next-morning waterfowl flight activity (or harvest) on the previous night's usable light, where usable light is constructed as illumination × moon-altitude, integrated over the moon-up hours, gated by measured cloud cover, on a tidal Atlantic Flyway marsh, with hunting pressure and dawn tide stage as covariates.**

Fill in the blanks and it is a publishable paper:

- **Response:** P(bird departs roost | sunrise → sunrise+120 min), or step length in that window, or ducks-per-**hour** (never per hunter-day).
- **Predictor:** Σ over half-hours of night [illuminated fraction × sin(moon altitude) × (1 − cloud/100)], night defined sunset(t−1) → sunrise(t), sun altitude < −6°.
- **Do not enter illumination and hours-above-horizon as separate terms.** Measured over 1,090 Blackwater season-nights: **r = 0.988**. At mid-latitudes in winter they are the same variable measured twice. Putting both in a model is collinear noise dressed as rigor.
- **Why cloud is not optional and not cosmetic:** correlation between pure moon geometry and cloud-adjusted usable light in the Arkansas winter data is **0.646** — phase-style variables capture ~42% of the variance in actual usable light. [Śmielak 2023](https://link.springer.com/content/pdf/10.1007/s00265-022-03287-2.pdf) measured it against light loggers: moon phase explains **60%** of ground-illumination variance with residual SE **22.6%**; a proper geometric model explains **92.2%** with SE **1.4%**. Cloud is threshold-like, not linear — [Krieg 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8526603/) measured full-moon clear-sky at ~200 mlx, and *"only at a cloud cover of more than 90%"* does it collapse to ~0.5 mlx (**~400×**).
- **The bonus nobody has exploited:** pure moon geometry autocorrelates night-to-night at **r = 0.972** — you cannot separate "last night" from "tonight." Cloud-adjusted usable light autocorrelates at only **r = 0.452**. **Cloud supplies the orthogonal variation that makes the lag identifiable.** That is the methodological gift sitting unused in this literature.
- **Fixed effects:** bird (or refuge), season-week, day-of-week. **Blocking on day-of-week is mandatory** — Maryland closes all Sundays to migratory waterfowl, so Monday mornings always follow an undisturbed day, and the 7-day disturbance cycle beats against the 29.53-day lunar cycle.
- **The template exists in another taxon:** [Bombieri/Pokorny et al. 2023, *J Appl Ecol* 60:2405](https://doi.org/10.1111/1365-2664.14432), **49,259 roe deer roadkills**, negative-binomial GAM with a thin-plate spline on illuminated fraction × MODIS cloud cover. It found the interaction is real, **non-monotonic** (roadkill peaked at *medium-to-high* cloud), and that *"the day of the year had a much stronger marginal effect on collisions, in terms of magnitude, than moon illumination and cloud cover."* That is simultaneously the method and the humility check.

---

## 4. THE CONFOUNDERS, RANKED

### 1. **THE TIDAL CLOCK — the one nobody named, and the biggest**

Not spring–neap *range*. The **clock**. High water follows the moon's transit by a fixed lunitidal interval, so full and new moon put high water at the *same* hours and quarter moons shift it ~6 h. Measured at **Bishops Head, MD (NOAA 8571421)**, Fishing Bay, adjoining Blackwater — Oct 15–Jan 31, ten seasons 2015-16→2024-25:

| Lunar band | Mean HW hour (mod 12.42 h) | **Predicted water level at 07:00** |
|---|---|---|
| Near-full (illum >0.96), n=141 | 1.16 | **−0.08 ft MLLW** |
| Near-new (illum <0.04), n=140 | 1.19 | **−0.07 ft MLLW** |
| Quarter (>6.5 d from syzygy), n=128 | 7.24 | **+1.51 ft MLLW** |

**Spring minus quarter at 07:00 = 1.59 ft = 19 inches of water on the marsh at shooting time, deterministically locked to lunar phase.** That is **3.1× the entire spring–neap range difference** (2.151 vs 1.638 ft, +31%). Nineteen inches on a Chesapeake marsh is the difference between a dabbler reaching food and not, between a gut being runnable and not.

**And it flips sign by site.** Bishops Head springs → low water at dawn. **Ocean City Inlet (8570283) springs → high water at 07:57.** Kiptopeke VA the same. A tidal mechanism must reverse sign between those sites; a photon mechanism cannot. That is a free test.

**Wind tide is noisy but does not erase it:** observed minus predicted at Bishops Head, Nov–Jan 2019–2024, **n = 13,248 hours, residual SD = 0.59 ft**, |residual| > 0.51 ft on **36%** of hours. So wind setup swamps the *range* effect — but wind shifts level, not phase, and the 1.59 ft dawn-clock difference is **2.7× the residual SD** and survives. (Also: residual mean climbed 0.58 → 0.87 ft between 2019 and 2023. Blackwater is drowning relative to the datum epoch. Any multi-decade harvest series carries a secular water-level trend that must be detrended first.)

**One clean inference:** the Mississippi Alluvial Valley and California Central Valley datasets are **managed non-tidal impoundments**. Osborne's 2.1× effect therefore *cannot* be tidal — it is tide-free evidence that light moves birds at night. The California harvest null *cannot* be tidal either. Together they suggest the tidal confound is specifically a **coastal-marsh** story: exactly where you hunt.

### 2. **Recall/attribution asymmetry, with a real physical cause to attach to**

The full moon is salient, visible, nameable, checkable after the fact, and **not your fault**. The new moon is invisible — and per #1 it is **tidally identical**. So nobody ever blames it. Base rates at Blackwater: illumination >0.96 on **12.7%** of season days, >0.90 on **20.3%**, <0.10 on **20.4%**. In Osborne's Arkansas hunt nights, illumination >0.7 on 42%, cloud <30% on 37.8%, **both on 15.4%** — the "bright clear night before" condition is present on roughly **one hunting morning in six**. Slow mornings are the mode; one in six of them has a blameable moon. That is the classic architecture of a durable superstition: moderately frequent, highly salient, non-culpable.

The practitioner record is textbook: *"Every one of our bad hunts this year has come on a full moon"* (no denominator); *"Been some slow mornings as I recall."* And the two people who actually kept records **disagree** — DR. DUX reads 13 years of his own logs and sees a strong clear-night effect *"ESPECIALLY in the late season"*; Jerry L reads Rick Hall's moon-annotated log and concludes *"I can't see it having any influence."* Two datasets, two opposite readings, zero analyses. Subtract also the SEO/AI content-farm cluster (shunspirit, thegunzone, findahunt, huntwise, ewash, iere.org, Dive Bomb) recycling the same two sentences — those are not independent observations.

**The most damning institutional fact:** DU's own 2022 science article on nocturnal waterfowl behavior, by three PhD waterfowl scientists — Hagy, Cohen, and **Osborne, the same Osborne whose data produced the 2.1×** — does not mention the moon once. The claim reaches print through DU *columnists* and outfitters, never through agency biologists. No state biologist, refuge manager or flyway biologist anywhere in this record states it.

### 3. **Hunting pressure — and it is not independent of the moon**

Osborne's mallard 2.1× exists **only during hunting season**. Reproduced with a properly built light variable: pre-hunt b=+0.011 (p=0.69), hunt b=+0.041 (p=0.005), post-hunt b=−0.018 (p=0.46). **Photons do not know whether hunters are in the marsh.** That is the signature of risk-timing — light *enables* a disturbance-driven schedule rather than *causing* a feeding schedule. [Beatty et al. 2024](https://doi.org/10.1002/wlb3.01198), 336 GPS mallards, found mallards least active during legal shooting hours. A moon term fitted without a pressure term will absorb pressure. Within a *single* season the weekday sampling is also contaminated: the synodic cycle advances ~1.53 weekdays per lunation, so per-season weekend share of full-moon days ranges **0.167 to 0.385**. Pooled over 25 seasons it washes out (corr(illumination, day-of-season) mean **−0.004**); in one season it does not.

### 4. **Effort/denominator selection — and it biases toward the null**

Ducks-per-hunter is a ratio. If the belief suppresses marginal turnout at full moon, the survivors are more committed and more skilled, biasing the ratio **upward** at full moon and *masking* a real effect. Every check-station null inherits this. Related and opposite-signed: on dark mornings hunters run headlamps and Q-beams across the marsh before shooting light — itself a flushing disturbance that **degrades** dark-moon hunts and dilutes any full-moon-bad effect. **An observed null is not a clean null.** Fix: model hunter *counts* and success *separately*, and use harvest per **hour**.

### 5. **"Clear night" is collinear with bluebird weather**

The refinement that makes your hypothesis physically sharper also makes it maximally confounded with the best-known bad-hunting condition: clear night → high pressure, calm, no front → poor flight, for reasons with nothing to do with photons. Full-vs-new fixes this, because both arms are drawn from the same cloud distribution.

### 6. **Moon-at-dawn hunter conspicuity** — same symptom, opposite mechanism

Maryland shooting starts 30 min before sunrise. With a **waning** gibbous 34° up in the west, you, the boat, the blind and the decoy shadows are lit from behind the birds' approach. Birds flare. Identical symptom, different cause. Isolated by Test 2 below. Never tested in any taxon.

### 7. **"The birds left" ≠ "the birds fed"**

[Prinz et al. 2025](https://doi.org/10.1038/s41598-025-04270-3): skylark nocturnal migration rose with moon fraction, intensity **and** duration. Practitioners assert the same for ducks. Fewer birds present is not the same claim as present birds sitting tight. Pair any harvest test with a local abundance measure.

### 8. **Skyglow sign flip near towns**

[Kyba et al. 2011](https://doi.org/10.1371/journal.pone.0017307): cloud **amplified** sky luminance **10.1×** inside Berlin, **2.8×** at 32 km; overcast urban nights ran **4.1× brighter than clear rural moonlit nights**. [van Hasselt et al. 2021](https://doi.org/10.1016/j.envpol.2021.116444) found exactly this sign flip in geese — cloud *reduced* their sleep by reflecting artificial light. Blackwater is dark enough that cloud subtracts. The same coded rule near Cambridge, Easton, Annapolis or Baltimore has the **opposite** sign. **A "cloud blocks the moon" gate is a known-wrong physical model over a large fraction of Maryland tidewater.**

### 9. **Direct lunar meteorology — effectively dead**

ERA5 daily at Blackwater (38.4436, −76.0783), Oct 15–Jan 31, 2000–2025, **n = 2,834 days**, against independently computed illumination: corr with **cloud cover +0.038**, max wind +0.039, min temp −0.006, MSLP +0.028, precip +0.023. All ≤0.16% of variance. P(clear, <30% cloud) = **0.262 on full-moon days vs 0.270 on new-moon days** — i.e. full-moon days at Blackwater are very slightly *cloudier*. **"The moon clears the sky" is false here.** Physics agrees: the lunar semidiurnal pressure tide L₂ is ~**0.1 hPa** ([Ray & Poulose 2015](https://doi.org/10.1002/2015jd024243), 2,315 barometers) against a measured MSLP SD of **7.9 hPa** — ~80× smaller; [Balling & Cerveny 1995](https://doi.org/10.1126/science.267.5203.1481) found a real full-vs-new temperature modulation of **0.02 K**.

### 10. **Interaction sign — my own fit runs the wrong way**

Fitting moon geometry × clear-sky fraction on the previous night: main effect +0.0506 (SE 0.0107), **interaction −0.0326 (SE 0.0166, p = 0.050)**. The moon's association with movement is *larger under overcast* (0.051 fully clouded vs 0.018 fully clear) — the opposite of usable-light gating. Cloud alone predicts nothing (b = −0.036, p = 0.60). In hunt season the interaction is null. Consistent with Ydenberg 1984 and with the roe-deer non-monotonicity.

---

## 5. THE VERDICT ON SHIPPING IT

**Do not ship it as a gate.** A rule that can zero a hunting morning is orders of magnitude more aggressive than the largest environmental effect ever measured on duck harvest. For scale, the only weather effects ever measured on real duck harvest — 25,040 CDFW hunt-days, 37 wildlife areas, 22 seasons (archived sibling of the lost outdoorstats moon analysis) — are **heavy rain +0.06 ducks/hunter (~16 trips per extra bird)** and **high wind +0.05**, temperature flat (r = −0.003, p = 0.64). The only significant term in the peer-reviewed model is **0.03 mallards/hunter/day per °C**, best-model r² = 0.14–0.18. Nothing in that list is a whole-day effect.

And the closest analogue with real money behind it is a clean null: [Webb et al. 2010](https://doi.org/10.1155/2010/459610), **32 white-tailed deer, GPS at 15-minute fixes, 7 years, 3 seasons** — *"We found moon phase had no effect on daily, nocturnal, and diurnal deer movements."* Universal hunter belief, fine-resolution telemetry, nothing there. Your fellow practitioners reach for the deer analogy themselves. The deer version has been tested and it failed.

**Honest probability that the mechanism is real AND large enough to matter to your morning: ~12%.** Decomposed: light extends nocturnal foraging ~90% (established); overnight foraging measurably suppresses dawn flight ~20% (direct null, zero point estimate); cloud gates it in the claimed direction ~25% (both direct looks run the wrong way, plus the skyglow sign flip); surviving effect large enough to justify a gate ~30%.

**Under COUNT, NEVER PREDICT, the moon card may display four things: the geometry, the sky, the base rate, and the refusal.** It may never display an expectation.

### Ship this — the moon card, actual copy

```
┌─────────────────────────────────────────────────────────────┐
│  LAST NIGHT'S LIGHT                     Sat 10 Jan · 06:41  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   MOON            94% illuminated  (waning gibbous)         │
│   ABOVE HORIZON   19:12 → 07:44 · 12.5 h of the night       │
│   SKY OVERNIGHT   18% mean cloud cover (ERA5, 00–06 local)  │
│                                                             │
│   ──────────────────────────────────────────────────────    │
│                                                             │
│   BRIGHT AND CLEAR.                                         │
│                                                             │
│   Nights like this — moon over 90% and overnight cloud      │
│   under 30% — occur on 15% of Maryland duck-season          │
│   mornings.  (n = 2,834 season days, Blackwater NWR,        │
│   ERA5 2000–2025)                                           │
│                                                             │
│   ⚠  WHAT THIS DOES NOT TELL YOU                            │
│   No study has ever measured whether last night's light     │
│   changes this morning's flight.  The one direct test       │
│   that exists — 105 GPS-tagged ducks, 1,984 bird-days,      │
│   Arkansas — found next-day movement changed by −0.4%,      │
│   95% CI −9% to +9%.  That is a zero.                       │
│   The same data found ducks moved 23% MORE on bright        │
│   clear nights, and no less the next day.                   │
│                                                             │
│   This card is a measurement, not a forecast.               │
│                                                             │
│   ──────────────────────────────────────────────────────    │
│   TIDE AT 07:00 (Bishops Head, NOAA 8571421, predicted)     │
│   −0.1 ft MLLW · falling                                    │
│   Full and new moons put low water here at dawn.            │
│   Quarter moons put it 1.6 ft higher.  This is locked to    │
│   lunar phase and has nothing to do with moonlight.         │
│                                                             │
│   YOUR LOG · bright-clear mornings:  4 hunts, 1.8 birds/hr  │
│              all other mornings:    31 hunts, 1.6 birds/hr  │
│   Too few to mean anything.  Need ~50 per side.             │
└─────────────────────────────────────────────────────────────┘
```

**If the record ever DOES support the mechanism**, the card changes by exactly one block — and it still counts rather than predicts:

```
│   ⚠  WHAT THE RECORD SAYS                                   │
│   On the 187 logged mornings after nights like this,        │
│   hunters averaged 1.1 birds/hour.  On the 1,204 other      │
│   mornings, 1.6 birds/hour.  Difference −0.5 birds/hour,    │
│   95% CI −0.8 to −0.2.  (Source: [dataset], [n], [years])   │
│   This is a count of what happened, not a forecast of       │
│   this morning.                                             │
```

**Refusal state — when an input is missing.** Ship this verbatim rather than degrading gracefully into a guess:

```
┌─────────────────────────────────────────────────────────────┐
│  LAST NIGHT'S LIGHT                                         │
├─────────────────────────────────────────────────────────────┤
│   MOON            88% illuminated  (waxing gibbous)         │
│   ABOVE HORIZON   16:03 → 04:51 · 8.9 h of the night        │
│   SKY OVERNIGHT   NOT AVAILABLE                             │
│                                                             │
│   Overnight cloud cover could not be retrieved for this     │
│   location and date.                                        │
│                                                             │
│   Moon phase alone explains only 60% of the variation in    │
│   actual light on the ground (residual SE 22.6%).           │
│   Śmielak 2023, Behav Ecol Sociobiol 77:21                  │
│                                                             │
│   Without the sky, this card would be a guess.              │
│   It refuses.                                               │
└─────────────────────────────────────────────────────────────┘
```

**Three things the card must never do:**
1. Enter illumination and hours-above-horizon as separate predictors or separate scores. **r = 0.988.** It is one variable.
2. Code cloud as "blocks the moon" without a skyglow term. Wrong sign near Cambridge, Easton, Annapolis, Baltimore.
3. Show a moon card on a tidal site without the dawn tide stage beside it. At Bishops Head the moon *is* the tide, and the tide is 19 inches.

---

## 6. HOW YOU COULD SETTLE IT YOURSELF

### The lever: **FULL vs NEW.** Nobody has run it, and it kills nine of eleven confounders at once.

Compare mornings following nights within ±2 days of **full** against ±2 days of **new**. Verified matched at Bishops Head across 10 seasons:

| | Full | New | Difference |
|---|---|---|---|
| Daily tidal range | 2.153 ft | 2.141 ft | **0.012 ft (⅛ inch)** |
| Water level at 07:00 | −0.08 ft | −0.07 ft | **0.01 ft** |
| High-water clock hour | 1.16 | 1.19 | **0.03 h** |
| Mean cloud cover | 56.2% | 53.0% | 0.10 SD |
| P(clear, <30%) | 0.262 | 0.270 | 0.008 |
| Weekday distribution | uniform | uniform | — |
| Day-of-season | r ≈ 0 | r ≈ 0 | — |
| **Moon-hours in night** | **12.94** | **0.34** | **12.6 h** |
| **Illumination** | ~1.00 | ~0.00 | **~100%** |

corr(illumination, daily range) = **+0.028**. Tide, sky, weekday and season-position are all held constant by construction. **If full ≈ new, there is no photon mechanism. If full < new, no confounder in section 4 can explain it.**

### Minimum viable record — five fields beyond the automatic ones

Auto-capture: date, station, lat/lon, illumination, moonrise/moonset, hours above horizon, overnight cloud (ERA5 or NWS), predicted tide at shooting light, temperature, wind, pressure trend.

**You must type these five, or the log is unanalyzable:**
1. **Hours in the blind** (start time, end time). Without this you have a hunter-day denominator and the effort confound is unfixable.
2. **Party size** (birds per hunter-hour is the unit; birds per trip is not).
3. **Birds bagged, by species.**
4. **Birds *seen* / flights worked** — separates "no birds present" from "birds present, not flying."
5. **Whether you quit early, and why.** Expectancy bias is measurable only if you record it.

Optional but high-value: whether you used a light setting up (tests confounder #4's dark-morning disturbance), and moon altitude at legal light (auto-computed).

### The honest power arithmetic — say this before you start, not after

Full±2 and new±2 each cover 5/29.53 = **16.9%** of days. Over an Oct 15–Jan 31 window (~3.4 lunations) that is ~17 days per arm, ~14.6 after Maryland's Sunday closure. If you hunt half of available mornings: **~7 hunts per arm per season.**

- **One season is not a test.** Seven per arm detects nothing short of a catastrophe.
- **Ten seasons at one site** (~140 vs 140 hunt-days) with ducks/hunter ≈ 1.9, SD ≈ 2 gives **MDE ≈ 0.47 ducks/hunter (~25%) at 80% power.**
- **A 400-hunt personal log over 10 years** gives ~50 per arm, **MDE ≈ 42%.**
- **A true 10% effect requires ~1,775 hunt-days per arm** — pooled across sites and seasons, not one person's log.

**So: if the claim is as strong as it is stated — "always sucks" — your own log can detect it in a decade. If it is 10%, you will never see it alone.** That asymmetry is itself the most useful thing the app can tell you.

### The sentence the app writes after one season

```
YOUR FIRST SEASON — MOON

Mornings after a full moon (±2 days):  6 hunts, 14.5 hours, 9 birds
                                        0.62 birds/hunter-hour
Mornings after a new moon (±2 days):   8 hunts, 19.0 hours, 14 birds
                                        0.74 birds/hunter-hour

Difference: −0.12 birds/hunter-hour.

This is 14 hunts.  At this sample size, the difference you would
need to see before it meant anything is roughly ±0.9 birds/hour.
You are nowhere near it.  This number is noise and will be
reported as noise until you have about 50 hunts on each side.

Tide, sky, weekday and week-of-season are held equal between
these two groups by construction — new moons are spring tides
too.  That is why this is the right comparison.  It is only the
count that is too small.

At your current rate: 2035.
```

### Test 2 — waxing vs waning gibbous, the only design that separates *your* mechanism from a *hunter-visibility* mechanism

At matched illumination 0.80–0.92 over the Blackwater window:

| | Waxing (n=58) | Waning (n=66) |
|---|---|---|
| Moon-hours in night | 10.69 | 10.53 |
| **Moon-hours in last 3 h before 07:00** | **0.16** | **3.00** |
| **Moon altitude at 07:00** | **−33.8°** | **+34.5°** |
| Dawn water level | +0.58 ft | +0.62 ft |

Matched illumination, matched total moonlight, dawn tide matched to **half an inch** — differing by **2.84 hours of pre-dawn moonlight** and 68° of altitude at shooting time. This isolates *"the birds fed out all night"* (equal in both arms) from *"the moon is lighting my blind at legal light"* (opposite). **This contrast has never been run in any taxon.** If it comes back positive, it is a finding worth publishing and it is not the mechanism you believe in — it is a mechanism about *you*.

### Test 3 — free sign-flip check

Run Test 1 at a site where springs put **high** water at dawn (Ocean City Inlet 8570283: HW at 07:57 on springs; Kiptopeke VA 8632200 the same). A tidal mechanism must reverse sign between Bishops Head and Ocean City. A photon mechanism must not. Costs one extra station's data.

---

## 7. WHAT WOULD CHANGE THE ANSWER

**Two findings would flip this, in either direction, and both are cheap.**

### 1. The hourly Dryad file, fitted in the dawn window — **the single highest-value action available**

Osborne et al.'s hourly deposit ([doi:10.5061/dryad.1ns1rn93p](https://doi.org/10.5061/dryad.1ns1rn93p), CC0) contains `minutes_sunrise`, a `moved >500 m` binary, and `HourlySkyConditions`. Regress P(moved >500 m) and step length in the **sunrise → sunrise+120 min** window on previous-night usable light, with bird and date-in-season fixed effects, restricted to hunting season. **A coefficient implying ≥25% reduction in dawn movement on bright clear mornings would move this from 12% to ~45% and would be the first real evidence the mechanism exists. A null there takes it to ~4%.** The data are public today. The 35 MB file is behind an AWS WAF that did not yield in ~20 attempts; an institutional network or a Dryad support email would get it in a day. This is a weekend of work.

### 2. Synchrony

Any evidence that the day/night activity alternation [Körner et al. 2016](https://kops.uni-konstanz.de/bitstreams/3d938f45-cbf0-49cf-ac67-0858b312d436/download) documented becomes **synchronized across individuals** under a common light signal. A population-level dead morning is structurally impossible without it. Its current absence (mean pairwise residual correlation **0.03** and **0.11**) is the quietest and strongest argument against the whole idea, and it is testable on any multi-bird accelerometer dataset — including Lameris's CC0 deposit ([doi:10.5061/dryad.gmsbcc2m7](https://doi.org/10.5061/dryad.gmsbcc2m7)), which also still contains the NCEP cloud data its authors collected and never modeled.

### Three more, in descending value

3. **The dataset that would actually answer your question does not exist in public — but it exists.** Illinois' daily check-station records were destroyed. California's are non-tidal. **MD DNR and Blackwater NWR reservation-hunt harvest records are hunt-day resolved with party size, tidal, and Atlantic Flyway** — the only such dataset in the country. That is one records request. If bright clear previous nights cost **>0.3 ducks/hunter** net of measured effort, with refuge × season-week × day-of-week fixed effects and a dawn tide-stage covariate, that is a real gate and you should build it.

4. **A free, hunting-free bird-side proxy:** eBird complete checklists 06:00–09:00 in Dorchester County, 2000–2025, full vs new, with duration and observer as covariates. Measures whether *birds fly* with no denominator games and no hunters involved.

5. **The late-season conditionality**, which is where practitioners concentrate the claim and where nobody has looked. DR. DUX (*"ESPECIALLY in the late season"*), Rick Hall (*"not much difference until the late season"*), and Lameris's finding that night foraging is a short-day/cold supplement all point the same direction. Split any test at the solstice.

---

**The bottom line for the build:** your belief is not disproven — it is *unmeasured at the link that matters*, and that is a genuine, publishable-quality hole in the literature, not a fudge. But the nearest evidence points the other way (more light → more activity, not less), the only direct estimate of the lagged effect is a zero with a ±9% CI, the one moon signal that does survive in ducks fires only when hunters are present, and on your marsh the moon controls 19 inches of water at shooting light. **Show the count. Show the base rate. Show the tide. Refuse the forecast, out loud, on the page.** That refusal is more defensible than any competitor's confident moon dial, and it is the only version of this card the record can carry.
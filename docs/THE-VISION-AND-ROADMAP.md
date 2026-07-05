# Duck Countdown — The Vision & Roadmap
### READ THIS FIRST. Every session opens here and continues. Do not start over.

> **North star (James, 2026-07-05):** *"If done right, this is a gift to our youth and anyone that wants to know where they stand."*
>
> *"It gives the imagination to the children and the awareness to the adults."*
>
> **BUILD FOR THE HUNTER; the kid gets wonder for free (James, 2026-07-05).** A kid won't use a data map — so DON'T build a kids' toy. Build the real, deep, operational instrument a *hunter* would actually open. The imagination for children comes from the tool being *true* (real river, real "who stood here," real sky the night they were born), never from dumbing it down. One product, two depths: the hunter *operates* the map (dots, triggers, fly-to, "when were conditions right here"); the kid *marvels* at the story layer riding on top (the card, the rhyme, the actual-there history). Realness IS the wonder. Simplify it and you lose both.

---

## THE VISION (approved 2026-07-05)

Duck Countdown is a **living map of the ground you're standing on** — not gas stations and IHOPs, but the real stuff: every layer of nature and human history that ever converged on that exact spot, stacked on one clock, back as far as anyone recorded. You open it in the morning and it tells you what your place is doing today and **what that rhymes with** — *"the last time the moon, the tide, and the weather lined up like this here was October 1961"* — and the answer is new tomorrow because the day is, and **every answer is built from recorded fact only, never a guess**, because weather can be forecast but history can only be kept. It's **full of triggers**, each firing against its own place's history, **filtered down to the few things worth seeing**, with **the odds always shown** so it never lies to you the way a horoscope does. It's for the hunter who wondered who else ever stood in that blind, and it's for the kids, so they can open it anywhere on Earth and feel they're the newest knot in a rope that runs back further than anyone remembers. **The honest window YouTube was never allowed to be.**

Duckcountdown is just the address. The idea is: *nature keeps a diary, and this is the first place reading all of it on the same page — honestly.*

---

## THE CORE ARCHITECTURE

**The one-sentence engine:** compare a place's present to its own history, and surface what's true, weird, or rhyming — with the odds attached. History defines the future — **as odds, not oracle.**

**The record vs. the trigger (the key insight, 2026-07-05):** The archive was step one — *record the unguessable*, because history can't be forecast, only kept. That's the embedding law, done. But a record with no trigger just sits there (a library with no librarian). The **trigger layer is the missing voice** — the mechanism that fires and surfaces. That's what we build now.

**A trigger =** a rule: *"when [condition, measured against THIS place's own history] is true, surface [this]."* Three flavors, all local, all fire on **history only** (never predictions):
- **Anomaly** — today is weird *for here* (deviation from this place's baseline).
- **Rhyme** — today matches a rare past *here* ("what does today rhyme with").
- **Convergence** — several domains weird *at once, same place*. **SHOWN visually on the map, NEVER summed into a score.** (Summing weighted domains into one number = the dead convergence predictor. Do not rebuild it.)

**Triggers are local + nested:** the baseline is local — weird-for-Virginia ≠ weird-for-Arizona. Triggers nest by geography (nation → state → county → station), each firing against its own history. **Full of triggers, filtered in presentation:** arm thousands, surface only the few that clear the bar. (Over-firing everything is what killed the old engine.)

**THE HONESTY LAWS (non-negotiable — these are the whole moat):**
1. **The denominator, always shown.** "This rhymed 4 times" is a lie; "4 of 6 dry springs, vs 1-in-10 random" is the truth. Every pattern carries its base rate + a control.
2. **No guessing.** Fire on recorded fact, never a forecast. History is the fuel because it can't be faked.
3. **Provenance on everything.** Every number traces to its source + what kind (measured / computed / reported / derived).
4. **Verification by cross-reference.** The archive checks itself — a reading that doesn't fit its neighbors is flagged (this also catches ingestion gaps).
5. **Never sum into a score.** Convergence is what the eye sees on the map, never a formula.
6. **No ads. No dopamine engineering.** The second it lies to hold attention, it becomes YouTube and loses the only thing that made it worth building.
7. **Location-AWARE, never location-TRACKING (James, 2026-07-05).** It needs to know where you stand — that's the whole point — but geolocation must be: client-side only (browser gives coords to answer "what's here," never sent to a server to store), coarsened (county-level is enough; never keep precise GPS), unstored + unlogged + unsold, and no account/login/identity required. Location is a *question answered in the moment, then forgotten* — the exact opposite of Google knowing everywhere you've been. A user can also just TYPE a place instead. The honest window cannot be a surveillance window.

---

## THE TRIGGER MECHANISM — how it actually works (2026-07-05)

**The reframe:** you don't "trigger" individual embedded rows. Data plays two roles:
- **Historical embedded rows = the BASELINE.** The memory, the judge. They don't fire — they're what you compare *against.*
- **Incoming (or any evaluated) reading = the defendant.** A trigger fires when a reading deviates from its place's own embedded history.

So "how do we trigger the 8M already embedded?" has two honest answers: (1) they ARE the baseline every trigger measures against; (2) the **embeddings themselves become the RHYME trigger** — vector search over the embedded corpus finds "days like this." That's the embeddings finally *doing work* — and it's exactly what the index rebuild unlocks.

**The three triggers, and how each uses the embedded data:**

1. **ANOMALY** ("weird for here") — Build a baseline table: per place (station/county/state) × per day-of-year (rolling window), the mean/std/percentiles of each variable, rolled up FROM the embedded history. Materialized, refreshed as data grows. Trigger = z-score of a reading vs its local baseline; |z| ≥ threshold fires. *No vector search — cheap SQL rollups. Works now.*

2. **RHYME** ("what does today rhyme with") — THE embeddings are the mechanism. A place-day's vector → nearest neighbors in the corpus = the days it rhymes with. *Structured version (moon/tide/temp match) works NOW (proven on VA data). Semantic "feels-like" version needs the index (tier-bump).* Denominator: how many days rhyme, what followed, vs a random control.

3. **CONVERGENCE** ("multiple domains weird at once, same place") — Fires when ≥2 anomaly triggers co-occur at one place-time. **SHOWN on the map (dots piling up), NEVER summed into a score.** Denominator: how often ≥N domains co-occur here for nothing.

**THE GATE (Rule #1 + trigger + "?") — James's design:** every row entering the gate:
1. **Gets EMBEDDED** (Rule #1, non-negotiable, never skipped, nothing ever deleted).
2. **Gets EVALUATED** against the baselines (anomaly? rhyme? convergence?).
3. **If it fires notably, opens a QUESTION** — a prospective claim stapled at ingest ("conditions like X just fired here — does outcome Y follow within N days?"), registered in the **court** (the existing KEEP claim/watch/grade system), watched, and graded honestly with the denominator. The "?" is the hypothesis attached at ingest time. Most rows fire nothing (ordinary — correct). The notable few become watched questions. This is how new data "enters with a trigger embedded with a question mark."

**RETROACTIVE BACKFILL (triggering the history):** a one-time pass computes anomaly + rhyme + convergence for every historical place-day against the rest of history. Result: any date's page shows its triggers, the precedent library is pre-built, and the trigger logic is validated against known events. Bounded one-time job, then incremental for new data.

---

## THE DATA — a staircase, honest about every floor

Depth is **jagged, not a clean wall.** Build knowing each layer's floor:
- **Moon / tide / sun / season** — computable to ANY date, past or future. Infinite depth, zero gaps, free. It's math. *(The moon is a perfect BASELINE, never a trigger-as-oracle — proven dead as a predictor 2026-07-05.)*
- **Instrumental weather (GHCN)** — solid ~1880s, a few stations older, sparse before.
- **Rivers, earthquakes** — ~1900+.
- **Nature-timing (birds/blooms/fish)** — mostly recent; a few deep spines (CBC 1900, cloned lilac 1956, crop progress 1979).
- **Before instruments** — proxy only (tree rings, ice cores), century-coarse.

**Gap-free is a VERIFICATION problem, not a pulling problem.** Data mostly exists; gaps come from piecemeal ingestion silently failing (storm-events post-2016, GHCN truncation — happened here). The fix, per domain:
1. Pull the **authoritative bulk archive** (NCEI GHCN bulk tarball, Storm Events yearly CSVs, CO-OPS tides, USGS water) — NOT day-by-day API. Bulk = complete by construction.
2. Ingest all, embed per the law.
3. **Coverage audit:** rows-per-year, per-place. A dip below neighbors = a hole. Refill. Re-audit on a schedule (silent failures recur).
4. Live crons keep the recent edge; audit the seam where live meets historical.

**Highest-leverage nature-data to add** (from the 2026-07-04 gettability scout, see `project_dcd_nature_data_gettability_map`): eBird EBD+SED, MODIS phenology, USDA Crop Progress, USFWS harvest microdata, USA-NPN cloned lilac. Honest ceiling: multi-state fish-bite + deep fall-color don't exist free; stay proxy/shallow there.

---

## THE MAP IS THE PRODUCT — how it must feel (James, 2026-07-05)

- **Globe first, then smaller and smaller and smaller.** It opens as a *planet* (MapLibre globe projection) and you fall into it — globe → country → state → county → the river, the blind, the corner. Zoom is the primary verb. Not a flat US map; a world you descend into.
- **The map IS the navigation, not just a display.** Everything is geo-anchored, and the map is how you *travel* between connected things. When a card says "this rhymes with the Delaware crossing," **clicking that bubble flies the map to the Delaware River.** Every rhyme, precedent, event, and anomaly is a *place you can fly to.* `map.flyTo()` is the connective tissue — the card and the map are one instrument, not two panels.
- **ACTUAL there — precise, real coordinates (James, emphatic).** Fly-to lands on the *real* place: the actual bend of the Delaware where Washington crossed, not a regional approximation. The map cannot lie about *where* any more than the data lies about *what*. Every geo-anchor is a true coordinate; when a layer only knows a county or state, the map SAYS so (labels its granularity) rather than faking a precise pin. Honesty of place = honesty of fact.
- **Deadline context:** James wants something viewable in 24–48h (target ~2026-07-06/07). Prioritize a real, alive, globe-to-ground map with at least one true data layer (earthquakes = deep + point) and the fly-to navigation feel.

---

## BUILD RULES (James, 2026-07-05 — how we build, every session)

1. **Verify everything in Chrome, on the live site** — desktop AND 375px. Build-passing ≠ looks-right. Verify at meaningful increments (not every micro-change, but throughout — "you catch my drift").
2. **Interactive, but not a game** — genuinely explorable and alive (click, zoom, drill, pan), not gamified and not a dead dashboard. Palantir-feel: operational, you can dig, it rewards curiosity.
3. **Cross-agent verification** — every agent's work gets checked by other agents (adversarial peer review) so the build stays correct.
4. **NEVER touch the database** — the build is READ-ONLY on the archive. No writes, no DDL, no migrations, no deletes during the build. Nothing fucks with the 8M rows. (DB changes like the index rebuild are separate, deliberate, James-gated.)
5. **Run scouts/idea-machines concurrently** — while building, research more data + what else we need to make it better.
6. **Build it as a shell meant to be built upon** — extensible foundation, not over-built. Rung 1 is a skeleton designed for everything above it to bolt on.

---

## THE BUILD RUNGS (sequence — first 4 need NOTHING from anyone)

1. **The map.** MapLibre GL + free tiles (no token, no Mapbox baggage — that was deleted). US, zoomable state → county → station. The home surface. *Unblocked.*
2. **Anomaly dots.** For every point with deep history (weather stations, river/tide gauges, quakes), compute today vs that spot's own history → deviation = the dot. Start with weather (deepest baseline, point-resolved → granular). NO weights, dots stay separate. *Unblocked.*
3. **Click a dot → the dossier card.** What's here now + this day in this spot's history. (Prototyped 2026-07-05: the JFK card + the "tonight-like-this" VA card — both artifacts.) *Unblocked.*
4. **Granular drill-down.** State → county → station, Post Office style. Deep layers shatter into sub-dots; shallow layers stay coarse and SAY so. *Unblocked.*
5. **Precedent / rhyme layer** — "the last times this spot looked like this, here's what followed," with the denominator. *NEEDS the vector index (see Blocked).* Structured version already PROVEN (moon+tide+temp match, VA, 2026-07-05).
6. **Events / human layer** — Capone hunted here, presidents proposed there, burial grounds. The "who." *NEEDS a significance dataset ingested (find-more).*

**Daily retention trigger:** *"What does today rhyme with?"* — self-refreshing forever (the Earth makes a new day daily → new answer daily), personal (your coordinates), places you in time. The astrology hook, but TRUE. Buildable now (structured), better with the index.

---

## STATUS — what's done, proven, blocked (as of 2026-07-05)

**DONE / PROVEN:**
- The archive: ~8M embedded rows, one clock, state-resolved. The hard foundation — behind us.
- **Dead convergence predictor DEMOLISHED tonight** (Lanes A/B/C/D shipped + verified; commits through `788a843`): scan trigger cut (~770 dead runs/day gone, A1 verified silent), 13 edge functions gutted of convergence, /ops pruned, 16 orphan frontend files deleted, build passes. Fixed live falsehoods (stale bird line, dead SWPC feed). Fixed /ops crash.
- Precedent engine proven on real data (VA moon+tide+temp → "last time was Oct 22 1961").
- The honest discipline validated: killed James's own 5-year moon theory on his own data (24,000 quakes = 1.01x; 49 major events = 1.02x; cosmic-risk-oracle was a confirmation engine, not a checker).

**BLOCKED (James's hands):**
- **IVFFlat index rebuild** = the tier-bump keystone. Parked migration `20260414100018_rebuild_ivfflat_for_7m.sql.PENDING_CONCURRENT` (rename to a `20260704+` prefix or `db push --include-all`; bump Supabase compute tier for the 2GB build, push in a low-traffic window ~30-60min, downgrade). Unblocks days-like-today + Rung 5. Vector search currently times out on the undersized index.

**PENDING DEMOLITION (finish anytime, low-traffic window):**
- **Lane E** — the cron unschedule migration (ready SQL in `docs/OVERHAUL-BLUEPRINT.md`; unschedules dead convergence crons, KEEPS correlation-engine).
- **Lane F** — delete the 8 dead convergence function dirs (only AFTER A1 verified — it is — and E applied).
- See `docs/OVERHAUL-BLUEPRINT.md` for the full adversarially-verified cut list, and `docs/OVERHAUL-PLAN.md` for keep/rip/rebuild.

---

## WHERE WE STOPPED / NEXT MOVE

**Next: build Rung 1 — the map.** MapLibre GL, free tiles, US, zoomable to county. Then Rung 2 (weather-anomaly dots) wired to the trigger logic. The first four rungs need no tier bump and no new data — they run on the archive as-is.

Then, when James does the tier bump: apply the index rebuild → Rung 5 (precedent layer) lights up.
Then: ingest the events layer → Rung 6 (the human "who").
Ongoing: bulk-backfill + coverage-audit each domain toward gap-free (staircase-honest).

**The proofs to show anyone (or your future self):** the JFK date-dossier artifact, and the "tonight-like-this" VA daily card. Both real data, both honest, both built 2026-07-05. That's the product, small. The map is the same thing, alive.

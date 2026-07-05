# Duck Countdown — The Overhaul

> James, 2026-07-04: **Keep the data. Make it work. Find more.**

The founding thesis (a convergence score that *predicts* strange days) is dead —
proven four independent ways (matched-control, gradient, reformulation, a
2,304-rule mining sweep with a passing positive control). The machine that
collects the data is alive and healthy. The surface is still built around the
corpse. This is not a rewrite. It's finishing the pivot the 07-02 redesign
started, and committing: keep the bones, cut the dead flesh, build the card.

The product, in one image: **an index card for everywhere you stand.** Top half
= total recall (everything that was ever true here, on this day). Bottom half =
honest precedents (the last times it looked like this, *with the base rate
shown*). Never a forecast. Memory, geolocated, delivered at the spot.

---

## 1. KEEP THE DATA (the bones — never touch)

These took months and cannot be rebuilt in a weekend. They are the asset.

- **`hunt_knowledge`** — 7,985,692 embedded rows, state × date, 512-dim Voyage vectors. Irreplaceable.
- **The ingestion crons** — 41 healthy, ~5,300 embeddings/day, self-running through 11-week dormancy. Data collection never breaks.
- **The Embedding Law** — everything that enters gets embedded → cross-referenceable forever. This is the constitution. It stays.
- **The chat / `hunt-dispatcher`** — the one surface that already works; answers any date better than an hour of Googling.
- **The court harness** — the honesty machine (register a falsifiable claim, grade it against matched controls). This IS the "show the denominator" discipline the card needs.

## 2. MAKE IT WORK (cut the dead flesh, then build the card)

### Step 0 — the keystone (manual, James's hands): rebuild the vector index
Every card mechanic sits on vector search, which currently **times out** (index
sized for ~2M, table is 8M). Nothing downstream works until this lands.
- Bump the Supabase compute tier one notch in the dashboard (for the 2GB build RAM).
- `mv supabase/migrations/20260414100018_rebuild_ivfflat_for_7m.sql.PENDING_CONCURRENT supabase/migrations/20260414100018_rebuild_ivfflat_for_7m.sql`
- `npx supabase db push` in a low-traffic window (~30–60 min, ingestion crons fail during the lock — acceptable).
- Downgrade the tier after. Cost: a few dollars.
- The instant it lands, `hunt-days-like-today` self-activates. Re-test: `curl .../hunt-days-like-today?state=MD` → expect `degraded:false` + real precedents.

### Cut the dead predictor
- **`hunt-convergence-scan`** — ~690 runs/day, biggest recurring cost, feeds only the dead layer. Kill it (one focused pass first: a couple of cards still reference its vocabulary — repoint or remove those, then unschedule).
- **The convergence engine + 8-component scoring + compound-risk alerts** — remove the scoring paths and the "N domains converging" vocabulary.
- **Legacy frontend** — `/dashboard`, `/map`, `/intelligence`, the 25-panel Mapbox workbench. Serves the old paradigm; deleting it also drops the heavy Mapbox + recharts weight.

### Build the card (post-index)
- Promote **`days-like-today`** from side card to the core mechanic.
- **Total recall panel** — everything true at a place+date, one card.
- **The denominator, always shown** — every precedent carries "happened N of M times," and a random-pair control beside it. This is the whole moat; it is non-negotiable on every string.

## 3. FIND MORE (deepen the layers — unblocked, starts now)

Weather got instrumented; nature's *timing* mostly didn't. The card is only as
tall as the history behind it. From the 2026-07-04 gettability scout, ranked by
leverage (all free, all join on state × date against the existing deep archive):

1. **eBird EBD + SED** — per-species arrival timing, point-precise, 2002+. Gated on a Cornell request (`docs/EBD-REQUEST.md`) — **submit today, it's the weeks-long long pole.**
2. **MODIS phenology (MCD12Q2)** — green-up AND leaf-drop dates, CONUS-complete, 2001+. One Earth Engine pull. The fall-leaf layer.
3. **USDA NASS Crop Progress** — weekly bloom/harvest %, by state, **1979+ (45 yr)**. Free API key, no gate. Deepest easy pull — **the recommended first win.**
4. **USFWS HIP harvest microdata** — date+county duck passage ~60 yr. Gated (email BMDM), season-confounded, uniquely deep.
5. **USA-NPN cloned lilac** (`rnpn`) — observed spring bloom **1956–2014**, non-circular green-up spine.

**Honest ceiling** (don't oversell): spring green-up + bird migration rhyme
across states for real (~25 yr deep, some spines to 1900). Multi-state fish-bite
and deep fall-color **do not exist free** — fish stays a hydrology/bird proxy,
fall-color stops at ~2001. Ship the real depth; never promise grandpa-era leaves.

**The trap to refuse:** SI-x spring indices and almanac "peak color" archives
look century-deep but are *temperature models* — circular against our own
weather. Never use them as independent nature evidence.

---

## Sequencing

- **Now, unblocked:** submit the eBird request; start NASS Crop Progress ingestion (embedded per the Law); the convergence-scan cut-pass.
- **Step 0 (James):** tier bump + index push → card mechanics wake up.
- **After the index:** delete legacy frontend, build the card surface, wire days-like-today + the denominator.
- **Ongoing:** one gettable source at a time, each embedded, each with its base rate.

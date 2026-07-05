# THE WEEK — one goal, judged 2026-07-12

> **Every session this week opens here.** This is the single source of truth for the sprint. Read this, read the STATE LOG at the bottom, do the next unchecked thing. Do not re-derive, do not re-plan, do not add scope (see PARK LIST).

## THE GOAL

**In one week, Duck Countdown is the honest memory of American ground in one complete vertical: open it, fall into your state, and it tells you — beautifully — what today is here, what it rhymes with, what followed those days, and what happened on this ground across recorded time. Every sentence traceable to a row. Zero known lies.**

**Judgment day: Saturday 2026-07-12.** James, phone, ten minutes. Verdicts: CONTINUE (it's the vision, keep building) / PIVOT (named change of direction) / SHELF (deliberate, documented, not a fade-out). No fourth option, no extension.

**The spec: Apple front, Palantir back.** Apple = restraint, typography, motion, one true sentence per screen, inevitable on a phone. Palantir = data that survives interrogation — deep, deduped, provenance on everything, rewards digging, never lies.

## THE FIVE ACCEPTANCE TESTS (day 7 = these, not vibes)

1. **TRUTH** — re-run the five-date test (Katrina 2005-08-29, Sandy 2012-10-29, Uri 2021-02-15, Sept-11 2001, Ridgecrest 2019-07-05) per `docs/HORSE-RIDE-SCORECARD.md` methodology: **zero CONTRADICTS**. (Baseline: 30 match / 11 close / 4 contradict.)
2. **PHONE** — descent + dossier at 375px feels Apple-built. Ten minutes, no cringe.
3. **MORNING** — the Morning Line reads true, specific, and new each day (7 mornings published by day 7).
4. **KID** — type a birthday + place, get wonder that is entirely real (Night You Were Born, proving ground at minimum).
5. **CALLED SHOT** — PA precedent claim of 2026-07-05 ("all 4 lineup precedents cooled within 2–4 days") resolves this week and the product SHOWS itself being graded, win or lose.

## THE PROVING GROUND: VIRGINIA

Depth-first, not breadth-first. VA goes ALL the way down this week: station-level baselines, county bloom, stitched events, tide gauge (Sewells Point), the full vision at full depth. All other states stay state-level and say so honestly. **Day-7 judgment happens at the proving ground.** Replication to 49 states is mechanical once one place is true.

## THE ROW CONTRACT (decided 2026-07-05 — all re-ingests conform; do not re-ingest without these)

- `metadata.source_event_id` — NCEI event_id / USGS event id / station+date. **Dedup key. Unique per source.** Idempotent upserts on it.
- `metadata.event_time_utc` — full UTC timestamp when the source has one (quakes MUST). Never infer sequence (fore/aft) from date alone.
- `metadata.damage_usd`, `deaths`, `injuries` — parsed NUMERIC at ingest ("750M" → 750000000). Casualty fields never silently zeroed.
- `metadata.provenance_url` — every row. No receipt, no row.
- `metadata.granularity` — point | county | state | national. The map labels it; the map may never fake precision.
- Embedding law unchanged: every row → Voyage (≤20/batch) → hunt_knowledge.
- **Product law (from horse-ride test): the surface may say "the archive holds N" — it may NEVER say "there were only N."**

## PIPE QUEUE (ONE write pipe at a time — Supabase Pro IO budget)

| # | Pipe | Status | Notes |
|---|------|--------|-------|
| 0 | OTD events (366 days) | ✅ DONE 2026-07-05 | 19,665 rows, 110 unusable, idempotent |
| 1 | ComCat quakes re-ingest | NEXT | M4.5+ US 1900→now, uncapped, event_time_utc, dedup on USGS id. Kills the inverted-foreshock lie + zero-M7 hole |
| 2 | NCEI Storm Events re-ingest | QUEUED | 1950→now bulk CSVs, ALL event types, casualties+damage numeric, dedup on event_id. Existing dupes/triplicates: mark-and-supersede, never delete blind |
| 3 | Tide roster + daily-MAX residual | QUEUED | Add Battery, Sandy Hook, Kings Point, New London, Grand Isle, Bay Waveland, Dauphin Island; store daily max alongside mean |
| 4 | Buoy pressure (BAR column) | QUEUED | One-line ingest fix + backfill the horse-ride buoys |
| 5 | Full stitch pass | QUEUED (after 1–2) | ~2,500 named events, ~$50–90 LLM + $0.02 embed. `npx tsx scripts/event-stitcher.ts --full` then `--commit`. **Requires clean deduped data — never run on pipe-2-dirty rows** |
| 6 | VA station-level baselines | QUEUED | Proving-ground depth: per-station × day-of-year rollups |
| 7 | Curated 30 (gap report) | QUEUED | Hand-verified July-5 misses as curated-event rows |

## JAMES'S TWO MOVES (blocking, his hands only)

- [ ] **INDEX TIER-BUMP — by Sunday night 2026-07-06 or semantic rhyme misses the week.** Bump Supabase compute tier → rename/push migration `20260414100018_rebuild_ivfflat_for_7m.sql.PENDING_CONCURRENT` (or `db push --include-all`) in a low-traffic window (~30–60 min, locks hunt_knowledge writes; pause crons? no — window it) → downgrade tier. Unlocks: semantic "days like this," Rung 5, the embeddings finally doing work.
- [x] **Stitch spend approval (~$50–90)** — implicitly approved by "do what you think is best"; fires automatically after pipe 2. Flag here if retracted.

## DAY-BY-DAY

- **D1 Sat 07-05:** THE-WEEK.md committed. Row contract locked. Pipe 1 (ComCat) built+run. Morning Line v1 built + publishes its first line TODAY. NCEI pipe built (runs D2).
- **D2 Sun 07-06:** Pipe 2 (NCEI) runs + dedup pass. James: tier-bump. Pipes 3–4. Morning Line day 2 publishes.
- **D3 Mon 07-07:** Five-date test re-run #1 (expect big score jump; fix stragglers). Full stitch fires. Semantic rhyme wired into dossier (needs index).
- **D4 Tue 07-08:** VA proving-ground depth: station baselines, county bloom (real TopoJSON counties, storm ledger shading), stitched events surface on VA.
- **D5 Wed 07-09:** APPLE PASS day 1: design-system sweep of atlas + dossier (type scale, spacing, motion timing, color discipline per dataviz skill), Night You Were Born v1.
- **D6 Thu 07-10:** APPLE PASS day 2: mobile 375px end-to-end, first-tap hydration bug dead, load performance, empty/error states all honest. Freeze.
- **D7 Fri 07-11:** Full five-test dry run by Claude. Fix only what fails. No new anything.
- **JUDGMENT Sat 07-12:** James, phone, ten minutes, verdict.

## PARK LIST (ideas wait here; nothing enters the build this week)

- Fetch-on-miss hybrid gate (query miss → whitelisted-source fetch → verify → gate → embed). Designed, good, POST-WEEK. Trust rule decided: authoritative APIs only, provenance stamped, open-web shown-not-embedded.
- WebGL globe / MapLibre return. County bloom for 49 non-VA states. NCEI pre-1990 tornado CSVs (1950–89). Chronicling America receipt-puller. Phenology recurring layer. NWS alert archive via IEM (1986+). Station-level GHCN top-200 metros. eBird EBD ingest. AI narrative voice ("tell me the story" button). Monetization/accounts/sharing.

## RISK REGISTER

- **IO budget:** one write pipe at a time, watch Supabase dashboard during pipes, overnight the big ones.
- **Tier-bump slips:** if not done by D2 night, D3+ semantic items degrade to structured rhyme only — the week survives but test 3/4 get weaker. Escalate to James daily.
- **NCEI dedup risk:** existing rows have dupes AND real-lookalikes (Cass County IN). Supersede-don't-delete; keep old rows tagged `superseded=true` until verified, then archive decision post-week.
- **Vercel/edge staleness:** after every function deploy, curl-verify before Chrome-verify (stale edge bundles burned us D0).
- **Browser verify:** every UI ship gets live Chrome check desktop + 375px. tsc is not sufficient; build-passing ≠ looks-right.

## SESSION PICKUP PROTOCOL

1. Read this file top to bottom. 2. Read the STATE LOG below — last entry = where we are. 3. Do the next unchecked thing in DAY-BY-DAY / PIPE QUEUE. 4. One write pipe at a time. 5. Ship → verify live → append a STATE LOG entry (date, what shipped, what's verified, what's next). 6. Never add scope; append ideas to PARK LIST.

---

## STATE LOG (append-only)

**2026-07-05 ~10:30 — D1 opens.** Doc committed. Prior 24h (see git log + docs/): Double Fall items 1–4 live (1961 Card, Descent+Sonar, date context+What Followed+control, live-alert layer) all Chrome-verified; OTD pipe DONE (19,665 events); stitcher proven (Boundary Waters + 2012 derecho named from raw rows, staged not committed); prior-art landscape (nobody above 6/10) + horse-ride scorecard (30/49 exact, 4 contradictions, catastrophe-blindness diagnosed) committed. Known bugs: first-tap hydration on /atlas (D6). Next: ComCat pipe + Morning Line (dispatched), NCEI pipe build.

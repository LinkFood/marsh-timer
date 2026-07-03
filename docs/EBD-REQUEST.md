# eBird Basic Dataset (EBD) — Access Request

**Why this exists:** The duck–front test (`scripts/experiments/duck-front-test.ts`)
can only run as a crude *placebo screen* on the ~1 live season of effort-confounded,
all-birds eBird snapshots the brain happens to hold. It **cannot answer** the
founding-fact question, because the brain never stored the effort-corrected,
waterfowl-isolated daily density the question requires. The **EBD is the long-pole
dependency** — free, but gated on a Cornell access request + data-use agreement
that takes **days to weeks** to approve. **Submit this today, in parallel with the
MVE.** Even if the MVE is null (likely, given n=1 + effort confound + aggregation
smear), the EBD is the only path that distinguishes "no mechanism" from "we
couldn't see it."

---

## Where to submit

1. Go to **https://ebird.org/data/download** (sign in with the Cornell Lab /
   eBird account — the same login used for the eBird API key).
2. Click **"eBird Basic Dataset (EBD)"** → **Request Access**. This lands on the
   **data access request form** (a short application: name, affiliation, intended
   use). Individuals are routinely granted; approval is typically days.
3. After approval, use the **Custom Download** tool to build a **filtered** export
   (the full global EBD is 100+ GB — filtering is mandatory). Request the two
   files below together.
4. On the same page, tick **"Include sampling event data"** so the companion
   **Sampling Event Data (SED)** is delivered alongside the observations — this is
   the file that carries effort (see §"Why the SED is non-negotiable").

---

## What to request (Custom Download filters)

**File 1 — EBD observations (the birds):**

| Filter | Value |
|--------|-------|
| **Taxonomy** | **Order: Anseriformes** (ducks, geese, swans — the whole waterfowl order) |
| **Region** | The flyway-representative states below (add more if the tool allows without ballooning size) |
| **Date range** | **2000-01-01 → 2026-12-31** (~26 years — escapes the n=1 trap; older years thin, fine to keep) |
| **Format** | Tab-separated (TSV), the default EBD format |

**File 2 — Sampling Event Data (SED, the effort):** same region + date filters,
delivered as the checklist-level companion file (one row per checklist).

### States to request

Cover all four flyways with a couple of dense states each (matches the MVE's
`STATE_FLYWAY` map; expand later if power is thin):

| Flyway | States (postal) |
|--------|-----------------|
| **Central** | KS, NE, TX |
| **Mississippi** | AR, MO, LA |
| **Atlantic** | MD, NC |
| **Pacific** | CA, OR |

That is **10 states × Anseriformes × 26 years ≈ a few GB of TSV** — large but
stream-parseable, never load whole. (If the download tool caps region count,
split into per-flyway requests and concatenate locally.)

---

## Why the SED is non-negotiable (the effort confound)

Raw eBird counts track **birder activity, not birds**. A cold front clears the
sky → pleasant day → more checklists submitted → more ducks "counted." That
manufactures a front→pulse correlation that is pure observer behavior **and is
temporally aligned with fronts** — the single worst confound in the whole test
(postmortem checklist item #1). The only real fix is **birds per party-hour**,
which requires the SED effort fields:

| SED field | Use |
|-----------|-----|
| `DURATION MINUTES` | party-hours denominator |
| `EFFORT DISTANCE KM` | traveling-count normalization |
| `NUMBER OBSERVERS` | party size |
| `ALL SPECIES REPORTED` | keep only complete checklists (the "1" = a true zero when a species is absent) |
| `SAMPLING EVENT IDENTIFIER` | join key back to the EBD observation rows |

Pipeline (per the scope doc §4): stream-parse the EBD TSV, join checklist obs →
SED on the sampling-event id, keep complete checklists, compute per-checklist
waterfowl density = birds / party-hour, aggregate to **state-day effort-corrected
density**. That series is what finally makes the placebo-first test powered across
20+ fall seasons with month fixed effects.

---

## Required citation & access-agreement notes

- **Data-use agreement:** accepting the EBD terms is required to download. It is
  **free** but binds us to the citation and no-redistribution terms. Read and
  accept in the request form.
- **Do not redistribute the raw EBD/SED files.** Derived, aggregated products
  (our state-day density series, embeddings in `hunt_knowledge`) are fine to keep
  internally; the raw TSVs stay local and uncommitted.
- **Citation (put this in the repo + any write-up), fill in the release version
  and download month shown on the download page:**

  > eBird Basic Dataset. Version: EBD_relMMM-YYYY. Cornell Lab of Ornithology,
  > Ithaca, New York. Downloaded [MONTH YEAR].

  (eBird releases the EBD monthly; the version string, e.g. `EBD_relNov-2026`, is
  printed on the download page — copy it verbatim.)
- **Recommended acknowledgement:** "We thank the eBird program at the Cornell Lab
  of Ornithology and its global network of participants for the data."

---

## After the download lands (handoff to the full build)

Not part of this request — logged so the thread is clear. Per scope doc §4:

1. `scripts/ingest-ebd-waterfowl.ts` — stream-parse TSV, join SED, compute
   state-day effort-corrected waterfowl density (GB-scale local temp storage,
   never load whole).
2. Land the series: a `hunt_waterfowl_density` table (1 migration) **and** embed
   each state-day summary → `hunt_knowledge` (new `content_type` e.g.
   `waterfowl-density-daily`) per the Embedding Law.
3. Deep-window fronts: ghcn-daily's 76 years (temp-drop + precip proxy) finally
   become usable, cross-checked against Open-Meteo pressure/wind for overlap years.
   Prereq: finish the ghcn SC–WY backfill (REACTIVATION-RUNBOOK Step 2).
4. Re-run `duck-front-test.ts` (extend it, or `duck-front-test-full.ts`) across
   20+ fall seasons, placebo-first, with month fixed effects and per-flyway front
   timing. **This is the only version that can actually answer the question.**

**Constraint check:** EBD is a new *data source* but **not** a new runtime
dependency — a one-time download processed by a local script with existing keys
(Voyage for embedding). No new API/library/service in the running system. The
only true new dependency is the free Cornell data-use agreement.

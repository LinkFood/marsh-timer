# THE SITE BLUEPRINT — 2026-07-17

> James, tonight: *"What's the point of having all this really cool fucking data if there's no
> way to query it, look at it, show it, present it? The website's a fucking mess."*
>
> This document is the information architecture that turns fourteen accreted rooms into the
> living almanac. Grounded in: `docs/POSITIONING.md` (identity), `docs/ALMANAC-1950-PRIMARY-READ.md`
> (the form's five insights), `docs/ALMANAC-MODERN-READ-2026-07-17.md` + `ALMANAC-2026-PRINT-TRIANGULATION.md`
> (what the incumbents converged on + the open flanks), `docs/THE-WEEK.md` 07-16/17 (Formation
> Layer live, /plant shipped, gate-1 lineup retirement), and a live-screenshot walk of every
> route at 375×812 on 2026-07-17 ~02:20 ET. Judged with eyes.
>
> **Timebox law governs everything below.** Gates 1 and 2 are FAILED (lineup lane dead by its
> own registration; fusion metric invalid final). Gate 3 — the museum-face front door posted
> publicly, 100 external visitors / 10 returning by 08-10 — is the last live gate. **This
> blueprint IS gate-3 work**: a stranger who lands must meet one coherent, honest, queryable
> almanac, not two products stapled together. Everything past the STOP line waits for the box
> to open.

---

## 0. What the eyes actually saw (the mess, itemized)

Screenshots (375×812, live prod, 02:20 ET): `/`, `/welcome`, `/atlas`, `/morning`, `/born`,
`/court`, `/board/uri`, `/plant`, `/explore`, `/date/2026-07-10`, `/state/MD`, `/cascade`.

1. **TWO PRODUCTS ARE LIVE AT ONCE.** Seven surfaces (`/`, `/atlas`, `/morning`, `/born`,
   `/plant`, `/board`, `/court`) share the InnerNav idiom — small-caps ribbon, quiet doors
   footer, Playfair-over-black, no chrome. Four surfaces (`/explore`, `/date`, `/state`,
   `/cascade`) still wear the convergence-era explorer chrome — serif top bar, user avatar,
   and a **five-tab bottom bar (TODAY / MORNING / ATLAS / ARCHIVE / COURT)** that doesn't
   agree with the doors footer about what the site's rooms even are. A stranger crossing from
   `/morning` to `/date` changes products mid-stride.
2. **The front-door porch had grown a 14-line run-on hero** — every corroborated extreme,
   forming watch, and variety clause concatenated into one Playfair sentence filling the whole
   first viewport, board pushed below the fold. **Fixed minutes after the screenshots**
   (dc9ea79, 02:23 — one clause leads, the rest is a strip). Noted here as the pattern to
   guard: the Formation Layer will keep growing clauses; the porch grammar must shard, never
   concatenate (the 1950 sharded-poem lesson).
3. **`/morning` still renders the retired lineup sentence** ("The moon, the tide, and the
   temperature have never lined up like this here in 73 recorded years") — gate 1 executed
   tonight; surgery is dispatched and in flight (state log 07-17 ~night). This blueprint does
   not re-scope that surgery; it seats its court exhibit (§4, Court).
4. **`/date` violates its own receipts law by ugliness**: the Fire block renders raw row IDs
   as titles — `fire-{C12BFCD9-62EE-42D7-A015-FC8B8BFA0793}-2026-07-17` — and 07-17-keyed
   perimeter rows surface on the 07-10 page (wildfire-perimeter lane keys by scrape-day, and
   the mapper falls back to the raw `title` column). The museum's front hall shows the visitor
   a UUID. This is the single worst wart a gate-3 stranger will meet.
5. **`/state/:s` is a loading shell** — "Loading Maryland profile…" over four canned AI-prompt
   chips, in the legacy chrome. It duplicates what the atlas descent already does better.
6. **`/welcome` is a second front door** — the old HomeLanding (Uri film hero + doors),
   superseded by ConceptA at `/`. Two identities, same thesis line, different bodies.
7. **`/` is served by `src/pages/concepts/ConceptA.tsx`** — the shipped front door still lives
   in the concepts scaffolding directory next to two rejected grammars (B, C) and a
   "fork in the road for James's eye" index page, all still routed and public.
8. **No state choice follows you.** `/plant` has its own `<select>` (defaults Maryland),
   `/explore` its own state chip (defaults TX), `/atlas` starts national every visit,
   `/morning` picks whatever state has the day's deepest anomaly, `/born` asks fresh every
   time. Five rooms, five different answers to "where do you stand?" — the exact problem the
   1950 key-letter system solved with one correction fitted to every row.
9. **The good news the eyes also confirmed:** the InnerNav seven are genuinely coherent and
   handsome; `/plant` is the first true almanac chapter (distribution-first, honesty rendered);
   `/court` reads as the docket it claims to be; the atlas map + descent works; `/explore`'s
   daily panel (weather sentence, migration count with sparkline, moon phase + solunar feed
   window, tile map) contains exactly the furniture the TODAY page needs — it's the right
   organs in the wrong body.

Route-inventory correction for the record: **the legacy `/dashboard`, `/map`, `/intelligence`,
`/now`, `/report` routes named in CLAUDE.md no longer exist** — the router (src/App.tsx) has
no trace and no page files remain. They were already demolished; CLAUDE.md's frontend section
is stale and should be updated when CLAUDE.md is next touched (it still describes the
chat-first ExplorerLanding as `/`).

---

## 1. PAGE INVENTORY — verdict per route

| Route | File | What it is today | Verdict | What breaks / migration |
|---|---|---|---|---|
| `/` | concepts/ConceptA.tsx | The One Room: identity, porch sentence, live board, rhyme, ledger of days | **KEEP — becomes TODAY** (§2). Promote file out of concepts/ to `pages/TodayPage.tsx` | Nothing; route unchanged |
| `/welcome` | HomeLanding.tsx | Old front door (Uri film hero + 4 doors) | **KILL** | Old shared links → 301-style redirect `/welcome` → `/`. Nothing else references it (router only) |
| `/explore` | ExplorerLanding.tsx | Chat-first explorer, legacy chrome, own state chip + bottom tabs | **MERGE → reborn as `/ask`** (§3). `/explore` redirects | The chat pipeline (useChat → hunt-dispatcher) survives whole; the daily-panel organs (moon/solunar/migration blocks) transplant to TODAY; legacy chrome dies |
| `/date/:d` | DatePage.tsx | Any-date archive receipts, legacy chrome, UUID warts | **KEEP — the museum's main hall.** Reskin to InnerNav, fix warts | Bottom-tab nav dies with the chrome; doors footer replaces it |
| `/state/:s` | StatePage.tsx | AI-profile loading shell, legacy chrome | **KILL** | Redirect `/state/XX` → `/atlas?state=XX` (the descent already IS the state page). The four canned prompts move to /ask's suggestion row |
| `/court` | CourtPage.tsx | The docket: registered claims, grades, killed-index monument | **KEEP.** Add the lineup retirement as the newest exhibit (§4) | — |
| `/cascade` | CascadeIndexPage.tsx | Strangest Days index (2 replays) | **KEEP — museum wing.** Reskin to InnerNav | Bottom tabs die; doors footer replaces |
| `/cascade/july-2026-heat` | CascadePage.tsx | Verified replay #1 | **KEEP** (reskin with parent) | — |
| `/cascade/sept-2020-whiplash` | CascadeSept2020Page.tsx | Verified replay #2 | **KEEP** (reskin with parent) | — |
| `/ops` | OpsPage.tsx | Internal cron/brain health dashboard | **KEEP — unlisted.** Never in nav; it's the boiler room | — |
| `/atlas` | AtlasPage.tsx | The ground, state descent, dossier | **KEEP** — reads your-ground on arrival (§2) | — |
| `/morning`, `/morning/:date` | MorningPage.tsx | The daily line, graded, permanent URLs | **KEEP** (lineup surgery in flight, owned elsewhere) | — |
| `/born` | BornPage.tsx | Birthday → atlas dossier | **KEEP — museum wing** | — |
| `/board/:story` | BoardPage.tsx | Storm films (uri, sandy) | **KEEP — museum wing** | — |
| `/plant` | PlantPage.tsx | Frost-distribution planting table | **KEEP — first chapter.** Adopts your-ground (§2) | Its private `<select>` becomes the shared ground picker |
| `/concepts` | ConceptsIndex.tsx | Fork-in-the-road index | **KILL** | Nothing — scaffolding. Delete route + file |
| `/concepts/a` | ConceptA.tsx | Duplicate mount of `/` | **KILL route** (file promoted to `/`) | Nothing |
| `/concepts/b`, `/concepts/c` | ConceptB/C.tsx | Rejected grammars (film-only, braid) | **KILL** | Nothing imports them; boardPlayer lib is shared and stays |
| `/auth` | Auth.tsx | Google OAuth for chat | **KEEP — unlisted** | — |
| `/dashboard` `/map` `/intelligence` `/now` `/report` | — | Already deleted from router + disk | **ALREADY DEAD** — update CLAUDE.md's stale frontend section | Nothing; catch-all 404s them today |

Dead-weight sweep alongside the kills: `src/components/salvage/` and any components only
ExplorerLanding's legacy chrome imports (bottom tab bar, avatar menu chrome) get deleted when
the reskin lands — delete dead code, no shims.

**Net: 14 rooms → 5 doors.** Today / Almanac (chapters) / Museum / Court / Ask.

---

## 2. THE ALMANAC IA

The organizing insight from the three almanac reads: the form has exactly five jobs, and DCD
already owns machinery for each — it's just scattered across rooms that grew one sprint at a
time. The IA names the five jobs and assigns every surviving room to one.

```
DUCK COUNTDOWN — the living almanac of American ground

TODAY            /                the daily Left-Hand Page (by-the-door ritual)
THE ALMANAC      /plant …         chapters: lane-backed reference pages
THE MUSEUM       /date /born      any-date receipts, films, replays
THE COURT        /court           every claim graded in public
ASK              /ask             the query door over the whole archive
```

### 2a. TODAY (`/`) — the daily panel reborn

Both incumbent publishers converged on the daily panel as the front door (modern-read
implication #1); the 1950 left-hand page is its ancestor. ConceptA is already 80% of it. What
completes it — transplanted from /explore's organs plus cheap 1950 furniture:

- **The dateline with counters** (steal verbatim: "Day 198 of 2026 · 66 days until fall") —
  one line, computed, free.
- **Your ground, fitted** (the key-letter lesson): sun rise/set, moon phase + % lit,
  solunar feed windows (hunt_solunar_precomputed), and — where the roster has a station —
  **the tide line** (the open flank: no web almanac serves tides; DCD holds Baltimore hourly
  to 1902). All fitted to the persisted state (§2e), basis one tap away ("tide: Baltimore
  gauge · station roster →").
- **The porch sentence** — one clause leads (dc9ea79's law), the remaining clauses render as
  the strip. Never concatenate; the month has a through-line and today is a line of it.
- **The live board + rhyme + ledger** — already there, unchanged.
- **FORMING watches** — already there (Formation Layer v2); keep the ghost-ring grammar.
- **Footer lore line** (1950 insight 8): one rotating computed line under the panel
  ("Last Qtr.—New Moon—Phases Best Fishing" grade of furniture) — moon-phase-only, no
  astrology, cheap, ritual.
- **The doors footer** — the same InnerNav row every room shares.

### 2b. THE ALMANAC — the chapters

Each chapter is a lane-backed reference page in the /plant grammar: a question in quotes, one
distribution-first answer huge, honesty box rendered amber, the full table beneath, receipts
printed. `/plant` is the template; the others are **post-box** builds (STOP line, §5) listed
here so the IA has named shelves:

| Chapter | Route | Lanes already owned | The /plant-grammar question |
|---|---|---|---|
| Planting | `/plant` | planting_climatology (LIVE) | "When do I plant my tomatoes?" ✅ shipped |
| Sky | `/sky` | astronomical, geomagnetic-kp, space-weather, solunar | "What's in the sky tonight?" + the moonlight-interference call on meteor nights |
| Water | `/water` | tide-gauge, noaa-tide, river-discharge, usgs-water, ocean-buoy | "What's the tide doing, against 124 recorded years?" — the undefended flank |
| Ground | `/ground` | drought-weekly, soil, snotel, crop-progress | "How dry is my state, against its own record?" |
| Seasons | `/seasons` | ghcn percentiles, migration-daily, hunt_seasons, phenology rows | "What runs, blooms, and opens now?" — the 1950 phenology weave + the abandoned game-law ground the modern almanac walked away from |
| Air | `/air` | air-quality (2022+, Canadian-smoke episode on file) | "What am I breathing, against the record?" — also the parked board instrument |

Chapters are verticals-as-chapters (POSITIONING's ONE ENGINE, N ALMANACS) — the growth
doctrine's shelf, not this month's build.

### 2c. THE MUSEUM — `/date` + `/born` + the films

The museum is gate 3's face: any-date receipts a stranger can verify. Rooms: **`/date/:d`**
(main hall — the day's record across ~23 lanes with provenance links), **`/born`** (the
wonder door into the same hall), **`/cascade/*`** (verified replays), **`/board/:story`**
(the films). One reskin puts them all in the InnerNav idiom; `/date` gets a museum-quality
title treatment for every lane (no raw row IDs, ever — §1.4), a permanent "cite this day"
block (already there), and the two-weeks-either-side strip stays (it's good).

Cross-reference as product grammar (1950 insight 9): every museum block deep-links — porch
clause → `/date`, date-page storm row → `/board` film if one exists, born-night → atlas
dossier. Pointers rendered as visible furniture ("see the full record →").

### 2d. THE COURT — `/court`

Keeps its body. Two additions:
1. **The lineup retirement exhibit** — the newest monument in the killed index: *"The
   almanac's oldest magic — the moon, the tide, and the temperature lined up — got its first
   controlled trial in 230 years tonight and lost to its own control arm. Δ −0.19pp over
   1,349,945 paired days. Retired 2026-07-17."* Link the run of record
   (scripts/mine/out/LINEUP-RETRO-REPORT.md). No almanac ever printed its own miss this big;
   it's the moat speaking.
2. **The methodological contrast line** (modern-read implication #5), one sentence of ambient
   furniture: *"The incumbent grades one city per region on direction, self-scored. This court
   grades every claim, against controls, misses printed."*

### 2e. Navigation grammar + state persistence + the month grid

**One nav idiom everywhere.** InnerNav wins; the bottom tab bar dies. The doors footer becomes
the five doors + the chapters as sub-doors of Almanac:

```
Today → · The Almanac (When to plant · …) → · The Museum (Any date · The night you were born ·
The films · Strangest days) → · The Court → · Ask →
```

DOORS in `src/components/InnerNav.tsx` is already the single source of truth — extend it;
every page keeps `InnerHeader` + `InnerFooter`. Footer groups render as two quiet rows at
375px (it already flex-wraps).

**Your ground follows you** (the key-letter lesson made software): one `useYourGround()` hook —
localStorage `dcd-ground`, set from a quiet picker on TODAY ("YOUR GROUND: Maryland ▾"),
also set implicitly the first time a visitor picks a state on /born or /plant. Read by: TODAY
(sun/moon/tide/solunar block), `/plant` (replaces its private select), `/atlas` (arrives
pre-descended with a one-tap "surface" back to national), `/morning` (a your-state line under
the national line when they differ), `/ask` (context state), `/date` (default state filter
chip). Every fitted number carries its basis inline — never a generic number plus a separate
settings page. URL params (`?state=XX`) always override and then persist; share-links stay
faithful.

**The month grid** — the open flank neither incumbent serves (1950 had it; the modern web
gives one day at a time). `/month`: a calendar grid for your ground — per day: moon glyph,
solunar rating word, sun times drift, and the day's one porch word from the frame store,
each cell tapping into `/date`. All computable from owned rows (hunt_solunar_precomputed +
frames + astronomical lane). **Post-box** — first in the queue when the box opens, because it
out-1950s both publishers, but it is not gate-3 critical.

---

## 3. THE QUERY PROBLEM — "no way to query it"

### What /explore's chat can already answer (verified in code)

The pipeline is real and decent: `useChat` → `hunt-dispatcher` → Haiku intent routing into
**9 intents** (`weather, solunar, season_info, search, pattern_query, recent_activity,
self_assessment, docket, general`) → deterministic handlers fetch rows → Sonnet streams the
narration → Tavily web fallback → typed cards (weather/season/solunar/alert/pattern/
cross-domain) → thumbs feedback embedded back into the brain. State + species context ride
along. Sessions persist. This is 80% of an honest ask-surface, orphaned behind a door labeled
"explore" in a chrome the rest of the site abandoned.

### What it can't answer that the almanac must

| Question a stranger will ask | Today | Gap |
|---|---|---|
| "When do I plant tomatoes in Maryland?" | general-intent ramble | No handler reads `planting_climatology` — the shipped chapter is invisible to the chat |
| "What's forming right now?" | weather-intent approximation | No handler reads `formation_watches` — the flagship layer is invisible to the chat |
| "What happened on July 10 1993 in Virginia?" | search-intent vector grab | Should answer with the museum's own day-read (useDayArchive's bounded lane queries) + a `/date/1993-07-10?state=VA` door — the museum IS the answer |
| "How accurate are you?" | self_assessment exists | Should read morning_lines grades + court docket and answer with the real record ("1 confirmed, 3 missed of 5 graded") + `/court` door |
| Any answer's receipts | inconsistent | Receipts-law: every answer ends with provenance chips + one door deeper ("see the full record →") — cross-reference as furniture |

### v1 ask-surface scope (honest)

**Rebirth, not rebuild.** `/ask` = ExplorerLanding's chat column reskinned into the InnerNav
idiom, front and center, one input: *"Ask the archive anything."* Suggestion chips seeded from
your ground + the live day (the four orphaned /state prompts land here). Scope:

1. **Reskin + re-seat** (Wave 1): InnerNav chrome, kill tabs/avatar, `/explore` → `/ask`
   redirect. The daily-panel organs transplant to TODAY; /ask keeps ONLY the conversation.
2. **Three new handlers** (Wave 4, small — each is a bounded REST read + a system prompt):
   `planting` (planting_climatology), `forming` (formation_watches + validated-leads copy with
   registered lead times), `day_read` (useDayArchive's lane queries server-side, date+state).
3. **The receipts law, enforced in the pipe**: dispatcher appends a `doors` array (typed
   deep-links) to every handler result; the UI renders them as the answer's footer chips.
   Every intent maps to at least one door.
4. **The honesty rail**: the chat never registers claims and never forecasts — it narrates
   rows the handlers fetched and registered claims the court holds. The shared system prompt
   already leans this way; make it law in the prompt rules block.

**NOT in v1** (post-box, named so nobody drifts into them): free-form SQL-ish analytics
("compare all states' droughts since 2000"), multi-turn research agents, chat-initiated
claim registration, embeddings-only open search as a primary answer path (the 7.6M-row vector
search still awaits the IVFFlat rebuild window — bounded lane reads are the reliable spine).

---

## 4. BUILD ORDER — waves sized for agent execution

Doctrine: readers fan out, writers never; frontend waves are all reader-side. Every wave ends
with `npm run build` + live Chrome eyes at 375px + desktop (standing law). Gate-3
justification named per wave, per the timebox's own test.

**WAVE 0 — the warts (1 agent, ~1 session). Gate-3: a stranger meets no UUIDs.**
- `/date` fire-lane titles: human sentence from row content/metadata, never raw `title`
  fallback to `fire-{UUID}`; fix the perimeter-lane date keying on the day page (scrape-day
  vs effective-day).
- Verify the in-flight lineup surgery landed on /morning + atlas dossier + grader (owned by
  the dispatched wave — verify only, don't duplicate).
- Sweep every lane's title mapping in useDayArchive-rendered blocks for other raw-ID leaks.

**WAVE 1 — ONE NAV, ONE PRODUCT (2 agents parallel: kills+redirects / reskins, ~1 session).
Gate-3: the site reads as one thing.**
- Promote ConceptA → `src/pages/TodayPage.tsx`; delete `/concepts`, `/concepts/a|b|c`, files
  and routes; delete `/welcome` (redirect → `/`); delete `/state/:s` (redirect →
  `/atlas?state=XX`); `/explore` → `/ask` (redirect kept).
- Reskin `/date`, `/cascade/*`, `/ask` into InnerNav (header ribbon + doors footer); delete
  the bottom tab bar, avatar chrome, and everything only they imported (incl.
  `components/salvage/` if orphaned). Extend DOORS to the five-door grammar (§2e).
- Update CLAUDE.md's stale frontend/route section in the same commit.

**WAVE 2 — TODAY becomes the Left-Hand Page (1-2 agents, ~1 session). Gate-3: the by-the-door
ritual a visitor returns to (the 10-returning half of the gate).**
- `useYourGround()` + the quiet picker; wire /plant, /atlas, /morning, /date, /ask to it.
- Transplant /explore's organs into TODAY: sun/moon/solunar block, tide line (station roster
  states), day-of-year + days-until-season counters, footer lore line (moon-phase only).
- Porch shard grammar guard: clauses render as lines/strip, never concatenation (dc9ea79 law,
  kept under test).

**WAVE 3 — MUSEUM front-door polish (1 agent, ~1 session). Gate-3: this is literally the
gate's named deliverable (date lookup + receipts, posted publicly).**
- `/date` museum-quality pass: lane titles as sentences everywhere, provenance links visible,
  "cite this day" prominent, `/born` + films + strangest-days cross-linked as one wing,
  every block carrying its door.
- The public posting + analytics loop closes here (Vercel Analytics already collecting).

**WAVE 4 — ASK v1 (1 agent, ~1 session; James's call whether it's in-box — it directly
serves "no way to query it," which is the gate-3 demand question in James's own words).**
- Three handlers (`planting`, `forming`, `day_read`) + doors array in the dispatcher +
  receipts-chips rendering + honesty-rail prompt rules. Redeploy law: hunt-dispatcher imports
  `_shared/*` — verify tree before deploy.

**COURT exhibit (rides any wave, ~1 hour):** the lineup retirement monument + the
methodological contrast line (§2d).

═══════════════════ **STOP LINE (the 08-10 box)** ═══════════════════

**Post-box queue, in order** (each waits for the box to open or a gate to pass; a documented
re-hearing governs):
1. `/month` — the month-at-a-glance grid (the open flank; first out of the box).
2. Chapters: `/water` (tides — undefended flank) → `/sky` (moonlight-interference call) →
   `/seasons` → `/ground` → `/air` (unparks the AQI board instrument with it).
3. Folklore-on-trial lane (the 1874 lunation table, defendant #1 — court machinery exists).
4. County-level planting ("County-level is coming" is already promised on /plant).
5. Ask v2: open analytics questions, multi-lane comparisons (wants the IVFFlat rebuild
   window first).
6. Per-month moon/SEO franchise pages, contests, named-voice furniture (POSITIONING's
   marketing wing).

---

## 5. MOBILE-FIRST MOCKUP SKETCHES (375px structure notes)

### TODAY — `/`
```
┌─────────────────────────────┐
│        DUCK COUNTDOWN       │  ribbon
│  The honest memory of       │  thesis (2 lines max)
│  American ground…           │
│  every sentence traceable…  │
├─────────────────────────────┤
│ July 17, 2026 · Day 198     │  dateline + counters
│ 66 days until fall          │
│ YOUR GROUND: Maryland ▾     │  persisted picker
│ ☉ 5:52–8:28 · ☽ 6% waxing   │  fitted block
│ feed 4:50–6:50a · tide:     │  (tide only where
│  Baltimore running low ↓    │   roster has a station)
├─────────────────────────────┤
│ California is running as    │  porch: ONE clause leads
│ hot as its July has ever    │
│ recorded, under a Red       │
│ Flag Warning.               │
│ · flood forming TX +3 ·     │  the strip (shards)
│ · smoke forming MD ·        │
├─────────────────────────────┤
│ [ LIVE BOARD — embers,      │  tap state → /atlas
│   ghost rings on forming ]  │
├─────────────────────────────┤
│ RHYMES WITH  Feb 1 1996 →   │  → /date/1996-02-01
├─────────────────────────────┤
│ THE LEDGER (past days…)     │  existing scroll
├─────────────────────────────┤
│ "New Moon Friday — best     │  rotating lore footer
│  fishing of the month."     │  (computed, no astrology)
│ doors: Almanac · Museum ·   │
│        Court · Ask          │
└─────────────────────────────┘
```

### CHAPTER (template = shipped /plant)
```
┌─────────────────────────────┐
│ THE PLANTING TABLE   DC ↗   │  InnerHeader
│ your ground: Maryland ▾     │  shared picker
│ “When do I plant my         │  the question, quoted
│  tomatoes?”                 │
│ In 68 of 75 recorded years, │  distribution lede, huge
│ Maryland's last freeze had  │
│ passed by May 31.           │
│ ⚠ state-level minima…       │  honesty box (amber)
│ LAST SPRING FREEZE          │  full distribution table
│  earliest tenth… Apr 30     │
│  median year…    May 17     │
│  9 of 10 by…     May 31     │
│  cruelest: 1950, Jun 18     │  the year gets its name
│ receipts: ghcn-daily · 76y  │  source chips
│ doors footer                │
└─────────────────────────────┘
```

### MUSEUM — `/date/:d`
```
┌─────────────────────────────┐
│ THE MUSEUM          DC ↗    │  InnerHeader (no tabs)
│ ‹  July 10, 2026  ›  📅     │  date stepper + picker
│ All states ▾ (your ground   │  state chip persisted
│  pre-selected)              │
│ TWO WEEKS EITHER SIDE       │  dot-strip (keep)
│ ●●●●●●[10]●●●●●             │
│ THE RECORD                  │
│ ┌─ Fire ──────────────────┐ │
│ │ Cedar Creek fire grew   │ │  SENTENCES, never IDs
│ │ to 14,102 acres (OR) ↗  │ │  provenance link right
│ └─────────────────────────┘ │
│ [Weather] [Water] [Life]…   │  lane blocks
│ THE STORY (OTD, receipts)   │
│ ⧉ CITE THIS DAY             │
│ related: The Board film →   │  cross-refs as furniture
│ doors footer                │
└─────────────────────────────┘
```

### COURT — `/court` (additions only)
```
│ THE RETIRED                 │
│ ┌───────────────────────── │
│ │ THE LINEUP · retired     │
│ │ 07-17-2026               │
│ │ "The moon, the tide, and │
│ │ the temperature" — first │
│ │ controlled trial in 230  │
│ │ years. Δ −0.19pp over    │
│ │ 1,349,945 paired days.   │
│ │ It lost. run of record → │
│ └───────────────────────── │
│ They grade one city per    │
│ region, self-scored. We    │
│ grade every claim, with    │
│ controls. Misses printed.  │
```

### ASK — `/ask`
```
┌─────────────────────────────┐
│ ASK                  DC ↗   │  InnerHeader
│ Ask the archive anything.   │
│ ┌─────────────────────────┐ │
│ │ ▸ when do I plant       │ │  input, huge
│ └─────────────────────────┘ │
│ try: what's forming now ·   │  chips seeded from
│ July 10 1993 in Virginia ·  │  your ground + live day
│ how accurate are you        │
│ ── answer streams here ──   │
│ In 68 of 75 recorded        │
│ years… [answer]             │
│ receipts: planting_clim ·   │  provenance chips
│ ghcn 76y                    │
│ see the full record → /plant│  the door (always ≥1)
│ doors footer                │
└─────────────────────────────┘
```

---

## 6. The one-paragraph version

Five doors: **Today** (the daily left-hand page — date, your fitted sky/tide/solunar, one
porch clause + shards, the live board, forming watches, the ledger), **the Almanac**
(lane-backed chapters, /plant first and the template), **the Museum** (/date + /born + the
films, receipts everywhere, no UUIDs), **the Court** (every grade public, lineup retirement
as the newest monument), and **Ask** (the /explore chat reborn as the archive's query door
with three new handlers and a receipts law). One nav idiom (InnerNav), one persisted ground
choice following the visitor through every room, kills executed on /welcome, /state, and the
concepts scaffolding. Waves 0–4 fit the box and are all gate-3 work; the month grid and the
remaining chapters queue behind the STOP line.

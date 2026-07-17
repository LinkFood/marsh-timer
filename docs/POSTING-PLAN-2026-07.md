# GATE-3 PUBLIC POSTING PLAN — 2026-07 (DRAFT, AWAITS JAMES)

> **Status: PLAN ONLY. Nothing has been posted. No accounts created, no outreach sent.**
> The posting itself is James's move — this document exists so the move takes ten minutes.
>
> **The gate (verbatim from `docs/FRESH-EYES-VERDICT-2026-07-16.md`):** by 2026-08-10, museum
> front door live + instrumented + **posted in ≥2 venues; ≥100 unique external visitors
> completing a date lookup, ≥10 returning within 7 days. Below both = no demand signal =
> mothball fires.**
>
> Identity per `docs/POSITIONING.md`: **"The living almanac of American ground."** Live meta
> already carries it (verified on duckcountdown.com 07-18: title, description, OG cards).
> What shipped and is post-ready per THE-WEEK 07-17/18: five doors + one nav, TODAY fitted
> block (sun/moon/solunar/tide for your state), Formation Layer with graded court claims,
> /plant (the tomato table), the museum wing with provenance chips on every card, /court
> including the lineup retirement, /ask.

---

## 0. The one thing that must ship BEFORE any post (the analytics gap)

**What exists today:** `@vercel/analytics` is mounted (`<Analytics />` in `src/main.tsx`)
— pageviews and daily unique visitors per path. **There are zero custom `track()` calls
anywhere in `src/`.** That means, as of this writing:

1. **"Completing a date lookup" is not measurable.** Pageviews of `/date/:dateStr` are a
   landing proxy, not a completion signal — and lookups made via `/atlas?date=…` are
   invisible entirely (Vercel Web Analytics does not split query strings into separate
   paths).
2. **"Returning within 7 days" is not measurable at all.** Vercel Web Analytics dedupes
   visitors per day and has no retention/cohort view. Gate 3's second number — the harder
   one — currently has no instrument.

**The small pre-posting build (~30–45 min, one commit):**

- `track('date_lookup', { door: 'date'|'atlas'|'born'|'morning' })` — fired **on successful
  data render** (not on route mount) in DatePage, SpotDossier (`?date=` path), BornPage,
  MorningPage. Completion = the archive answered, not the URL loaded.
- `track('return_visit', { days_since_first })` — localStorage `dc_first_seen` stamp set on
  first visit; event fires once per day when `1 ≤ days_since_first ≤ 7`. No fingerprinting,
  no cookies, localStorage only — consistent with the house's honesty posture.
- **Owner exclusion:** a `dc_owner=1` localStorage flag on James's devices (set once via
  console) gates both events off, so the 100/10 counts are external-only, as the gate
  demands.
- **UTM discipline:** every posted link carries `?utm_source=hn|reddit_iib|reddit_md|…` —
  Vercel Analytics surfaces UTM params, giving per-venue attribution for free.

**Plan-level caveat to verify at build time:** Vercel custom events require a paid Web
Analytics tier on some plans. Verify events appear in the dashboard the same day. If they
don't, fallback = a tiny `hunt_site_events` table written from the client (anon insert,
dedup on a random local id) — one migration, same two events, readable by a one-line REST
count at judgment time.

**BUILD STATUS — §0 SHIPPED 2026-07-17 (commit 9d4ecbf), verified live by headless probe:**

- `date_lookup` fires on successful data render, all four doors confirmed on
  duckcountdown.com — `{door:"date"}` (/date/1933-08-23?state=MD), `{door:"morning"}`
  (/morning), `{door:"atlas"}` (/atlas?date=…), `{door:"born"}` (the /born form's atlas
  render, attributed via sessionStorage handoff). Every POST to `/_vercel/insights/event`
  returned 200.
- `return_visit {days_since_first}` confirmed (stamped first-seen 3 days back → event
  fired with `days_since_first: 3`, 200). Fires at most once per calendar day, days 1–7.
- **Owner exclusion verified:** with the flag set, a full lookup emitted a pageview and
  ZERO event POSTs. James: on each of your devices, either visit any page with `?owner=1`
  appended, or run once in the console: `localStorage.setItem('dc_owner', '1')`
  (`?owner=0` clears it). Implementation: `src/lib/analytics.ts`.
- Vercel's script bot-detects: headless/webdriver visitors get no beacons at all (probe
  had to mask automation to see them) — bot traffic self-excludes from the gate counts.
- Docs check (2026-06-26 docs): custom events are included on Pro (2 properties/event —
  we use 1), NOT on Hobby; **UTM breakout requires the Web Analytics Plus add-on
  ($10/mo)**. The one check left is James's: open the project's Analytics tab and confirm
  the two events appear in the Events panel from the probe's test hits (dashboard needs
  auth; browser access was declined during the build, honestly noted). If they don't
  appear (plan gap), the Supabase fallback table below is the pre-specified move — it was
  NOT built, per prefer-Vercel-native.

**Operational definitions, fixed now so 08-10 isn't argued:**
- *Unique external visitor completing a date lookup* = unique visitors on the
  `date_lookup` event (Vercel's visitor dedup), owner-excluded.
- *Returning within 7 days* = unique visitors on `return_visit`, owner-excluded.
- If events end up unavailable on the plan: fall back to unique visitors on the
  `/date/*`+`/born`+`/morning/*` paths (declared honestly at judgment as a proxy), and the
  return metric rides the Supabase fallback table only.

---

## 1. Venue analysis (ranked)

**Rules provenance, stated honestly:** Show HN guidelines were fetched and read 07-18
(news.ycombinator.com/showhn.html). Reddit blocks direct rule fetches from this environment;
subreddit rules below are from general knowledge + search corroboration and are labeled
**[VERIFY SIDEBAR]** — James (or a browser session) re-checks each sub's sidebar the day of
posting. Rule details drift; the plan assumes nothing.

### #1 — Hacker News, Show HN

- **Angle:** the data/honesty angle. An almanac that grades its own claims in public,
  misses in red — plus the lineup-retirement story, which is catnip for exactly this crowd
  (we pre-registered a test of our own magic sentence, ran it on 1.35M paired days, and it
  lost to its own control arm — so we killed the feature and published the verdict).
- **Fit check against fetched rules:** qualifies — interactive, no signup wall, no email
  gate, substantive. Author must hang around in comments (James or a delegated session,
  same day).
- **Expected volume, honest:** **a lottery, and say so.** The median Show HN gets a handful
  of points and under ~100 visitors — that alone doesn't clear the gate. Front page
  (top ~10% of Show HNs) = 5k–50k visitors in a day. Plan for the median, be ready for the
  tail (see load risk, §4).
- **Rules/risks:** don't repost the same link repeatedly; HN norms tolerate **one** re-try
  days later if the first sinks without comments. No fake accounts, no vote begging —
  instant death. Best window: Tue–Thu, ~9–11am ET.

### #2 — r/InternetIsBeautiful

- **Angle:** the site IS the post — free, interactive, no signup, a "type any date, fall
  into the record" toy with real depth under it. This sub exists for exactly this shape.
- **Rules [VERIFY SIDEBAR]:** interactive sites only; **no sites requiring signup/login to
  use** (we pass — no auth wall); creators may submit their own site but self-promo is
  rate-limited (historically one self-post per ~90 days); no fundraising/store links.
- **Expected volume, honest:** the best click-converter of any venue here — the post IS the
  link. A mid post = several hundred visitors; a good one = thousands. Less of a lottery
  than HN because novelty-toy sites are the sub's native food.
- **Risks:** the sub's crowd bounces fast — the date-lookup completion event will decide
  whether they count for the gate, which is exactly why completion (not landing) is the
  instrument.

### #3 — r/maryland (secondary: r/ChesapeakeBay, r/baltimore)

- **Angle:** the your-ground angle, and it's genuinely true — Maryland is the proving
  ground. The Baltimore tide gauge back to 1902, 76 years of MD frost records, the 1933
  Chesapeake–Potomac hurricane readable to the gauge. "I built a living almanac of our
  ground" from an actual Marylander is a local-pride post, not an ad.
- **Rules [VERIFY SIDEBAR]:** local subs generally welcome resident-made projects and
  generally ban drive-by promo; the difference is being present in comments and the thing
  being about Maryland. r/ChesapeakeBay is small but is the founding-water audience.
- **Expected volume, honest:** tens to low hundreds of visitors. **But this is the venue
  most likely to produce the ≥10 returners** — locals with real ground are the retention
  cohort. The gate has two numbers; this venue is aimed at the second one.
- **Risks:** small-sub mods can be arbitrary; message mods first if the sidebar is ambiguous.

### #4 — r/dataisbeautiful (reserve / second wave)

- **Angle:** a single [OC] chart, not a site link: the MD frost distributions ("last freeze
  by day-of-year, 76 years — in 68 of 75 recorded years the last freeze had passed by
  May 31") or the court's public grade record. Search-corroborated rules: [OC] tag required,
  data source + tool named in a comment; site link lives in that comment.
- **Expected volume, honest:** lottery, and clicks are second-hand (image absorbs the
  interest; the comment link leaks only a fraction). Use as the reserve shot if the first
  three underdeliver by ~08-01.
- **Risks [VERIFY SIDEBAR]:** heavy moderation; static-image culture; topic-day
  restrictions exist for some categories.

### #5 — Gardening/homesteading (r/vegetablegardening, r/homestead, permies.com)

- **Angle:** /plant — "when do I plant tomatoes" answered from 76 years of receipts, with
  the cruelest years named, and the honest state-level disclosure printed on the page.
- **Rules, honest read [VERIFY SIDEBAR]:** most gardening subs **ban link-drop self-promo
  outright**. The honest play is not a launch post: it's answering real frost/planting
  questions with receipts and the link where sub rules allow, or a weekly-thread mention.
  Permies allows promo only in designated forums.
- **Expected volume, honest:** low and slow — but July is the wrong season for the frost
  page anyway (the log already ruled a mid-July /morning planting teaser out on the same
  ground). This venue matures in late August (fall-frost season) — inside the gate window
  only barely. Treat as drip, not a gate-mover.

### #6 — Waterfowl/hunting forums (r/Waterfowl, Refuge Forums, DuckHuntingChat)

- **Angle:** the founding chapter — the site literally began as a duck-season countdown,
  and the name still says so. Season countdowns + conditions history is native value there.
- **Rules [VERIFY SIDEBAR / forum ToS]:** hobby forums typically require participation
  before links and ban commercial promo; free-tool-by-a-member posts are usually tolerated.
- **Expected volume, honest:** July is the off-season; traffic is at annual low. Real
  potential in September, mostly outside the gate window. Drip, not gate-mover.

### #7 — MetaFilter Projects

- **Angle:** own-project posts are the explicit purpose of the section ($5 one-time
  account). Small, literate, high-comment-quality traffic; occasionally seeds a front-page
  MeFi post by someone else.
- **Expected volume, honest:** tens of visitors. Cheap, zero rule risk, near-zero cost.
  Worth doing as venue #3-or-4 padding for the "≥2 venues" clause.

### #8 — Product Hunt: **SKIP (with reason)**

Consumer data-curio sites without a launch network do poorly there; the launch mechanics
(hunter, assets, launch-day comment marshaling) cost more than the expected return; and the
gate doesn't need it. If gates pass and a real product push happens post-timebox, revisit.

---

## 2. The copy (top-3 venues; house voice — never overclaim, receipts-forward)

Numbers used below are from the record: ~9.9M archive rows (07-17 log), 1.35M paired index
days in the lineup retrodiction (LINEUP-RETRO-REPORT), Baltimore tide gauge 1902+, MD frost
lede from /plant, morning-line record 1-for-4 public in /court. **Re-verify each number
against the live surface the day of posting** — the record law applies to marketing copy
hardest of all.

### Show HN — title options

1. **Show HN: A living almanac that grades its own claims in public (misses in red)**
2. **Show HN: We tested the almanac's moon-and-tide magic on 1.35M days. It lost, so we killed it**
3. **Show HN: Type any date since 1950, see what American ground was doing — every sentence has a receipt**

Recommended: **#1** (the identity + the moat in one line; #2 is the best story but reads as
a blog-post title, and Show HN wants the artifact; use story #2 as the first comment).

**Body (posted as author's first comment):**

> I've been building a living almanac of American ground: type any date and state and it
> tells you what that day was there — temperature against its own recorded history, the
> tide gauge, the moon, what was forming, and what followed — every sentence traceable to
> an instrument row with a provenance link. ~9.9M rows across GHCN stations, NOAA tide
> gauges, USGS gauges, NCEI storm events, USGS earthquakes, eBird, drought and climate
> indices. It never forecasts. It remembers.
>
> The part I care most about: it grades itself in public. Every claim the front page makes
> is registered before the outcome, then graded — and the misses render in red on /court.
> Current morning-line record: 1-for-4. That's on the site, not in a postmortem.
>
> Last week we gave the almanac's oldest magic — "the moon, the tide, and the temperature
> lined up like this before" — its first controlled trial: pre-registered, 1.35M paired
> index days, shuffle-calibrated. The lineup precedent transferred marginally *worse* than
> a plain anomaly-matched precedent. So we retired the sentence, and the retirement notice
> links the full run. An almanac that can kill its own folklore is the only kind worth
> reading.
>
> Try: your birthday on /born, or /date/1933-08-23?state=MD — the Chesapeake–Potomac
> hurricane, corroborated by a Baltimore tide gauge that's been running since 1902.
>
> Honest limits: depth varies by lane (most instrument lanes are 1950+, some much shorter);
> some readings are state-level and the page says so; it's a solo project and rough edges
> exist. Yes, it's called Duck Countdown — it started life as a duck-season countdown for
> the Chesapeake, and the name stayed when the archive outgrew it.

**Link:** `https://duckcountdown.com/?utm_source=hn` — the front door; the body carries the
museum deep-links.

### r/InternetIsBeautiful — title options

1. **Type any date since 1950 and see what the ground was doing anywhere in America — every sentence has a receipt**
2. **A living almanac that grades itself in public — its misses render in red**
3. **Enter your birthday, get the actual instrument readings from the night you were born**

Recommended: **#1** (the sub rewards "here is the toy, here is what it does"); #3 is the
strongest pure-curiosity hook if the sub's history shows birthday-toys landing well —
James's call.

**Body (short — this sub reads the site, not the post):**

> Solo project: ~9.9M rows of public instrument data (weather stations, tide gauges, river
> gauges, storm events, earthquakes, bird counts) fused into an almanac. Pick a date and a
> state: what that day was, what it rhymes with, what followed. Every card has a provenance
> link to the dataset of record. It never forecasts — and it grades its own claims in
> public (/court; the misses are in red). Free, no signup.

**Link:** `https://duckcountdown.com/?utm_source=reddit_iib`

### r/maryland — title options

1. **I built a living almanac of Maryland ground — the Baltimore tide gauge back to 1902, 76 years of frost records, and every claim graded in public**
2. **What was this exact date in Maryland — any year since 1950, from the actual instruments (free, no signup)**

**Body:**

> Marylander here. I've been building this for a while: a living almanac of our ground.
> Type any date and it reads the record — the Baltimore tide gauge (running since 1902),
> the GHCN weather stations, storm events, the moon and tide for tonight. Try the 1933
> Chesapeake–Potomac hurricane: /date/1933-08-23?state=MD — the surge is right there in
> the gauge, with the NOAA receipt linked.
>
> The planting page answers "when do I plant tomatoes" from the actual record: in 68 of 75
> recorded years, Maryland's last freeze had passed by May 31 — cruelest years named. It
> also says plainly where the data is state-level and where it's thin; when a reading is
> statewide the page discloses it.
>
> It never forecasts. And it grades its own claims in public — misses render in red. Would
> genuinely love to know what it gets wrong about ground you know personally; that's how
> it improves.

**Link:** `https://duckcountdown.com/?utm_source=reddit_md&state=MD` (verify the state
param survives the redirect chain before posting).

---

## 3. Measurement (how the gate's numbers get read on 08-10)

- **Instrument first, post second.** The §0 events ship and are verified live in the Vercel
  dashboard (or the fallback table) **before** the first post. A visitor who arrives before
  the events exist is a visitor the gate can't count.
- **Per-venue attribution:** UTM params (above) in every posted link; Vercel Analytics
  breaks out utm_source natively. This also settles "which venue worked" for any post-gate
  decision.
- **The judgment query (write it down now):**
  - Gate metric A: unique visitors on `date_lookup`, 07-posting-date → 08-10, owner-excluded. Pass ≥ 100.
  - Gate metric B: unique visitors on `return_visit`, same window. Pass ≥ 10.
  - Both below = mothball fires per the verdict. One above = the documented re-hearing, per the box.
- **Named gaps as of this draft:**
  1. No `date_lookup` completion event exists (pageviews only; `/atlas?date=` lookups fully invisible). — §0 build.
  2. No return-visit instrument exists at all; Vercel has no retention view. — §0 build.
  3. Owner traffic is currently counted as external. — §0 owner flag.
  4. Custom-event availability on the current Vercel plan is unverified. — verify same day; Supabase fallback specified.

---

## 4. Sequencing + risk

### Order and spacing

| Step | When | What |
|---|---|---|
| 0 | Before anything | §0 analytics build shipped + verified live; pre-flight checklist below |
| 1 | Day 1 (target ~07-21/22) | **r/maryland** — small friendly room first: tests the copy, surfaces warts, and seeds the return-cohort that metric B needs time to mature |
| 2 | Day 3–5 (Tue–Thu, 9–11am ET) | **Show HN** — the main shot; James (or a live session) answers comments same-day |
| 3 | Day 7–9 | **r/InternetIsBeautiful** — after HN so the two big rooms don't split the same 48 hours of comment presence |
| 4 | ~08-01 checkpoint | If metric A < 50: fire the reserves — r/dataisbeautiful [OC] chart + MetaFilter Projects + r/ChesapeakeBay |

Never two big venues on the same day: comment presence is the actual growth mechanic and
one person can only be present in one room. Earlier is better across the board — metric B
needs visitors to have ≥7 days of runway before 08-10, so **the last useful big post lands
by ~08-01.**

### Pre-flight checklist (day of each post)

- [ ] Re-read the target venue's sidebar rules THAT DAY (rules above are labeled with provenance; sidebars drift).
- [ ] Example deep-links render correctly, desktop + 375px (`/date/1933-08-23?state=MD`, `/born`, `/plant`).
- [ ] Every number in the copy re-verified against the live surface.
- [ ] OG card renders in a link-preview checker (meta verified live 07-18; re-check).
- [ ] Analytics events visible in dashboard from a test visit (non-owner device/profile).
- [ ] Supabase IO headroom checked; no write pipe running during a big post window (one-write-pipe doctrine — a front-page hour is a read spike, keep the write lane clear).

### Risks and the prepared honest answers

**"Duck Countdown? Is this a hunting app?"** (the name-vs-identity confusion — the #1 risk)
> Own it in the first breath, every venue: "It started as a duck-season countdown for the
> Chesapeake; the archive outgrew the name, the name stayed." The OG card and site title
> already lead with "The Living Almanac of American Ground." Do NOT rename anything for the
> launch — a name change mid-gate contaminates the demand measurement.

**"This is astrology / numerology."**
> The house answer is the record: "We thought some of it might be too — so we tested our
> own magic sentence against 1.35M days with a pre-registered protocol, and when it lost we
> killed it and published the verdict. Records are shown side by side freely; *claims* of
> connection only surface after they survive the court." (This is the cicada-tomato law in
> one paragraph, and it's the single best comment-thread weapon we have.)

**"Another weather app."**
> "It never forecasts. Forecasts are the one thing it will not do. It remembers — what this
> day was on this ground across the record, with the instrument row attached — and when
> something is forming it shows you the historical record of that formation, graded."

**"AI slop / made-up numbers."**
> Provenance chips on every card, 17 datasets of record linked, and the QA record is
> public — including the stuck-sensor artifact a user question exposed (the June-2004 "MD
> freeze" that turned out to be a dead instrument; the page now shows the QA receipt
> instead of the lie). We publish our own data-quality failures. That's the product.

**"How accurate is it?"**
> "1-for-4, and it says so on the site." Never dodge this. The grade record is the moat;
> an evasive answer burns it.

**Load risk (HN tail case):** front page = a possible 10–50k-visitor day against Supabase
Pro on ci_small compute. Reads are cheap and the heavy pages are edge-function reads, but:
check anon rate limits on the read functions before posting; keep the write lane silent
during post windows; acceptable worst case is slow pages, not data loss. If the site
crawls, the honest comment is "solo project, small database tier, it'll catch up" — HN
respects that.

**Zero-traction case (the likely one for HN):** the gate rides on IIB + local + reserves.
One Show HN re-try days later is within HN norms if the first sinks uncommented. Do not
manufacture engagement — a gate passed on fake demand is a lie to the one person the gate
exists to inform.

**What is explicitly NOT in this plan:** paid promotion, influencer outreach, mailing-list
building, cross-posting the same link to 5+ subs in a week (Reddit-wide spam filter risk +
it's not the house), renaming/rebranding, and any build work beyond §0 — the stop-list
governs.

---

*Draft 2026-07-18, from the timebox's gate-3 line. James: accept, amend, or overrule —
then the posting is yours.*

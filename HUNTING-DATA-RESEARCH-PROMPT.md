# Hunting Season Data Research — All 50 States, 5 Species

## Your Job

Research official state wildlife agency websites and build comprehensive CSV datasets of hunting season dates for the **2025-2026 season year** across all 50 US states for 5 species: **Duck, Goose, Deer, Turkey, and Dove.**

This data powers a countdown timer website (duckcountdown.com). Accuracy is critical — wrong dates make the site useless.

## Output Format

Output **one CSV per species**: `duck.csv`, `goose.csv`, `deer.csv`, `turkey.csv`, `dove.csv`

Output each CSV as text that can be copy-pasted into Google Sheets. Use comma delimiters. Quote any field that contains commas.

## Columns (same for every CSV)

```
State, Abbreviation, Season Type, Zone, Split 1 Open, Split 1 Close, Split 2 Open, Split 2 Close, Split 3 Open, Split 3 Close, Bag Limit, Flyway, Weapon, Notes, Source URL, Verified, Season Year
```

| Column | Format | Rules |
|--------|--------|-------|
| **State** | Full name | "Texas" not "TX" |
| **Abbreviation** | 2-letter | "TX" |
| **Season Type** | See valid list below | One per row. Use the closest match from the list. |
| **Zone** | Text | "Statewide" if no zones. Use the state's official zone names if they have them. For western states with GMU/unit systems (CO, WY, MT, etc.), use major regions only — "Eastern", "Western", or "Statewide." Do NOT create rows for individual GMUs. |
| **Split 1 Open** | `YYYY-MM-DD` | ISO date. Always fill this. |
| **Split 1 Close** | `YYYY-MM-DD` | ISO date. Always fill this. |
| **Split 2 Open** | `YYYY-MM-DD` | Blank if no split season. |
| **Split 2 Close** | `YYYY-MM-DD` | Blank if no split season. |
| **Split 3 Open** | `YYYY-MM-DD` | Blank — only a few states need this (AR duck, WV duck). |
| **Split 3 Close** | `YYYY-MM-DD` | Blank — only a few states need this. |
| **Bag Limit** | Number | Daily bag limit. Use `999` for no limit (light goose conservation order). |
| **Flyway** | `Mississippi`, `Atlantic`, `Central`, or `Pacific` | Duck and goose ONLY. Leave blank for deer, turkey, dove. |
| **Weapon** | Text | `Bow`, `Rifle`, `Muzzleloader`, `Crossbow`, `Shotgun` | Deer and turkey ONLY. Leave blank for duck, goose, dove. |
| **Notes** | Text | Special regs, exceptions, anything notable. Keep brief. Quote the field if it contains commas. |
| **Source URL** | URL | The exact page you pulled from. EVERY row must have this. |
| **Verified** | `TRUE` or `FALSE` | `TRUE` if pulled directly from an official state wildlife agency page. `FALSE` if estimating or unsure. |
| **Season Year** | `2025-2026` | Always `2025-2026`. |

## Valid Season Types

Use ONLY these values. Pick the closest match. If something doesn't fit, use the closest one and explain in Notes.

- **Duck:** `regular`, `early-teal`, `youth`
- **Goose:** `regular`, `light-goose-conservation`
- **Deer:** `archery`, `rifle`, `muzzleloader`, `crossbow`
- **Turkey:** `spring`, `fall`
- **Dove:** `regular`, `special-white-wing`

## How to Handle Common Situations

**Split seasons:** Many duck states split their season into 2-3 segments with a gap. Put each segment in Split 1/2/3 columns on the SAME row. Example: Arkansas duck has 3 splits — all three date ranges go on one row.

**Multiple zones:** If a state has different dates per zone (e.g., North Zone vs South Zone for duck), create ONE ROW PER ZONE. Same state, same season type, different zone name, different dates.

**Multiple season types:** If Texas has archery deer AND rifle deer, those are SEPARATE ROWS — same state, different season type.

**Early Canada goose:** Many states have a September early Canada goose season before the regular fall/winter season. Use season type `regular` for BOTH — create two separate rows. Put "Early season" or "Regular season" in the Notes column to distinguish them.

**Light goose conservation order:** The LGCO (snow geese, Ross's geese) runs roughly Feb-April in many states with NO bag limit. Use season type `light-goose-conservation`, bag limit `999`. This is separate from regular goose season.

**Youth seasons:** SKIP youth seasons for all species. If a state has a notable youth season, mention it briefly in Notes on the regular season row. Don't create separate rows for youth.

**Antlerless/doe-only deer seasons:** Fold into the matching weapon type row (`rifle`, `archery`, etc.) and note it in Notes. Don't create separate rows for antlerless-only periods.

**Western GMU/unit systems:** Colorado, Wyoming, Montana, and other western states use unit-based systems with dozens or hundreds of units. Do NOT create unit-level rows. Use major regions ("Eastern", "Western") or "Statewide." If a state has dramatically different dates by region (like Colorado's 4 rifle seasons), create one row per major season with a note explaining the variation.

**Alaska and Hawaii:** Treat them normally. Fill in what exists, note the oddities. They'll have unusual data and that's fine.

**States with no season for a species:** SKIP entirely. No placeholder rows. Not every state has a dove season or a fall turkey season. Only create rows where a season actually exists.

**Unpublished 2025-2026 regulations:** If a state hasn't published 2025-2026 dates yet, use the 2024-2025 dates with `Verified = FALSE` and put "Dates from 2024-2025, not yet published for 2025-2026" in Notes.

## Where to Find the Data

Every state has a DNR, Game & Fish Commission, or Wildlife Agency that publishes official hunting regulations. Search for:
- `[State] 2025-2026 duck hunting season dates`
- `[State] waterfowl hunting regulations 2025`
- `[State] deer season dates 2025`
- `[State] DNR hunting seasons`

The official regulation page URL goes in the Source URL column. Common sources:
- State `.gov` wildlife/DNR pages
- State game commission PDF regulation booklets
- USFWS migratory bird frameworks (for federal flyway-level waterfowl dates)

**Do NOT use** hunting forums, outdoors blogs, or third-party aggregator sites as primary sources. Always go to the official state agency page.

## Priority Order — Work Through In This Sequence

1. **Duck** — All 50 states. This is the core product. Get every zone and every split right.
2. **Goose** — All 50 states. You're already on the waterfowl regulation pages from duck research, so grab goose dates at the same time. Include both regular Canada goose season AND light goose conservation order where applicable.
3. **Deer** — All 50 states. Most states have at least archery + rifle. Many also have muzzleloader and/or crossbow as separate seasons.
4. **Turkey** — All 50 states. Most states have spring. About half have fall.
5. **Dove** — ~40 states have dove seasons. Skip states with no dove season.

## Quality Standards

- Every date MUST be ISO format: `2025-11-22` — never "Nov 22" or "November 22, 2025"
- Every row MUST have a Source URL
- If you can't find reliable data for a state+species, SKIP IT rather than guess
- When in doubt, note the ambiguity in Notes
- Close date must be after open date for every split
- All abbreviations must be valid 2-letter US state codes

Complete each species fully (all 50 states) before moving to the next. Output the CSV for each species as you finish it. Take your time — accuracy over speed.

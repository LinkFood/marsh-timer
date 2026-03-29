# DCD Redesign v3 — Making the Brain Talk

> **Read CLAUDE.md first. Then read this. Then use Chrome to look at duckcountdown.com.**
> **This is NOT a rebuild. It's targeted fixes to what shipped yesterday.**
> **Do NOT delete or restructure the layout. The three-column terminal layout stays.**

---

## What Shipped (All Good — Keep It)

- Left column: Convergence Scoreboard with mini-bars + sparkline trends
- Center: Mapbox map + bottom panel with TIMELINE | COLLISIONS tabs
- Right column: State detail (arc pips, components, narrative, outcome verdict)
- Right column default: HOTTEST STATES summary (TX 79, NJ 76, VA 76)
- Top bar: SURGE stats, EMB count, CRONS status
- Ticker: Live scrolling alerts
- Collision feed with tabs: ALL / CONNECTIONS / ALERTS / GRADES

---

## What's Wrong — Five Specific Problems to Fix

### Problem 1: The Collision Feed Is a Log, Not a Narration (HIGHEST PRIORITY)

**Current state:** Every entry in the collision feed looks like this:
```
14m  RISK  OK  TX — Compound risk: COMPOUND RISK: TX — 5 domains converging (2026-03-28)
```

This is just a reformatted alert string. It's the same data as the ticker, displayed differently. There's no brain reasoning, no historical context, no odds, no connection explanation.

**What it should look like:** Each collision entry should be a card with layers of information:

```
+-------------------------------------------------------------+
| COMPOUND RISK — TX                              14m ago      |
|                                                              |
| 5 domains converging simultaneously in Texas                 |
|                                                              |
| WHAT CONNECTED:                                              |
| * Weather: 3x pressure_drop + cold_front at KIAH            |
| * Migration: eBird density spike 163% above baseline         |
| * Solunar: First quarter — major feed window                 |
| * Water: USGS flow rising                                    |
| * Pattern: Historical match strength 15/15                   |
|                                                              |
| BRAIN: "The last 14 times I saw 5+ domains converge in      |
| March in Gulf states, 8 resulted in significant weather      |
| events within 72 hours. Historical odds: 57%."               |
|                                                              |
| > Watching for 3 confirmation signals  *  Deadline Apr 3     |
+-------------------------------------------------------------+
```

**How to implement:**

The current collision feed likely pulls from `hunt_convergence_alerts` or `hunt_knowledge` and just dumps the raw title/summary. Instead:

1. **Enrich the feed entries server-side.** Create or modify the edge function that feeds the collision data. For each compound risk or convergence alert:
   - Pull the current convergence score components for that state (which domains are active and their values)
   - Pull recent `hunt_pattern_links` for that state (cross-domain connections with similarity scores)
   - Pull the arc data from `hunt_alert_outcomes` (what claims are open, what's confirmed)
   - Optionally: call Haiku to generate a 1-2 sentence "brain narration" from the raw data

2. **Redesign the card component.** Each collision feed entry should have:
   - **Header:** Event type badge (RISK/CONNECTION/ALERT/GRADE) + state + time ago
   - **What happened:** One line summary in plain language
   - **What connected:** Bullet list of the specific signals from each domain that converged
   - **Brain narration:** The AI-generated or template-generated reasoning
   - **Status footer:** Arc phase, confirmation count, deadline

3. **Make cards expandable.** Compact view shows header + one-line summary. Click to expand and see the full connection list + brain narration.

### Problem 2: "No connections found" in State Detail

**Current state:** When you click TX (score 79, 7 domains converging), the CONNECTIONS section in the right panel says "No connections found (72h)." This is almost certainly a query issue.

**Debug steps:**
1. Check the `hunt_pattern_links` table — are there recent entries for TX?
2. If data exists, the frontend hook/query has a bug — likely wrong column name or filter
3. If no data exists, check if `scanBrainOnWrite` is finding matches for TX

**Fix:** Get real pattern_links data showing in the CONNECTIONS section.

### Problem 3: Feed Entries All Look the Same

**Current state:** Every entry has the same visual treatment — red RISK badge, same text format.

**Fix:** Differentiate entry types visually:

| Type | Left border | Badge color | Badge text |
|------|------------|-------------|------------|
| Compound risk | Red (#ef4444) | Red bg | RISK |
| Cross-domain connection | Purple (#a855f7) | Purple bg | LINK |
| Weather/NWS alert | Amber (#f59e0b) | Amber bg | ALERT |
| Confirmation signal | Green (#22c55e) | Green bg | CONFIRM |
| Grade result | Cyan (#5eead4) | Cyan bg | GRADE |
| Data arrival | Gray (#6b7280) | Gray bg | DATA |

### Problem 4: The Collision Feed Needs More Space

**Fix:** Add a resizable divider between the map and the collision feed. Let the user drag the divider up to give the feed more space. Default split should be roughly 50/50, not the current 85/15.

### Problem 5: The Hottest States Default Could Be Richer

**Enhance to show for each hot state:**
- The mini-bar from the scoreboard (same domain color bars)
- The arc phase badge
- Confirmation count if in outcome phase
- A one-line summary

---

## Implementation Order

1. **Fix Problem 2 first** (connections query) — likely a quick bug fix
2. **Fix Problem 3** (visual differentiation) — different badges and borders
3. **Fix Problem 1** (enrich collision feed) — the big one
4. **Fix Problem 4** (resizable divider for feed space)
5. **Fix Problem 5** (richer hottest states default)

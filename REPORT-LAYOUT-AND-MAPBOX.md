# Layout & Mapbox Capabilities Report

**Date:** March 20, 2026
**Based on:** Live site testing, full codebase audit, Mapbox GL JS v3 research

---

## PART 1: THE LAYOUT PROBLEM

### What I Saw

The default layout is a 5-row CSS grid:
- Row 1: Heartbeat bar (28px)
- Row 2: Event ticker (32px)
- Row 3: Map region (55% desktop, 45% mobile)
- Row 4: Panel dock (1fr — whatever's left)
- Row 5: Bottom bar (40px)

On a 1440x813 viewport, the map eats ~500px. After subtracting the heartbeat (28), ticker (32), and bottom bar (40), that leaves roughly 213px for panels. Three panels side by side at 213px tall are basically title bars with a sliver of content. The History Replay sparkline barely fits. The Convergence History numbers are cropped. Brain Search shows just the search bar and an icon.

The map, meanwhile, is showing a dark satellite globe with state labels. When there are no layers active, it's ~500px of near-empty dark space. Even with the convergence heatmap on, the useful visual information (the colored states) occupies maybe 40% of the map region — the rest is ocean, Canada, and atmosphere glow.

### What the Code Says

`MapRegion.tsx` has a drag handle at the bottom to resize. Default height is 40% desktop, 35% mobile. Min: 200px. It reserves 250px minimum for panels (`MIN_PANEL_SPACE`). Height persists to localStorage. So users CAN resize — but the default is map-heavy, and most users won't discover the drag handle.

The grid preset system offers 6 options: Default (12-col), Full Panels (map hidden), Map Focus (map dominant + sidebar panels), 2 Columns, 3 Columns, 4 Columns. These are good. But:

- **Full Panels** hides the map entirely — you lose all geographic context.
- **Map Focus** makes panels a single row at the bottom — basically unusable.
- There's no hybrid that gives both map and panels meaningful space.

The deck templates (Command Center, Hunting Mode, Minimal, Research, Weather Station, Wildlife Monitor) change which panels load and which layers activate, but they all use the same map-on-top / panels-on-bottom split. No template puts the map into a panel.

### The Core Issue

The map is structurally locked as a fixed region above the panel dock. It can grow or shrink, but it's always a full-width horizontal band. This means:

- Map and panels compete for the same vertical space
- More map = less panels, more panels = less map
- There's no way to have the map AS a panel — draggable, resizable, closeable, side-by-side with other panels
- On a 1080p laptop (most common), the vertical squeeze is even worse

---

## PART 2: THE MAP-AS-PANEL CONCEPT

You said: "It'd be cool if we could put that into its own card if we needed to."

This is the right instinct. Here's what that looks like architecturally:

### Option A: Map Panel (New Panel Type)

Register a `MapPanel` in PanelRegistry alongside the other 18 panels. It renders the same Mapbox GL instance but inside a panel wrapper — draggable, resizable, fullscreen-able, closeable.

**How it works:**
- When the user switches to "Full Panels" grid preset (map hidden), the map panel becomes available in the panel catalog
- User adds it like any other panel — it shows up in the grid at whatever size they want
- They can put it side-by-side with State Screener, Brain Activity, or Chat
- Fullscreen button on the map panel = full-viewport map (same as current fullscreen panels)
- Close the map panel = just panels, no map (same as Full Panels mode today)

**The technical challenge:** Mapbox GL doesn't love being moved between DOM parents. The map instance would need to either be re-created when switching from fixed-region to panel mode (brief flash), or use a persistent off-screen canvas that gets repositioned (complex but seamless). The simpler approach: just let Full Panels mode offer a MapPanel, and Default mode keeps the fixed map. Two rendering modes for the same Mapbox instance.

**What changes:**
- `PanelRegistry.ts`: Add `map` panel definition (category: 'Environment', defaultW: 6, defaultH: 6)
- `MapPanel.tsx`: New component that renders `MapView` inside panel wrapper
- `DeckLayout.tsx`: When `equal-grid` preset is active, set map row to 0px and inject map panel if not already present
- `MapView.tsx`: Accept a `containerRef` prop to mount into either the fixed region or a panel

### Option B: Side-by-Side Layout (Map Left, Panels Right)

Instead of map-on-top / panels-on-bottom, offer a horizontal split: map on the left 50-60%, panel grid on the right 40-50%. This is closer to what Bloomberg Terminal, Grafana, or any command center looks like.

**How it works:**
- New grid preset: `'side-by-side'`
- DeckLayout switches from vertical 5-row grid to a 2-column grid
- Left column: map (full height minus header/heartbeat/ticker)
- Right column: scrollable panel dock (full height)
- Drag handle between them (horizontal resize, like VS Code sidebar)

**What changes:**
- `DeckLayout.tsx`: New conditional layout when preset is `side-by-side`
- `MapRegion.tsx`: Support both vertical (current) and horizontal (new) sizing
- Grid preset dropdown: Add "Side by Side" option

### Option C: Floating Map (Most Flexible, Most Complex)

The map becomes a floating, draggable overlay that can be positioned anywhere on screen, resized freely, and layered over or under panels. Think picture-in-picture.

This is the most powerful option but also the most complex to build. Probably not worth it right now when Option A + B cover 90% of use cases.

### My Recommendation

**Do Option A first** (map as panel in Full Panels mode), then **Option B** (side-by-side layout) as a new grid preset. Together, these give users three fundamental layouts:

1. **Map-forward** (current default) — map on top, panels below
2. **Data-forward** (Full Panels + map panel) — all panels including map, arranged freely
3. **Command center** (side-by-side) — map left, panels right

And the existing Map Focus and collapse toggle still work for dedicated map viewing.

---

## PART 3: MAPBOX — WHAT YOU'RE NOT USING

You're paying for Mapbox and using satellite-streets-v12 with 27 custom layers, 3D terrain, and state-level interactions. Here's what you're leaving on the table, organized by impact.

### HIGH IMPACT — Should Build

**1. Fill-Extrusion 3D Choropleth**

Right now, the convergence heatmap colors states on a flat 2D map. Mapbox `fill-extrusion` can make the height of each state proportional to its convergence score. Idaho at 80 literally rises off the map. Arkansas at 45 stays flat. You see the entire country's convergence landscape in 3D at a glance.

This is one layer addition in MapView.tsx. Data-driven `fill-extrusion-height` expression mapped from convergence score. Data-driven `fill-extrusion-color` for the gradient. Free tier, no extra API calls. The convergence data is already fetched — just needs to be joined to state polygons.

Can also apply this to: drought severity (taller = worse), migration spike intensity, NWS alert density, water levels. Each becomes a different 3D visualization mode.

**2. Fog & Atmosphere**

The globe view has a dark glow at the edges. Mapbox fog adds proper atmospheric depth — light color scattering at the horizon, depth cue fog that fades distant tiles. The `star-intensity` property adds parallax stars on the globe. This is purely visual but it makes the globe view feel like a real earth observation system instead of a dark sphere.

```javascript
map.setFog({
  color: 'rgb(10, 15, 26)',        // matches your #0a0f1a background
  'high-color': 'rgb(20, 40, 80)', // atmosphere glow
  'horizon-blend': 0.08,
  'space-color': 'rgb(5, 8, 15)',
  'star-intensity': 0.4
});
```

Zero cost. 3 lines of code. Huge visual upgrade.

**3. Animated Line Gradients for Migration Flows**

The migration front layer currently shows a static line. Mapbox `line-gradient` can color a line from south (warm/red) to north (cool/blue) based on `line-progress`. Combined with periodic geometry updates (shifting points along the line), this creates an animated migration flow that shows direction, intensity, and extent.

Applies to: flyway corridors (animated bird flow), weather front movement (cold front pushing south), water current patterns.

**4. Clustering for eBird/iNaturalist Points**

When eBird sightings layer is on, individual points can overwhelm the map at low zoom. Mapbox client-side clustering (`cluster: true` on GeoJSON source) automatically aggregates nearby points into count bubbles. At zoom 3, you see "Arkansas: 342 sightings" as a single bubble. Zoom in, it disaggregates into individual pins.

Data-driven circle size (`point_count` → radius) and color (`point_count` → gradient). Already built into Mapbox. You just set `cluster: true, clusterMaxZoom: 14, clusterRadius: 50` on the source.

**5. Camera Fly-To with Pitch/Bearing**

When a user clicks a state in the State Screener or Convergence Scores panel, the map should do a cinematic `flyTo()` — not just recentering but pitching to 45° and bearing to show the state in 3D perspective. This makes state selection feel like you're dropping into that state's intelligence view.

```javascript
map.flyTo({
  center: [stateLng, stateLat],
  zoom: 7,
  pitch: 45,
  bearing: -15,
  duration: 2000,
  essential: true
});
```

The `MapActionContext` already supports `flyTo` and `flyToCoords`. This is extending those to include pitch/bearing parameters.

### MEDIUM IMPACT — Worth Building

**6. Mapbox Standard Style (Hybrid)**

You're on satellite-streets-v12. Mapbox Standard offers dynamic lighting (Day/Dusk/Dawn/Night presets), 3D buildings, and the layer slot system (bottom/middle/top) that guarantees your custom layers don't collide with basemap labels.

You can't combine Standard and satellite directly, but you can: use Standard as the base style and add satellite imagery as a raster source layer beneath your data layers. This gives you the Standard features (lighting, slots, 3D) with satellite imagery where you want it.

The slot system alone is worth investigating — right now, with 27+ custom layers, z-ordering is likely fragile. Slots guarantee your convergence heatmap goes in `bottom`, weather radar in `middle`, and NWS alert polygons in `top`.

**7. Elevation Querying**

`map.queryTerrainElevation([lng, lat])` returns elevation at any point using already-loaded DEM tiles — no API call, no cost. Use this for:
- Show elevation on hover ("ELEV: 5,152ft" — already exists in bottom-left, but make it dynamic)
- Elevation profiles along flyway corridors
- Correlate elevation with migration patterns ("birds follow river valleys below 2000ft")

**8. Feature State for Hover/Selection**

Instead of repainting entire layers on hover, use Mapbox `feature-state` to set per-feature state (e.g., `hover: true`, `selected: true`) and use expressions to style based on that state. Faster rendering, cleaner code, and the state persists across map redraws.

```javascript
map.on('mousemove', 'states-layer', (e) => {
  map.setFeatureState({ source: 'states', id: e.features[0].id }, { hover: true });
});
```

Then in the layer paint: `['case', ['boolean', ['feature-state', 'hover'], false], '#00ffff', '#1a1a2e']`

**9. Static Images API for Sharing**

The share button on panels could generate a static map image (PNG) of the current view + active layers. Mapbox Static Images API renders up to 1280x1280. Free tier: 100/month. Use for: daily email briefings, social sharing, embedding in scout reports.

### LOWER IMPACT — Nice to Have

**10. Heatmap Layer (Alternative to Choropleth)**

Instead of coloring state polygons, render a continuous density heatmap from point data. Migration spike locations become hot spots. Weather event clusters glow. This is a different visual language than the state-level choropleth — it shows concentration regardless of state boundaries.

**11. Isochrone API**

"What's within 2 hours of my location?" — renders a polygon of reachable area. Useful for hunting accessibility but also for "which weather stations are within range of this event." Costs per request after 300/month free tier.

**12. Mapbox Tiling Service (MTS)**

For the 486K+ hunt_knowledge entries, you could precompute tilesets for high-traffic visualizations (eBird by state, weather events by type). MTS auto-generates optimized vector tiles from your data. Dramatically faster rendering than client-side GeoJSON. Worth exploring as the brain grows past 1M entries.

---

## PART 4: BUGS FOUND DURING TESTING

**1. Panel crash on Command Center template**

Convergence Scores and Daily Brief panels both crashed: "Panel crashed: Failed to fetch dynamically imported module: https://www.duckcountdown.com/asset." This is a Vite chunk issue — the lazy-loaded panel components are pointing to a stale asset hash. Likely needs a cache-bust or the chunk files got removed during a deploy.

**2. Two panels crashed shows ErrorBoundary is working**

The error messages are visible and descriptive, which means your ErrorBoundary in PanelWrapper is doing its job. But the panels are non-functional. This is a P0 for the Command Center template — the primary "show me everything" view loads with two of its three intelligence panels broken.

**3. CRONS: 10/14**

The heartbeat bar shows 10 of 14 crons active. Up from 5/14 earlier today — the correlation engine and other systems are coming online. But 4 crons are still not reporting. Worth checking hunt-cron-health to see which 4 are silent.

---

## PART 5: RECOMMENDED BUILD ORDER

**Phase 1 — Quick Visual Wins (1 day)**
1. Add fog/atmosphere to globe view (3 lines of code)
2. Add fill-extrusion 3D choropleth for convergence scores
3. Add camera pitch/bearing to state flyTo actions

**Phase 2 — Map as Panel (2-3 days)**
4. Register MapPanel in PanelRegistry
5. Build MapPanel.tsx component
6. Wire Full Panels mode to auto-add map panel
7. Test map instance lifecycle (create/destroy vs. persist)

**Phase 3 — Side-by-Side Layout (2-3 days)**
8. Add `side-by-side` grid preset
9. Modify DeckLayout for horizontal split
10. Add horizontal drag handle between map and panel columns
11. Update bottom bar to show new preset option

**Phase 4 — Data Visualization Upgrades (1 week)**
12. eBird clustering on map
13. Animated migration flow lines
14. Feature state hover/selection
15. Explore Standard style hybrid for slot system

**Phase 5 — Advanced (ongoing)**
16. Static Images API for sharing
17. Elevation profiles along flyways
18. Precomputed tilesets via MTS as brain grows
19. Isochrone accessibility maps (if user location is available)

---

## SUMMARY

The layout needs to break free from the rigid map-on-top / panels-on-bottom split. Making the map a panel and adding a side-by-side layout mode gives users the flexibility to arrange their workspace like a real command center. On the Mapbox side, you're using maybe 30% of what's available — 3D fill-extrusion, fog/atmosphere, animated line gradients, clustering, and cinematic camera transitions are all free-tier features that would make the map feel like a living intelligence surface instead of a static background. The 3D convergence choropleth alone would be a visual game-changer — states literally rising off the map based on their score.

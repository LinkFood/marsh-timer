# Core Logic Agent Memory — Duck Countdown

## Project
- **Location:** `/Users/jameschellis/marsh-timer`
- **Map component:** `src/components/MapView.tsx` (~2200 lines) — the monolith. All map layers, sources, mode switching, animations.

## Key Architecture Patterns

### MapView Layer System
- `LAYER_MODES` dict (line 43-83) controls which layers show in which modes
- Mode switching effect (line 1928-2062) handles: layer visibility, state fill coloring, wind/isobar data
- Default mode fill uses `buildFillExpression()` which maps season status to species colors
- Intel mode overrides fill with convergence score colors
- Weather mode overrides fill with temperature colors

### Adding a New Map Layer (recipe)
1. Add source in `addSourcesAndLayers()` callback
2. Add layer in same callback
3. Register layer ID in `LAYER_MODES` dict with which modes show it
4. If data-driven: add GeoJSON source update in a `useEffect`
5. If animated: add to `startPulse()` animation loop

### Data Flow to Map
- `useNationalWeather` → `weatherCache` (Map<string, StateWeather>) — current weather for 50 states
- `useConvergenceScores` → full ConvergenceScore objects in Index.tsx, but only `Map<string, number>` passed to MapView
- State centroids computed from TopoJSON, stored in `centroidsRef`

## Scoping Calibration
- (2026-03-07) Scoped 5 map features. No actuals yet to compare against.
- Color tuning: truly small (<30 min). Just paint property changes.
- New data-driven layer with existing data: 2-3 hours (source + layer + mode registration + legend)
- New data-driven layer needing API changes: 3-5 hours
- Canvas/WebGL custom rendering: 8+ hours minimum, mobile perf risk

## Files That Always Change Together
- `MapView.tsx` + `LAYER_MODES` dict when adding any visual layer
- `Index.tsx` when new data hooks need to flow to MapView
- `MapLegend.tsx` when any new visual needs explanation
- `speciesConfig.ts` when changing species color palettes

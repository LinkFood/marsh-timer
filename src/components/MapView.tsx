import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import mapboxgl from "mapbox-gl";
import { useOceanBuoys } from "@/hooks/useOceanBuoys";
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Species } from "@/data/types";
import type { StateArc } from "@/hooks/useStateArcs";
import { speciesConfig } from "@/data/speciesConfig";
import { fipsToAbbr } from "@/data/fips";
import { getPrimarySeasonForState, getStatesForSpecies } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";
import { getPopupHTML, type PopupArcInfo } from "@/components/MapPopup";
import { getSightingPopupHTML } from "@/components/SightingPopup";
import { stateFlyways, FLYWAY_COLORS, isFlywaySpecies } from "@/data/flyways";
import { FLYWAY_CORRIDORS, FLYWAY_FLOW_LINES } from "@/data/flywayPaths";
import { calculateTerminator, calculateGoldenHour } from "@/lib/terminator";
import type { FeatureCollection, Feature, Geometry, Position, LineString } from "geojson";
import { generateIsobars } from "@/lib/isobars";
import type { WeatherTiles } from "@/hooks/useWeatherTiles";
import { LAYER_REGISTRY } from "@/layers/LayerRegistry";

/** All Mapbox layer IDs controlled by the layer system (derived from LAYER_REGISTRY) */
const ALL_TOGGLABLE_MAPBOX_LAYERS: string[] = Array.from(
  new Set(LAYER_REGISTRY.flatMap(l => l.mapboxLayers))
);

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export type MapMode = 'default' | 'scout' | 'weather' | 'terrain' | 'intel';

export interface MapOverlays {
  wetlands: boolean;
  waterBodies: boolean;
  landCover: boolean;
  contours: boolean;
  waterways: boolean;
  agriculture: boolean;
  parks: boolean;
  trails: boolean;
}

// Master layer-to-mode visibility map
// Each layer lists which modes it should be visible in
const LAYER_MODES: Record<string, Set<MapMode>> = {
  // Overlays — Scout/Terrain
  'wetland-fill': new Set(['scout']),
  'water-fill': new Set(['scout']),
  'waterway-lines': new Set(['scout']),
  'waterway-intermittent': new Set(['scout']),
  'waterway-labels': new Set(['scout']),
  'parks-fill': new Set(['scout']),
  'trails-lines': new Set(['scout']),
  'agriculture-fill': new Set(),
  'landcover-fill': new Set(['terrain']),
  'contour-lines': new Set(['terrain']),
  'contour-labels': new Set(['terrain']),
  // Weather
  'radar-overlay': new Set(['weather']),
  'temp-tiles-overlay': new Set(),
  'wind-flow': new Set(['weather']),
  'wind-speed-labels': new Set(['weather']),
  'wind-arrow-heads': new Set(['weather']),
  'isobar-lines': new Set(['weather']),
  'pressure-center-labels': new Set(['weather']),
  'nws-alert-fill': new Set(['weather', 'intel']),
  'nws-alert-outline': new Set(['weather', 'intel']),
  'nws-alert-labels': new Set(['weather', 'intel']),
  // Intel — convergence + migration
  'convergence-score-bg': new Set(['intel']),
  'convergence-score-label': new Set(['intel']),
  'convergence-forming-label': new Set(['intel']),
  'convergence-pulse': new Set(['intel']),
  'migration-front-glow': new Set(),
  'migration-front-line': new Set(),
  'migration-front-label': new Set(),
  // Flyways
  'flyway-corridor-fill': new Set(['scout']),
  'flyway-flow-lines': new Set(['scout']),
  'flyway-corridor-labels': new Set(['scout']),
  // eBird
  'ebird-heatmap': new Set(['default', 'intel']),
  'ebird-dots': new Set(['scout']),
  'ebird-cluster-glow': new Set(['scout']),
  'ebird-clusters': new Set(['scout']),
  'ebird-cluster-count': new Set(['scout']),
  // Pressure trends
  'pressure-trend-arrows': new Set(['weather']),
  // Perfect Storm (all modes — the point is to interrupt any view)
  'perfect-storm-glow': new Set(['default', 'scout', 'weather', 'terrain', 'intel']),
  'perfect-storm-ring': new Set(['default', 'scout', 'weather', 'terrain', 'intel']),
  // County boundaries
  'county-fill': new Set(['scout', 'intel']),
  // DU migration map pins (toggle-controlled, not mode-controlled)
  'du-pins-dots': new Set(),
  'du-pins-clusters': new Set(),
  'du-pins-cluster-count': new Set(),
  // Weather events from METAR pipeline
  'weather-event-circles': new Set(['default', 'weather', 'intel']),
  'weather-event-pulse': new Set(['default', 'weather', 'intel']),
  'weather-event-labels': new Set(['default', 'weather', 'intel']),
  // Ocean buoy stations
  'buoy-circles': new Set(['default', 'weather', 'intel']),
  'buoy-labels': new Set(['default', 'weather', 'intel']),
  // Arc phase state outlines
  'arc-phase-outline': new Set(['default', 'intel']),
};

function tempToColor(tempF: number): string {
  // Blue (cold) -> Cyan -> Green -> Yellow -> Orange -> Red (hot)
  if (tempF <= 0) return 'rgba(59, 130, 246, 0.6)';   // blue
  if (tempF <= 20) return 'rgba(56, 189, 248, 0.55)';  // light blue
  if (tempF <= 32) return 'rgba(34, 211, 238, 0.5)';   // cyan
  if (tempF <= 45) return 'rgba(52, 211, 153, 0.45)';  // green
  if (tempF <= 60) return 'rgba(163, 230, 53, 0.45)';  // lime
  if (tempF <= 75) return 'rgba(250, 204, 21, 0.5)';   // yellow
  if (tempF <= 85) return 'rgba(251, 146, 60, 0.55)';  // orange
  return 'rgba(239, 68, 68, 0.6)';                      // red
}

function convergenceToColor(score: number): string {
  // Subtle tint — let the map breathe. Only high scores pop.
  if (score >= 90) return 'rgba(220, 38, 38, 0.35)';     // deep red
  if (score >= 80) return 'rgba(239, 68, 68, 0.30)';     // red
  if (score >= 75) return 'rgba(249, 115, 22, 0.25)';    // orange-red
  if (score >= 70) return 'rgba(251, 146, 60, 0.22)';    // orange
  if (score >= 65) return 'rgba(245, 158, 11, 0.18)';    // amber
  if (score >= 60) return 'rgba(234, 179, 8, 0.15)';     // yellow
  if (score >= 55) return 'rgba(132, 204, 22, 0.12)';    // lime
  if (score >= 50) return 'rgba(34, 197, 94, 0.10)';     // green
  if (score >= 40) return 'rgba(20, 184, 166, 0.08)';    // teal
  if (score >= 30) return 'rgba(59, 130, 246, 0.06)';    // blue
  if (score >= 20) return 'rgba(99, 102, 241, 0.04)';    // indigo
  return 'rgba(100, 100, 100, 0.02)';                     // nearly invisible
}

function convergenceScoreColor(score: number): string {
  if (score >= 90) return '#dc2626';
  if (score >= 80) return '#ef4444';
  if (score >= 75) return '#f97316';
  if (score >= 70) return '#fb923c';
  if (score >= 65) return '#f59e0b';
  if (score >= 60) return '#eab308';
  if (score >= 55) return '#84cc16';
  if (score >= 50) return '#22c55e';
  if (score >= 40) return '#14b8a6';
  if (score >= 30) return '#3b82f6';
  if (score >= 20) return '#6366f1';
  return '#6b7280';
}

export interface MapViewProps {
  species: Species;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
  onDrillUp: () => void;
  showFlyways: boolean;
  isSatellite: boolean;
  show3D: boolean;
  isMobile?: boolean;
  weatherTiles?: WeatherTiles;
  countyGeoJSON?: FeatureCollection | null;
  sightingsGeoJSON?: FeatureCollection | null;
  onMoveEnd?: (center: [number, number], zoom: number) => void;
  weatherCache?: Map<string, { temp: number; wind: number; windDir: number; pressure: number; precip: number; pressureTrend: 'rising' | 'falling' | 'flat' }>;
  overlays?: MapOverlays;
  onElevation?: (elevation: number | null) => void;
  mapMode?: MapMode;
  convergenceScores?: Map<string, { score: number; weather_component: number; migration_component: number; birdcast_component: number; solunar_component: number; pattern_component: number; reasoning?: string }>;
  perfectStormStates?: Set<string>;
  nwsAlertsGeoJSON?: FeatureCollection | null;
  migrationFrontLine?: Feature<LineString> | null;
  scrubDate?: Date | null;
  showRadar?: boolean;
  showDUPins?: boolean;
  duPinsGeoJSON?: FeatureCollection | null;
  weatherEventsGeoJSON?: FeatureCollection | null;
  /** Set of Mapbox layer IDs that should be visible — when provided, overrides LAYER_MODES */
  visibleMapboxLayers?: Set<string>;
  /** Active state arcs — used for arc-phase outlines on map */
  stateArcs?: StateArc[];
}

export interface MapViewRef {
  flyTo: (abbr: string) => void;
  flyToCoords: (lng: number, lat: number, zoom?: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

const TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const US_CENTER: [number, number] = [-99.5, 38.5];
const US_ZOOM = 4.2;
const STATE_ZOOM = 7;
const DRILL_UP_ZOOM_THRESHOLD = 4.5;

function extractCoordinates(geometry: Geometry): Position[] {
  const coords: Position[] = [];
  function walk(arr: unknown): void {
    if (
      Array.isArray(arr) &&
      arr.length >= 2 &&
      typeof arr[0] === "number" &&
      typeof arr[1] === "number"
    ) {
      coords.push(arr as Position);
      return;
    }
    if (Array.isArray(arr)) {
      for (const item of arr) walk(item);
    }
  }
  if ("coordinates" in geometry) walk(geometry.coordinates);
  return coords;
}

function getConvergenceRank(abbr: string, scores?: Map<string, { score: number; weather_component: number; migration_component: number; birdcast_component: number; solunar_component: number; pattern_component: number; reasoning?: string }>): number | null {
  if (!scores || scores.size === 0) return null;
  const sorted = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const idx = sorted.findIndex(([a]) => a === abbr);
  return idx >= 0 ? idx + 1 : null;
}

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

function computeCentroid(feature: Feature): [number, number] | null {
  const coords = extractCoordinates(feature.geometry);
  if (coords.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of coords) {
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / coords.length, sumLat / coords.length];
}

function windFlowLine(center: [number, number], windDirDeg: number, lengthDeg: number = 0.5): [number, number][] {
  // windDir is meteorological (direction FROM), flow goes opposite
  const flowDirRad = ((windDirDeg + 180) % 360) * Math.PI / 180;
  const dx = Math.sin(flowDirRad) * lengthDeg / 2;
  const dy = Math.cos(flowDirRad) * lengthDeg / 2;
  return [
    [center[0] - dx, center[1] - dy],
    [center[0] + dx, center[1] + dy],
  ];
}

function buildFillExpression(
  species: Species,
  selectedState: string | null,
): mapboxgl.Expression {
  const colors = speciesConfig[species].colors;
  const statesWithData = getStatesForSpecies(species);
  const now = new Date();
  const entries: string[] = [];

  for (const abbr of statesWithData) {
    if (abbr === selectedState) {
      entries.push(abbr, colors.selected);
      continue;
    }
    const season = getPrimarySeasonForState(species, abbr);
    if (!season) {
      entries.push(abbr, colors.closed);
      continue;
    }
    const status = getSeasonStatus(season, now);
    entries.push(abbr, colors[status]);
  }

  return [
    "match",
    ["get", "abbr"],
    ...entries,
    colors.closed,
  ] as mapboxgl.Expression;
}

// Species-tinted satellite closed colors (brighter than streets, with opacity for satellite visibility)
const SATELLITE_CLOSED_COLORS: Record<Species, string> = {
  all: 'rgba(60, 100, 60, 0.85)',     // same as duck
  duck: 'rgba(60, 100, 60, 0.85)',    // dark green tint
  goose: 'rgba(45, 70, 110, 0.85)',   // dark blue tint
  deer: 'rgba(90, 65, 30, 0.85)',     // dark brown tint
  turkey: 'rgba(85, 40, 40, 0.85)',   // dark red tint
  dove: 'rgba(65, 60, 85, 0.85)',     // dark purple tint
};

function buildSatelliteFillExpression(
  species: Species,
  selectedState: string | null,
): mapboxgl.Expression {
  const colors = speciesConfig[species].colors;
  const closedColor = SATELLITE_CLOSED_COLORS[species];
  const statesWithData = getStatesForSpecies(species);
  const now = new Date();
  const entries: string[] = [];

  for (const abbr of statesWithData) {
    if (abbr === selectedState) {
      entries.push(abbr, colors.selected);
      continue;
    }
    const season = getPrimarySeasonForState(species, abbr);
    if (!season) {
      entries.push(abbr, closedColor);
      continue;
    }
    const status = getSeasonStatus(season, now);
    if (status === 'closed') {
      entries.push(abbr, closedColor);
    } else if (status === 'upcoming') {
      entries.push(abbr, 'rgba(70, 85, 110, 0.8)');
    } else {
      entries.push(abbr, colors[status]);
    }
  }

  return [
    "match",
    ["get", "abbr"],
    ...entries,
    closedColor,
  ] as mapboxgl.Expression;
}

function buildPulseFilter(species: Species): mapboxgl.Expression {
  const statesWithData = getStatesForSpecies(species);
  const now = new Date();
  const pulseStates: string[] = [];

  for (const abbr of statesWithData) {
    const season = getPrimarySeasonForState(species, abbr);
    if (!season) continue;
    const status = getSeasonStatus(season, now);
    if (status === "open" || status === "soon") {
      pulseStates.push(abbr);
    }
  }

  if (pulseStates.length === 0) {
    return ["==", ["get", "abbr"], "__none__"] as mapboxgl.Expression;
  }

  return [
    "in",
    ["get", "abbr"],
    ["literal", pulseStates],
  ] as mapboxgl.Expression;
}

function buildFlywayGeoJSON(
  statesGeoJSON: FeatureCollection,
): FeatureCollection {
  const features = statesGeoJSON.features
    .filter((f) => {
      const abbr = f.properties?.abbr;
      return abbr && abbr in stateFlyways;
    })
    .map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        flyway: stateFlyways[f.properties!.abbr as string],
        flywayColor:
          FLYWAY_COLORS[
            stateFlyways[
              f.properties!.abbr as string
            ] as keyof typeof FLYWAY_COLORS
          ],
      },
    }));

  return { type: "FeatureCollection", features };
}

const MapView = forwardRef<MapViewRef, MapViewProps>(function MapView(
  {
    species,
    selectedState,
    onSelectState,
    onDrillUp,
    showFlyways,
    isSatellite,
    show3D,
    isMobile = false,
    weatherTiles,
    countyGeoJSON = null,
    sightingsGeoJSON = null,
    onMoveEnd,
    weatherCache,
    overlays = { wetlands: false, waterBodies: false, landCover: false, contours: false, waterways: false, agriculture: false, parks: false, trails: false },
    onElevation,
    mapMode = 'default',
    convergenceScores,
    perfectStormStates,
    nwsAlertsGeoJSON = null,
    migrationFrontLine = null,
    showRadar = false,
    showDUPins = false,
    duPinsGeoJSON = null,
    weatherEventsGeoJSON = null,
    visibleMapboxLayers,
    stateArcs,
  },
  ref,
) {
  // When species is 'all', use 'duck' for visual rendering (colors, fills, pulses)
  const visualSpecies = species === 'all' ? 'duck' as Species : species;

  // Ocean buoy data — loaded directly in MapView to avoid Vite tree-shaking
  const { geoJSON: buoyGeoJSON } = useOceanBuoys();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const centroidsRef = useRef<Map<string, [number, number]>>(new Map());
  const pulseFrameRef = useRef<number>(0);
  const dashStepRef = useRef<number>(0);
  const lastDashTimeRef = useRef<number>(0);
  const statesGeoRef = useRef<FeatureCollection | null>(null);
  const loadedRef = useRef(false);
  const flyingRef = useRef(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const selectedStateRef = useRef(selectedState);
  const onSelectStateRef = useRef(onSelectState);
  const prevStyleRef = useRef<string>("dark");
  const weatherCacheRef = useRef(weatherCache);
  const convergenceRef = useRef(convergenceScores);
  const stateArcsRef = useRef(stateArcs);
  const mapModeRef = useRef(mapMode);
  const hoveredStateIdRef = useRef<number | null>(null);
  const [yesterdayScores, setYesterdayScores] = useState<Map<string, number> | null>(null);

  selectedStateRef.current = selectedState;
  weatherCacheRef.current = weatherCache;
  convergenceRef.current = convergenceScores;
  stateArcsRef.current = stateArcs;
  mapModeRef.current = mapMode;
  onSelectStateRef.current = onSelectState;

  const statesWithData = useMemo(
    () => getStatesForSpecies(species),
    [species],
  );

  // Expose imperative methods
  useImperativeHandle(
    ref,
    () => ({
      flyTo: (abbr: string) => {
        const map = mapRef.current;
        if (!map) return;
        const centroid = centroidsRef.current.get(abbr);
        if (centroid) {
          flyingRef.current = true;
          map.once('moveend', () => { flyingRef.current = false; });
          map.flyTo({ center: centroid, zoom: STATE_ZOOM, pitch: 45, bearing: -15, duration: 1500 });
        }
      },
      flyToCoords: (lng: number, lat: number, zoom = 15) => {
        const map = mapRef.current;
        if (!map) return;
        flyingRef.current = true;
        map.once('moveend', () => { flyingRef.current = false; });
        map.flyTo({ center: [lng, lat], zoom, pitch: 60, bearing: -20, duration: 2000 });
      },
      zoomIn: () => {
        const map = mapRef.current;
        if (map) map.zoomIn({ duration: 300 });
      },
      zoomOut: () => {
        const map = mapRef.current;
        if (map) map.zoomOut({ duration: 300 });
      },
      resetView: () => {
        const map = mapRef.current;
        if (!map) return;
        flyingRef.current = true;
        map.once('moveend', () => { flyingRef.current = false; });
        map.flyTo({ center: US_CENTER, zoom: US_ZOOM, pitch: 0, bearing: 0, duration: 1200 });
      },
    }),
    [],
  );

  const addSourcesAndLayers = useCallback(
    (map: mapboxgl.Map) => {
      const geoJSON = statesGeoRef.current;
      if (!geoJSON) return;

      // Hide base map labels
      const labelLayers =
        map
          .getStyle()
          .layers?.filter(
            (l) =>
              l.type === "symbol" &&
              (l.id.includes("label") ||
                l.id.includes("place") ||
                l.id.includes("state")),
          ) || [];
      for (const layer of labelLayers) {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }

      // States source
      if (!map.getSource("states")) {
        map.addSource("states", { type: "geojson", data: geoJSON, generateId: true });
      }

      // Mapbox Streets v8 (shared source for wetlands, agriculture, waterways, parks, trails)
      if (!map.getSource('streets-v8')) {
        map.addSource('streets-v8', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-streets-v8',
        });
      }

      // Mapbox Terrain v2 (land cover, contours)
      if (!map.getSource('terrain-v2')) {
        map.addSource('terrain-v2', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-terrain-v2',
        });
      }

      // States fill
      if (!map.getLayer("states-fill")) {
        map.addLayer({
          id: "states-fill",
          type: "fill",
          source: "states",
          paint: {
            "fill-color": buildFillExpression(visualSpecies, selectedState),
            "fill-opacity": 0.5,
          },
        });
      }

      // States 3D extrusion (convergence scores rise off the map)
      if (!map.getLayer("states-extrusion")) {
        map.addLayer({
          id: "states-extrusion",
          type: "fill-extrusion",
          source: "states",
          paint: {
            "fill-extrusion-color": buildFillExpression(visualSpecies, selectedState),
            "fill-extrusion-height": 0,
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.6,
          },
          layout: { visibility: 'none' },
        });
      }

      // Dawn/dusk terminator (night overlay + golden hour band)
      if (!map.getSource("terminator")) {
        const now = new Date();
        map.addSource("terminator", {
          type: "geojson",
          data: calculateTerminator(now),
        });
      }
      if (!map.getSource("golden-hour")) {
        const now = new Date();
        map.addSource("golden-hour", {
          type: "geojson",
          data: calculateGoldenHour(now),
        });
      }
      if (!map.getLayer("golden-hour-fill")) {
        map.addLayer({
          id: "golden-hour-fill",
          type: "fill",
          source: "golden-hour",
          paint: {
            "fill-color": "rgba(255, 180, 50, 0.30)",
            "fill-opacity": 0.8,
          },
        }, "states-fill");
      }
      if (!map.getLayer("terminator-fill")) {
        map.addLayer({
          id: "terminator-fill",
          type: "fill",
          source: "terminator",
          paint: {
            "fill-color": "rgba(0, 0, 20, 0.50)",
            "fill-opacity": 1,
          },
        }, "states-fill");
      }
      if (!map.getLayer("terminator-line")) {
        map.addLayer({
          id: "terminator-line",
          type: "line",
          source: "terminator",
          paint: {
            "line-color": "rgba(255, 180, 50, 0.8)",
            "line-width": 3,
          },
        });
      }

      // Pulse
      if (!map.getLayer("states-pulse")) {
        map.addLayer({
          id: "states-pulse",
          type: "fill",
          source: "states",
          filter: buildPulseFilter(visualSpecies),
          paint: {
            "fill-color": buildFillExpression(visualSpecies, selectedState),
            "fill-opacity": 0.5,
          },
        });
      }

      // Borders
      if (!map.getLayer("states-line")) {
        map.addLayer({
          id: "states-line",
          type: "line",
          source: "states",
          paint: { "line-color": "rgba(255,255,255,0.15)", "line-width": 0.8 },
        });
      }

      // Selected outline
      if (!map.getLayer("states-selected-outline")) {
        map.addLayer({
          id: "states-selected-outline",
          type: "line",
          source: "states",
          filter: ["==", ["get", "abbr"], selectedState || ""],
          paint: {
            "line-color": speciesConfig[visualSpecies].colors.selected,
            "line-width": 2,
            "line-opacity": 0.7,
          },
        });
      }

      // Flyways
      const flywayGeo = buildFlywayGeoJSON(geoJSON);
      if (!map.getSource("flyways")) {
        map.addSource("flyways", { type: "geojson", data: flywayGeo });
      }
      if (!map.getLayer("flyway-fill")) {
        map.addLayer({
          id: "flyway-fill",
          type: "fill",
          source: "flyways",
          paint: {
            "fill-color": ["get", "flywayColor"],
            "fill-opacity": 0.15,
          },
          layout: {
            visibility:
              showFlyways && isFlywaySpecies(visualSpecies) ? "visible" : "none",
          },
        });
      }

      // Flyway corridor shapes (geographic bands)
      if (!map.getSource('flyway-corridors')) {
        map.addSource('flyway-corridors', { type: 'geojson', data: FLYWAY_CORRIDORS });
      }
      if (!map.getLayer('flyway-corridor-fill')) {
        map.addLayer({
          id: 'flyway-corridor-fill',
          type: 'fill',
          source: 'flyway-corridors',
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.8,
          },
          layout: { visibility: 'none' },
        }, 'states-fill');
      }

      // Flyway flow lines (animated center lines)
      if (!map.getSource('flyway-flow')) {
        map.addSource('flyway-flow', { type: 'geojson', data: FLYWAY_FLOW_LINES });
      }
      if (!map.getLayer('flyway-flow-lines')) {
        map.addLayer({
          id: 'flyway-flow-lines',
          type: 'line',
          source: 'flyway-flow',
          paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': 2,
            'line-dasharray': [2, 2],
          },
          layout: { visibility: 'none' },
        });
      }

      // Flyway corridor labels (along flow lines)
      if (!map.getLayer('flyway-corridor-labels')) {
        map.addLayer({
          id: 'flyway-corridor-labels',
          type: 'symbol',
          source: 'flyway-flow',
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 500,
            'text-field': ['get', 'name'],
            'text-size': 12,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            visibility: 'none',
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0, 0, 0, 0.8)',
            'text-halo-width': 1.5,
          },
        });
      }

      // Land Cover (terrain-v2 landcover layer)
      if (!map.getLayer('landcover-fill')) {
        map.addLayer({
          id: 'landcover-fill',
          type: 'fill',
          source: 'terrain-v2',
          'source-layer': 'landcover',
          paint: {
            'fill-color': [
              'match', ['get', 'class'],
              'crop', 'rgba(217, 181, 100, 0.35)',
              'wood', 'rgba(34, 139, 34, 0.3)',
              'grass', 'rgba(154, 205, 50, 0.25)',
              'scrub', 'rgba(107, 142, 35, 0.25)',
              'snow', 'rgba(255, 255, 255, 0.3)',
              'rgba(0,0,0,0)',
            ],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 7, 0.7],
          },
          layout: { visibility: 'none' },
        }, 'states-fill');
      }

      // Wetlands (streets-v8 landuse_overlay layer)
      if (!map.getLayer('wetland-fill')) {
        map.addLayer({
          id: 'wetland-fill',
          type: 'fill',
          source: 'streets-v8',
          'source-layer': 'landuse_overlay',
          filter: ['in', ['get', 'class'], ['literal', ['wetland', 'wetland_noveg']]],
          paint: {
            'fill-color': [
              'match', ['get', 'class'],
              'wetland', 'rgba(0, 180, 180, 0.4)',
              'wetland_noveg', 'rgba(0, 150, 200, 0.35)',
              'rgba(0,0,0,0)',
            ],
            'fill-outline-color': 'rgba(0, 200, 200, 0.6)',
          },
          layout: { visibility: 'none' },
        }, 'states-fill');
      }

      // Water bodies — lakes, ponds, reservoirs (streets-v8 water layer)
      if (!map.getLayer('water-fill')) {
        map.addLayer({
          id: 'water-fill',
          type: 'fill',
          source: 'streets-v8',
          'source-layer': 'water',
          paint: {
            'fill-color': 'rgba(30, 100, 200, 0.5)',
            'fill-outline-color': 'rgba(59, 130, 246, 0.7)',
          },
          minzoom: 5,
          layout: { visibility: 'none' },
        }, 'states-fill');
      }

      // Agriculture (streets-v8 landuse layer)
      if (!map.getLayer('agriculture-fill')) {
        map.addLayer({
          id: 'agriculture-fill',
          type: 'fill',
          source: 'streets-v8',
          'source-layer': 'landuse',
          filter: ['==', ['get', 'class'], 'agriculture'],
          paint: {
            'fill-color': 'rgba(217, 181, 100, 0.3)',
            'fill-outline-color': 'rgba(217, 181, 100, 0.5)',
          },
          layout: { visibility: 'none' },
        }, 'states-fill');
      }

      // Parks (streets-v8 landuse layer)
      if (!map.getLayer('parks-fill')) {
        map.addLayer({
          id: 'parks-fill',
          type: 'fill',
          source: 'streets-v8',
          'source-layer': 'landuse',
          filter: ['in', ['get', 'class'], ['literal', ['park', 'national_park']]],
          paint: {
            'fill-color': 'rgba(34, 197, 94, 0.25)',
            'fill-outline-color': 'rgba(34, 197, 94, 0.5)',
          },
          layout: { visibility: 'none' },
        }, 'states-fill');
      }

      // Waterways - solid (streets-v8 waterway layer, excluding intermittent)
      if (!map.getLayer('waterway-lines')) {
        map.addLayer({
          id: 'waterway-lines',
          type: 'line',
          source: 'streets-v8',
          'source-layer': 'waterway',
          filter: ['!=', ['get', 'class'], 'stream_intermittent'],
          paint: {
            'line-color': [
              'match', ['get', 'class'],
              'river', 'rgba(59, 130, 246, 0.8)',
              'canal', 'rgba(59, 130, 246, 0.6)',
              'stream', 'rgba(59, 130, 246, 0.5)',
              'drain', 'rgba(59, 130, 246, 0.3)',
              'ditch', 'rgba(59, 130, 246, 0.25)',
              'rgba(59, 130, 246, 0.4)',
            ],
            'line-width': [
              'match', ['get', 'class'],
              'river', 2.5,
              'canal', 1.8,
              'stream', 1.2,
              0.8,
            ],
          },
          minzoom: 7,
          layout: { visibility: 'none' },
        });
      }

      // Waterways - intermittent (dashed, separate layer because line-dasharray doesn't support expressions)
      if (!map.getLayer('waterway-intermittent')) {
        map.addLayer({
          id: 'waterway-intermittent',
          type: 'line',
          source: 'streets-v8',
          'source-layer': 'waterway',
          filter: ['==', ['get', 'class'], 'stream_intermittent'],
          paint: {
            'line-color': 'rgba(59, 130, 246, 0.35)',
            'line-width': 0.8,
            'line-dasharray': [2, 2],
          },
          minzoom: 10,
          layout: { visibility: 'none' },
        });
      }

      // Waterway labels (streets-v8 waterway layer — river/stream names)
      if (!map.getLayer('waterway-labels')) {
        map.addLayer({
          id: 'waterway-labels',
          type: 'symbol',
          source: 'streets-v8',
          'source-layer': 'waterway',
          filter: ['in', ['get', 'class'], ['literal', ['river', 'canal', 'stream']]],
          layout: {
            'symbol-placement': 'line',
            'text-field': ['get', 'name'],
            'text-size': ['match', ['get', 'class'], 'river', 11, 'canal', 10, 9],
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            'text-max-angle': 30,
            visibility: 'none',
          },
          paint: {
            'text-color': 'rgba(100, 180, 255, 0.9)',
            'text-halo-color': 'rgba(0, 0, 0, 0.8)',
            'text-halo-width': 1.5,
          },
          minzoom: 10,
        });
      }

      // Contour lines (terrain-v2 contour layer)
      if (!map.getLayer('contour-lines')) {
        map.addLayer({
          id: 'contour-lines',
          type: 'line',
          source: 'terrain-v2',
          'source-layer': 'contour',
          paint: {
            'line-color': 'rgba(255, 255, 255, 0.2)',
            'line-width': [
              'match', ['get', 'index'],
              5, 1.2,
              10, 1.5,
              0.6,
            ],
          },
          minzoom: 11,
          layout: { visibility: 'none' },
        });
      }

      // Contour labels (terrain-v2 contour layer, only major contours)
      if (!map.getLayer('contour-labels')) {
        map.addLayer({
          id: 'contour-labels',
          type: 'symbol',
          source: 'terrain-v2',
          'source-layer': 'contour',
          filter: ['in', ['get', 'index'], ['literal', [5, 10]]],
          layout: {
            'symbol-placement': 'line',
            'text-field': ['concat', ['to-string', ['round', ['*', ['get', 'ele'], 3.281]]], 'ft'],
            'text-size': 9,
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            visibility: 'none',
          },
          paint: {
            'text-color': 'rgba(255, 255, 255, 0.5)',
            'text-halo-color': 'rgba(0, 0, 0, 0.8)',
            'text-halo-width': 1,
          },
          minzoom: 12,
        });
      }

      // Trails / dirt roads (streets-v8 road layer)
      if (!map.getLayer('trails-lines')) {
        map.addLayer({
          id: 'trails-lines',
          type: 'line',
          source: 'streets-v8',
          'source-layer': 'road',
          filter: ['in', ['get', 'class'], ['literal', ['track', 'path']]],
          paint: {
            'line-color': 'rgba(217, 181, 100, 0.6)',
            'line-width': 1,
            'line-dasharray': [2, 1],
          },
          minzoom: 12,
          layout: { visibility: 'none' },
        });
      }

      // Weather tile overlays (OWM or RainViewer fallback)
      const tileLayers: { id: string; url: string | null | undefined }[] = [
        { id: "radar", url: weatherTiles?.radar },
        { id: "temp-tiles", url: weatherTiles?.temperature },
      ];

      for (const { id, url } of tileLayers) {
        if (!map.getSource(id) && url) {
          map.addSource(id, {
            type: "raster",
            tiles: [url],
            tileSize: 256,
            maxzoom: id === "radar" ? 6 : 12,
          });
        }
        const layerId = `${id}-overlay`;
        if (!map.getLayer(layerId) && map.getSource(id)) {
          map.addLayer(
            {
              id: layerId,
              type: "raster",
              source: id,
              paint: { "raster-opacity": id === "radar" ? 0.6 : 0.5 },
              layout: { visibility: "none" },
            },
            "states-fill",
          );
        }
      }

      // County GeoJSON source + layers
      if (countyGeoJSON && !map.getSource("counties")) {
        map.addSource("counties", { type: "geojson", data: countyGeoJSON });

        map.addLayer({
          id: "county-fill",
          type: "fill",
          source: "counties",
          paint: {
            "fill-color": "rgba(255,255,255,0.03)",
            "fill-opacity": 0,
          },
          minzoom: 5,
          layout: { visibility: "none" },
        }, "states-fill");

        map.addLayer({
          id: "county-line",
          type: "line",
          source: "counties",
          paint: {
            "line-color": "rgba(255,255,255,0.5)",
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.2, 8, 0.6, 10, 1],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 6, 0.3, 8, 0.6],
          },
          minzoom: 5,
        });
      }

      // Labels
      const labelFeatures: FeatureCollection = {
        type: "FeatureCollection",
        features: geoJSON.features
          .filter((f) => {
            const abbr = f.properties?.abbr;
            return abbr && statesWithData.has(abbr);
          })
          .map((f) => {
            const abbr = f.properties!.abbr as string;
            const centroid = centroidsRef.current.get(abbr);
            return {
              type: "Feature" as const,
              geometry: {
                type: "Point" as const,
                coordinates: centroid || [0, 0],
              },
              properties: { abbr },
            };
          })
          .filter((f) => f.geometry.coordinates[0] !== 0),
      };

      if (!map.getSource("state-labels")) {
        map.addSource("state-labels", { type: "geojson", data: labelFeatures });
      }
      if (!map.getLayer("states-label")) {
        map.addLayer({
          id: "states-label",
          type: "symbol",
          source: "state-labels",
          layout: {
            "text-field": ["get", "abbr"],
            "text-size": 10,
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.8)",
            "text-halo-width": 1.5,
          },
        });
      }

      // eBird sighting markers (clustered source)
      const ebirdEmpty = { type: "FeatureCollection" as const, features: [] as any[] };
      if (!map.getSource("ebird-sightings")) {
        map.addSource("ebird-sightings", {
          type: "geojson",
          data: sightingsGeoJSON || ebirdEmpty,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        });
      }
      // Separate non-clustered source for heatmap
      if (!map.getSource("ebird-heatmap-source")) {
        map.addSource("ebird-heatmap-source", { type: "geojson", data: sightingsGeoJSON || ebirdEmpty });
      }
      // eBird heatmap layer
      if (!map.getLayer("ebird-heatmap")) {
        map.addLayer({
          id: "ebird-heatmap", type: "heatmap", source: "ebird-heatmap-source", minzoom: 3, maxzoom: 9,
          paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "count"], 0, 0.1, 5, 0.4, 20, 0.7, 100, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.3, 6, 0.8, 9, 1],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 15, 6, 25, 9, 35],
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.2, "rgba(16,185,129,0.3)", 0.4, "rgba(16,185,129,0.5)", 0.6, "rgba(245,158,11,0.6)", 0.8, "rgba(239,68,68,0.7)", 1, "rgba(239,68,68,0.85)"],
            "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 7, 0.5, 9, 0],
          },
        });
      }
      // eBird individual dots (unclustered only)
      if (!map.getLayer("ebird-dots")) {
        map.addLayer({
          id: "ebird-dots",
          type: "circle",
          source: "ebird-sightings",
          filter: ["!", ["has", "point_count"]],
          minzoom: 6,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 10, 6],
            "circle-color": [
              "match",
              ["get", "recency"],
              "today", "#10b981",
              "recent", "#f59e0b",
              "old", "#64748b",
              "#64748b",
            ],
            "circle-opacity": 0.8,
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(0,0,0,0.3)",
          },
        });
      }

      // eBird cluster circles
      if (!map.getLayer("ebird-clusters")) {
        map.addLayer({
          id: "ebird-clusters", type: "circle", source: "ebird-sightings",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "step", ["get", "point_count"],
              "#22d3ee",   // < 10 sightings: cyan-400
              10, "#06b6d4", // 10-50: cyan-500
              50, "#0891b2", // 50-100: cyan-600
              100, "#155e75", // 100+: cyan-800
            ],
            "circle-radius": [
              "step", ["get", "point_count"],
              12,          // < 10
              10, 18,      // 10-50
              50, 24,      // 50-100
              100, 32,     // 100+
            ],
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(0, 255, 255, 0.3)",
            "circle-opacity": 0.8,
          },
        });
      }
      if (!map.getLayer("ebird-cluster-glow")) {
        map.addLayer({
          id: "ebird-cluster-glow",
          type: "circle",
          source: "ebird-sightings",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "rgba(34, 211, 238, 0.1)",
            "circle-radius": [
              "step", ["get", "point_count"],
              20, 10, 30, 50, 40, 100, 55
            ],
            "circle-blur": 0.8,
          },
          layout: { visibility: 'none' },
        }, "ebird-clusters");
      }
      // eBird cluster count labels
      if (!map.getLayer("ebird-cluster-count")) {
        map.addLayer({
          id: "ebird-cluster-count", type: "symbol", source: "ebird-sightings",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-size": 13,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        });
      }

      // DU migration map pins (clustered)
      const duEmpty = { type: "FeatureCollection" as const, features: [] as any[] };
      if (!map.getSource("du-pins")) {
        map.addSource("du-pins", {
          type: "geojson",
          data: duPinsGeoJSON || duEmpty,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        });
      }
      // DU individual dots (unclustered)
      if (!map.getLayer("du-pins-dots")) {
        map.addLayer({
          id: "du-pins-dots",
          type: "circle",
          source: "du-pins",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2, 8, 5, 12, 7],
            "circle-color": [
              "step", ["get", "activity_level_id"],
              "#10b981",  // 0 = green (low/unknown)
              3, "#facc15", // 3 = yellow (medium)
              4, "#ef4444", // 4-5 = red (high)
            ],
            "circle-opacity": 0.85,
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(0,0,0,0.3)",
          },
          layout: { visibility: "none" },
        });
      }
      // DU cluster circles
      if (!map.getLayer("du-pins-clusters")) {
        map.addLayer({
          id: "du-pins-clusters",
          type: "circle",
          source: "du-pins",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#10b981", 20, "#facc15", 100, "#ef4444"],
            "circle-radius": ["step", ["get", "point_count"], 16, 20, 24, 100, 32],
            "circle-opacity": 0.75,
            "circle-stroke-width": 2,
            "circle-stroke-color": "rgba(255,255,255,0.4)",
          },
          layout: { visibility: "none" },
        });
      }
      // DU cluster count labels
      if (!map.getLayer("du-pins-cluster-count")) {
        map.addLayer({
          id: "du-pins-cluster-count",
          type: "symbol",
          source: "du-pins",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-size": 12,
            "text-allow-overlap": true,
            visibility: "none",
          },
          paint: { "text-color": "#ffffff" },
        });
      }

      // Wind flow lines source (LineStrings for animated flow)
      if (!map.getSource("wind-arrows")) {
        map.addSource("wind-arrows", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      // Wind speed label points source
      if (!map.getSource("wind-speed-points")) {
        map.addSource("wind-speed-points", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer("wind-flow")) {
        map.addLayer({
          id: "wind-flow",
          type: "line",
          source: "wind-arrows",
          minzoom: 3,
          layout: {
            "line-cap": "round",
            visibility: "none",
          },
          paint: {
            "line-color": [
              "interpolate", ["linear"], ["get", "windSpeed"],
              0, "rgba(200,220,255,0.7)",
              8, "rgba(200,220,255,0.7)",
              9, "rgba(34,211,238,0.85)",
              15, "rgba(34,211,238,0.85)",
              16, "rgba(251,191,36,0.9)",
              25, "rgba(251,191,36,0.9)",
              26, "rgba(239,68,68,0.95)",
            ],
            "line-width": [
              "interpolate", ["linear"], ["get", "windSpeed"],
              0, 1.5, 15, 4.5, 30, 7,
            ],
            "line-opacity": 0.75,
            "line-blur": [
              "interpolate", ["linear"], ["get", "windSpeed"],
              0, 0, 15, 1, 30, 2,
            ],
            "line-dasharray": [2, 2],
          },
        });
      }
      if (!map.getLayer("wind-speed-labels")) {
        map.addLayer({
          id: "wind-speed-labels",
          type: "symbol",
          source: "wind-speed-points",
          minzoom: 6,
          layout: {
            "text-field": ["concat", ["to-string", ["round", ["get", "windSpeed"]]], " mph"],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-size": 10,
            "text-allow-overlap": true,
            visibility: "none",
          },
          paint: {
            "text-color": "rgba(255,255,255,0.7)",
            "text-halo-color": "rgba(0,0,0,0.8)",
            "text-halo-width": 1,
          },
        });
      }

      // Wind arrowheads at line endpoints (text-based — sprite icons unreliable)
      if (!map.getLayer("wind-arrow-heads")) {
        map.addLayer({
          id: "wind-arrow-heads",
          type: "symbol",
          source: "wind-speed-points",
          minzoom: 3,
          layout: {
            "text-field": "▶",
            "text-size": [
              "interpolate", ["linear"], ["get", "windSpeed"],
              0, 12,
              15, 20,
              30, 28
            ],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-rotate": ["get", "windDir"],
            "text-rotation-alignment": "map",
            "text-allow-overlap": true,
            "text-offset": [0, 0],
            visibility: "none",
          },
          paint: {
            "text-color": [
              "interpolate", ["linear"], ["get", "windSpeed"],
              0, "rgba(200,220,255,0.7)",
              8, "rgba(200,220,255,0.7)",
              9, "rgba(34,211,238,0.85)",
              15, "rgba(34,211,238,0.85)",
              16, "rgba(251,191,36,0.9)",
              25, "rgba(251,191,36,0.9)",
              26, "rgba(239,68,68,0.95)",
            ],
            "text-halo-color": "rgba(0,0,0,0.6)",
            "text-halo-width": 1,
          },
        });
      }

      // Isobar contour lines source + layer
      if (!map.getSource("isobar-lines")) {
        map.addSource("isobar-lines", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer("isobar-lines")) {
        map.addLayer({
          id: "isobar-lines",
          type: "line",
          source: "isobar-lines",
          paint: {
            "line-color": "rgba(150, 200, 255, 0.5)",
            "line-width": [
              "case",
              ["get", "major"], 1.5,
              1,
            ],
            "line-opacity": 0.6,
          },
          layout: { visibility: "none" },
        });
      }

      // Pressure center labels (H/L markers)
      if (!map.getSource("pressure-centers")) {
        map.addSource("pressure-centers", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer("pressure-center-labels")) {
        map.addLayer({
          id: "pressure-center-labels",
          type: "symbol",
          source: "pressure-centers",
          layout: {
            "text-field": ["concat", ["get", "type"], "\n", ["to-string", ["get", "pressure"]]],
            "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
            "text-size": 22,
            "text-allow-overlap": true,
            "text-line-height": 1.1,
            visibility: "none",
          },
          paint: {
            "text-color": [
              "match", ["get", "type"],
              "H", "#3b82f6",
              "L", "#ef4444",
              "#ffffff",
            ],
            "text-halo-color": "rgba(0,0,0,0.8)",
            "text-halo-width": 2,
          },
        });
      }

      // Convergence score labels (floating numbers over states in Intel mode)
      if (!map.getSource("convergence-labels")) {
        const convFeatures: Feature[] = [];
        const scores = convergenceScores;
        if (scores) {
          for (const [abbr, data] of scores) {
            const centroid = centroidsRef.current.get(abbr);
            if (centroid) {
              convFeatures.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: centroid },
                properties: { abbr, score: data.score, scoreColor: convergenceScoreColor(data.score) },
              });
            }
          }
        }
        map.addSource("convergence-labels", {
          type: "geojson",
          data: { type: "FeatureCollection", features: convFeatures },
        });
      }
      if (!map.getLayer("convergence-score-bg")) {
        map.addLayer({
          id: "convergence-score-bg",
          type: "symbol",
          source: "convergence-labels",
          minzoom: 3.5,
          maxzoom: 7,
          layout: {
            "icon-image": "score-pill",
            "icon-allow-overlap": true,
            "icon-offset": [0, -18],
            visibility: mapMode === 'intel' ? 'visible' : 'none',
          },
        });
      }
      if (!map.getLayer("convergence-score-label")) {
        map.addLayer({
          id: "convergence-score-label",
          type: "symbol",
          source: "convergence-labels",
          minzoom: 3.5,
          maxzoom: 7,
          layout: {
            "text-field": [
              "concat",
              ["to-string", ["get", "score"]],
              ["case",
                [">=", ["get", "change"], 1], " \u25B2",
                ["<=", ["get", "change"], -1], " \u25BC",
                "",
              ],
            ],
            "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
            "text-size": [
              "step", ["get", "score"],
              11,   // 0-40: size 11
              41, 12,  // 41-60: size 12
              61, 13,  // 61-80: size 13
              81, 14,  // 81+: size 14
            ],
            "text-allow-overlap": true,
            "text-offset": [0, -1.5],
            visibility: mapMode === 'intel' ? 'visible' : 'none',
          },
          paint: {
            "text-color": [
              "step", ["get", "score"],
              "rgba(100,100,100,0.6)",  // 0-20
              21, "#3b82f6",             // 21-40
              41, "#facc15",             // 41-60
              61, "#fb923c",             // 61-80
              81, "#ef4444",             // 81+
            ],
            "text-halo-color": "rgba(0,0,0,0.9)",
            "text-halo-width": 1.5,
          },
        });
      }

      // Convergence "FORMING" badge (score jumped 15+ points from yesterday)
      if (!map.getLayer("convergence-forming-label")) {
        map.addLayer({
          id: "convergence-forming-label",
          type: "symbol",
          source: "convergence-labels",
          minzoom: 3.5,
          maxzoom: 7,
          filter: [">=", ["get", "change"], 15],
          layout: {
            "text-field": "\u25B2 FORMING",
            "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
            "text-size": 10,
            "text-allow-overlap": true,
            "text-offset": [0, 0.2],
            visibility: mapMode === 'intel' ? 'visible' : 'none',
          },
          paint: {
            "text-color": "#22d3ee",
            "text-halo-color": "rgba(0,0,0,0.9)",
            "text-halo-width": 1.5,
          },
        });
      }

      // Convergence hotspot pulsing rings (score >= 70)
      if (!map.getSource("convergence-hotspots")) {
        const hotspotFeatures: Feature[] = [];
        if (convergenceScores) {
          for (const [abbr, data] of convergenceScores) {
            if (data.score < 70) continue;
            const centroid = centroidsRef.current.get(abbr);
            if (centroid) {
              hotspotFeatures.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: centroid },
                properties: { abbr, score: data.score, tier: data.score >= 81 ? 'fire' : 'hot' },
              });
            }
          }
        }
        map.addSource("convergence-hotspots", {
          type: "geojson",
          data: { type: "FeatureCollection", features: hotspotFeatures },
        });
      }
      if (!map.getLayer("convergence-pulse")) {
        map.addLayer({
          id: "convergence-pulse",
          type: "symbol",
          source: "convergence-hotspots",
          layout: {
            "icon-image": [
              "match", ["get", "tier"],
              "fire", "pulsing-dot-fire",
              "pulsing-dot-hot",
            ],
            "icon-size": [
              "interpolate", ["linear"], ["get", "score"],
              70, 0.8,
              85, 1.1,
              100, 1.4,
            ],
            "icon-allow-overlap": true,
            visibility: mapMode === 'intel' ? 'visible' : 'none',
          },
        });
      }

      // NWS weather alert polygons
      const nwsEmpty: FeatureCollection = { type: "FeatureCollection", features: [] };
      if (!map.getSource("nws-alerts")) {
        map.addSource("nws-alerts", { type: "geojson", data: nwsAlertsGeoJSON || nwsEmpty });
      }
      if (!map.getLayer("nws-alert-fill")) {
        map.addLayer({
          id: "nws-alert-fill",
          type: "fill",
          source: "nws-alerts",
          paint: {
            "fill-color": [
              "match", ["get", "severity"],
              "Extreme", "rgba(239, 68, 68, 0.25)",
              "Severe", "rgba(251, 146, 60, 0.25)",
              "Moderate", "rgba(250, 204, 21, 0.2)",
              "Minor", "rgba(96, 165, 250, 0.15)",
              "rgba(96, 165, 250, 0.15)",
            ],
            "fill-opacity": 0.25,
          },
          layout: {
            visibility: (mapMode === 'weather' || mapMode === 'intel') ? 'visible' : 'none',
          },
        });
      }
      if (!map.getLayer("nws-alert-outline")) {
        map.addLayer({
          id: "nws-alert-outline",
          type: "line",
          source: "nws-alerts",
          paint: {
            "line-color": [
              "match", ["get", "severity"],
              "Extreme", "rgba(239, 68, 68, 0.6)",
              "Severe", "rgba(251, 146, 60, 0.6)",
              "Moderate", "rgba(250, 204, 21, 0.5)",
              "Minor", "rgba(96, 165, 250, 0.4)",
              "rgba(96, 165, 250, 0.4)",
            ],
            "line-width": 1.5,
          },
          layout: {
            visibility: (mapMode === 'weather' || mapMode === 'intel') ? 'visible' : 'none',
          },
        });
      }
      if (!map.getLayer("nws-alert-labels")) {
        map.addLayer({
          id: "nws-alert-labels",
          type: "symbol",
          source: "nws-alerts",
          layout: {
            "text-field": ["get", "event"],
            "text-size": 10,
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-allow-overlap": false,
            visibility: (mapMode === 'weather' || mapMode === 'intel') ? 'visible' : 'none',
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.8)",
            "text-halo-width": 1.5,
          },
        });
      }

      // Weather event markers from METAR pipeline
      const weatherEventsEmpty: FeatureCollection = { type: "FeatureCollection", features: [] };
      if (!map.getSource("weather-events")) {
        map.addSource("weather-events", { type: "geojson", data: weatherEventsGeoJSON || weatherEventsEmpty });
      }
      if (!map.getLayer("weather-event-circles")) {
        map.addLayer({
          id: "weather-event-circles",
          type: "circle",
          source: "weather-events",
          paint: {
            "circle-radius": 8,
            "circle-color": [
              "match", ["get", "severity"],
              "high", "#ef4444",
              "medium", "#fb923c",
              "low", "#facc15",
              "#facc15",
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": "rgba(255,255,255,0.3)",
            "circle-opacity": 0.8,
          },
          layout: {
            visibility: (mapMode === 'weather' || mapMode === 'intel') ? 'visible' : 'none',
          },
        });
      }
      if (!map.getLayer("weather-event-pulse")) {
        map.addLayer({
          id: "weather-event-pulse",
          type: "circle",
          source: "weather-events",
          paint: {
            "circle-radius": 14,
            "circle-color": "transparent",
            "circle-stroke-width": 2,
            "circle-stroke-color": [
              "match", ["get", "severity"],
              "high", "rgba(239,68,68,0.5)",
              "medium", "rgba(251,146,60,0.5)",
              "low", "rgba(250,204,21,0.5)",
              "rgba(250,204,21,0.5)",
            ],
            "circle-opacity": 0.5,
          },
          layout: {
            visibility: (mapMode === 'weather' || mapMode === 'intel') ? 'visible' : 'none',
          },
        });
      }
      if (!map.getLayer("weather-event-labels")) {
        map.addLayer({
          id: "weather-event-labels",
          type: "symbol",
          source: "weather-events",
          layout: {
            "text-field": ["get", "station"],
            "text-size": 9,
            "text-offset": [0, 1.5],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-allow-overlap": false,
            visibility: (mapMode === 'weather' || mapMode === 'intel') ? 'visible' : 'none',
          },
          paint: {
            "text-color": "rgba(255,255,255,0.7)",
            "text-halo-color": "rgba(0,0,0,0.8)",
            "text-halo-width": 1,
          },
        });
      }

      // Ocean buoy stations (NOAA NDBC)
      const buoyEmpty: FeatureCollection = { type: "FeatureCollection", features: [] };
      if (!map.getSource("ocean-buoys")) {
        map.addSource("ocean-buoys", { type: "geojson", data: buoyEmpty });
      }
      if (!map.getLayer("buoy-circles")) {
        map.addLayer({
          id: "buoy-circles",
          type: "circle",
          source: "ocean-buoys",
          paint: {
            "circle-radius": [
              "interpolate", ["linear"],
              ["coalesce", ["get", "waveHeightFt"], 3],
              0, 5,
              5, 8,
              10, 12,
              20, 16,
            ],
            "circle-color": [
              "interpolate", ["linear"],
              ["coalesce", ["get", "sstF"], 55],
              32, "#3b82f6",
              45, "#06b6d4",
              55, "#22c55e",
              65, "#eab308",
              75, "#f97316",
              85, "#ef4444",
            ],
            "circle-stroke-color": "rgba(255,255,255,0.6)",
            "circle-stroke-width": 1.5,
            "circle-opacity": 0.9,
          },
          layout: {
            visibility: (mapMode === 'default' || mapMode === 'weather' || mapMode === 'intel') ? 'visible' : 'none',
          },
        });
      }
      if (!map.getLayer("buoy-labels")) {
        map.addLayer({
          id: "buoy-labels",
          type: "symbol",
          source: "ocean-buoys",
          layout: {
            "text-field": ["concat", ["get", "stationId"], "\n", ["to-string", ["round", ["coalesce", ["get", "sstF"], 0]]], "\u00B0F"],
            "text-size": 9,
            "text-offset": [0, 1.8],
            "text-anchor": "top",
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "text-allow-overlap": false,
            visibility: (mapMode === 'default' || mapMode === 'weather' || mapMode === 'intel') ? 'visible' : 'none',
          },
          paint: {
            "text-color": "rgba(255,255,255,0.8)",
            "text-halo-color": "rgba(0,0,0,0.8)",
            "text-halo-width": 1,
          },
        });
      }

      // Migration front line (animated dashed cyan line — Intel mode only)
      if (!map.getSource("migration-front")) {
        const frontData: FeatureCollection = migrationFrontLine
          ? { type: "FeatureCollection", features: [migrationFrontLine] }
          : { type: "FeatureCollection", features: [] };
        map.addSource("migration-front", { type: "geojson", data: frontData });
      }
      if (!map.getLayer("migration-front-glow")) {
        map.addLayer({
          id: "migration-front-glow",
          type: "line",
          source: "migration-front",
          paint: {
            "line-color": "rgba(0, 255, 255, 0.15)",
            "line-width": 14,
            "line-blur": 10,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: 'none',
          },
        });
      }
      if (!map.getLayer("migration-front-line")) {
        map.addLayer({
          id: "migration-front-line",
          type: "line",
          source: "migration-front",
          paint: {
            "line-color": "rgba(0, 255, 255, 0.7)",
            "line-width": 2.5,
            "line-dasharray": [4, 4],
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: mapMode === 'intel' ? 'visible' : 'none',
          },
        });
      }
      if (!map.getLayer("migration-front-label")) {
        map.addLayer({
          id: "migration-front-label",
          type: "symbol",
          source: "migration-front",
          layout: {
            "text-field": ["get", "label"],
            "text-size": 11,
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
            "symbol-placement": "line",
            "text-allow-overlap": true,
            visibility: mapMode === 'intel' ? 'visible' : 'none',
          },
          paint: {
            "text-color": "rgba(0, 255, 255, 0.9)",
            "text-halo-color": "rgba(0, 0, 0, 0.8)",
            "text-halo-width": 1.5,
          },
        });
      }

      // Pressure trend arrows source + layer (text-based — sprite icons unreliable)
      if (!map.getSource("pressure-trend-points")) {
        map.addSource("pressure-trend-points", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer("pressure-trend-arrows")) {
        map.addLayer({
          id: "pressure-trend-arrows",
          type: "symbol",
          source: "pressure-trend-points",
          minzoom: 3,
          layout: {
            "text-field": ["match", ["get", "trend"], "falling", "▼", "rising", "▲", "▸"],
            "text-size": 16,
            "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
            "text-allow-overlap": true,
            "text-offset": [1.5, 0],
            visibility: "none",
          },
          paint: {
            "text-color": ["match", ["get", "trend"], "falling", "#ef4444", "rising", "#22c55e", "#94a3b8"],
            "text-halo-color": "rgba(0,0,0,0.8)",
            "text-halo-width": 1.5,
          },
        });
      }

      // Perfect Storm glow + ring layers
      if (!map.getLayer("perfect-storm-glow")) {
        map.addLayer({
          id: "perfect-storm-glow",
          type: "fill",
          source: "states",
          filter: ["in", ["get", "abbr"], ["literal", []]],
          paint: {
            "fill-color": "rgba(255, 200, 50, 0.25)",
            "fill-opacity": 0.2,
          },
        });
      }
      if (!map.getLayer("perfect-storm-ring")) {
        map.addLayer({
          id: "perfect-storm-ring",
          type: "line",
          source: "states",
          filter: ["in", ["get", "abbr"], ["literal", []]],
          paint: {
            "line-color": "rgba(255, 180, 0, 0.6)",
            "line-width": 3,
            "line-blur": 4,
          },
        });
      }

      // Arc phase outlines — colored state borders for active arcs
      if (!map.getLayer("arc-phase-outline")) {
        map.addLayer({
          id: "arc-phase-outline",
          type: "line",
          source: "states",
          filter: ["in", ["get", "abbr"], ["literal", []]],
          paint: {
            "line-color": "rgba(255,255,255,0.5)",
            "line-width": 2.5,
            "line-opacity": 0.85,
          },
        });
      }

      loadedRef.current = true;
    },
    [species, selectedState, showFlyways, statesWithData, weatherTiles, countyGeoJSON, sightingsGeoJSON, convergenceScores, mapMode, nwsAlertsGeoJSON, migrationFrontLine, perfectStormStates, duPinsGeoJSON, weatherEventsGeoJSON],
  );

  const initMap = useCallback(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: isSatellite
        ? "mapbox://styles/mapbox/satellite-streets-v12"
        : "mapbox://styles/mapbox/dark-v11",
      center: US_CENTER,
      zoom: US_ZOOM,
      scrollZoom: !isMobile,
      projection: 'globe' as any,
    });

    map.touchZoomRotate.enable();
    mapRef.current = map;
    prevStyleRef.current = isSatellite ? "satellite" : "dark";

    map.on("load", async () => {
      // Create score pill background image (dark rounded rect)
      try {
        const pillW = 40, pillH = 24, pillR = 6;
        const pillCanvas = document.createElement("canvas");
        pillCanvas.width = pillW;
        pillCanvas.height = pillH;
        const pCtx = pillCanvas.getContext("2d");
        if (pCtx) {
          pCtx.beginPath();
          pCtx.moveTo(pillR, 0);
          pCtx.lineTo(pillW - pillR, 0);
          pCtx.arcTo(pillW, 0, pillW, pillR, pillR);
          pCtx.lineTo(pillW, pillH - pillR);
          pCtx.arcTo(pillW, pillH, pillW - pillR, pillH, pillR);
          pCtx.lineTo(pillR, pillH);
          pCtx.arcTo(0, pillH, 0, pillH - pillR, pillR);
          pCtx.lineTo(0, pillR);
          pCtx.arcTo(0, 0, pillR, 0, pillR);
          pCtx.closePath();
          pCtx.fillStyle = "rgba(10,15,30,0.85)";
          pCtx.fill();
          map.addImage("score-pill", { width: pillW, height: pillH, data: pCtx.getImageData(0, 0, pillW, pillH).data } as any);
        } else {
          console.warn('[MapView] Failed to get 2d context for score-pill canvas');
        }
      } catch (err) {
        console.warn('[MapView] Failed to create score-pill image:', err);
      }

      // Pulsing dot images for convergence hotspots (score >= 70)
      const createPulsingDot = (color: [number, number, number]) => {
        const dotSize = 80;
        const pulsingDot: mapboxgl.StyleImageInterface & { context: CanvasRenderingContext2D | null; t: number } = {
          width: dotSize,
          height: dotSize,
          context: null,
          t: 0,
          data: new Uint8Array(dotSize * dotSize * 4),
          onAdd() {
            const cv = document.createElement('canvas');
            cv.width = dotSize;
            cv.height = dotSize;
            this.context = cv.getContext('2d');
          },
          render() {
            this.t = (this.t + 1) % 120;
            const progress = this.t / 120;
            const radius = 10 + progress * 25;
            const alpha = 1 - progress;
            const cv = this.context;
            if (!cv) return false;
            cv.clearRect(0, 0, dotSize, dotSize);
            // Outer expanding ring
            cv.beginPath();
            cv.arc(dotSize / 2, dotSize / 2, radius, 0, Math.PI * 2);
            cv.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.6})`;
            cv.lineWidth = 3;
            cv.stroke();
            // Second ring (offset phase)
            const progress2 = ((this.t + 60) % 120) / 120;
            const radius2 = 10 + progress2 * 25;
            const alpha2 = 1 - progress2;
            cv.beginPath();
            cv.arc(dotSize / 2, dotSize / 2, radius2, 0, Math.PI * 2);
            cv.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha2 * 0.4})`;
            cv.lineWidth = 2;
            cv.stroke();
            // Center dot
            cv.beginPath();
            cv.arc(dotSize / 2, dotSize / 2, 5, 0, Math.PI * 2);
            cv.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.9)`;
            cv.fill();
            this.data = cv.getImageData(0, 0, dotSize, dotSize).data as any;
            map.triggerRepaint();
            return true;
          },
        };
        return pulsingDot;
      };

      try {
        map.addImage('pulsing-dot-fire', createPulsingDot([239, 68, 68]) as any, { pixelRatio: 2 });
        map.addImage('pulsing-dot-hot', createPulsingDot([251, 146, 60]) as any, { pixelRatio: 2 });
      } catch (err) {
        console.warn('[MapView] Failed to create pulsing-dot images:', err);
      }

      const response = await fetch(TOPO_URL);
      const topoData = (await response.json()) as Topology;

      const geoJSON = topojson.feature(
        topoData,
        topoData.objects.states as GeometryCollection,
      ) as FeatureCollection;

      for (const feature of geoJSON.features) {
        const id = String(feature.id).padStart(2, "0");
        const abbr = fipsToAbbr[id] || "";
        feature.properties = { ...feature.properties, abbr };
        const centroid = computeCentroid(feature);
        if (centroid && abbr) {
          centroidsRef.current.set(abbr, centroid);
        }
      }

      statesGeoRef.current = geoJSON;
      addSourcesAndLayers(map);

      // Always-on atmosphere
      map.setFog({
        color: 'rgb(10, 15, 26)',
        'high-color': 'rgb(20, 40, 80)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(5, 8, 15)',
        'star-intensity': 0.4,
        range: [0.5, 12],
      });

      // 3D terrain
      if (show3D) {
        addTerrain(map);
      }

      startPulse();

      // Elevation tracking on mouse move
      map.on('mousemove', (e) => {
        if (!show3D || !onElevation) return;
        const elevation = map.queryTerrainElevation(e.lngLat);
        if (elevation !== null) {
          onElevation(Math.round(elevation * 3.281)); // meters to feet
        }
      });
    });

    // Unified click handler — checks interactive layers in priority order
    // eBird/DU features take priority over state polygon selection
    let clickHandled = false;

    map.on("click", "ebird-clusters", (e) => {
      clickHandled = true;
      setTimeout(() => { clickHandled = false; }, 100);
      if (!e.features || e.features.length === 0) return;
      const clusterId = e.features[0].properties?.cluster_id;
      // Capture coords NOW — e.features is recycled by Mapbox after this handler returns
      const coords = (e.features[0].geometry as any).coordinates as [number, number];
      const source = map.getSource("ebird-sightings") as mapboxgl.GeoJSONSource;
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || zoom == null) return;
        map.flyTo({ center: coords, zoom, duration: 500 });
      });
    });

    map.on("click", "ebird-dots", (e) => {
      clickHandled = true;
      setTimeout(() => { clickHandled = false; }, 100);
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties || {};
      const coords = (e.features[0].geometry as any).coordinates.slice() as [number, number];
      while (Math.abs(e.lngLat.lng - coords[0]) > 180) {
        coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
      }
      new mapboxgl.Popup({ closeButton: true, closeOnClick: true, className: "signal-popup", offset: 10 })
        .setLngLat(coords)
        .setHTML(getSightingPopupHTML(props.name || "Unknown", props.count || 0, props.location || "", props.date || "", props.recency || "old"))
        .addTo(map);
    });

    // Close hover popup on mousedown so it doesn't block the subsequent click
    map.getCanvas().addEventListener('mousedown', () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    });

    // State click — deferred to let eBird/DU/weather handlers claim the click first.
    // Other handlers set clickHandled=true for 100ms. We wait 150ms so the flag has reset,
    // then check: if it was reset (no other handler claimed it), navigate to state.
    const handleStateClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      setTimeout(() => {
        if (clickHandled) return;
        if (!e.features || e.features.length === 0) return;
        const abbr = e.features[0].properties?.abbr;
        if (!abbr || !statesWithData.has(abbr)) return;
        popupRef.current?.remove();
        popupRef.current = null;
        onSelectStateRef.current(abbr);
      }, 150);
    };
    map.on("click", "states-fill", handleStateClick);
    map.on("click", "states-pulse", handleStateClick);

    // eBird cursor changes
    map.on("mouseenter", "ebird-clusters", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "ebird-clusters", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "ebird-dots", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "ebird-dots", () => { map.getCanvas().style.cursor = ""; });

    // DU pin click — show popup with report details
    map.on("click", "du-pins-dots", (e) => {
      clickHandled = true;
      setTimeout(() => { clickHandled = false; }, 100);
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties || {};
      const coords = (e.features[0].geometry as any).coordinates.slice() as [number, number];
      while (Math.abs(e.lngLat.lng - coords[0]) > 180) {
        coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
      }
      const dateStr = props.submit_date ? new Date(props.submit_date).toLocaleDateString() : "";
      const activityColors: Record<string, string> = {
        "Very Low": "#64748b", "Low": "#64748b", "Moderate": "#facc15", "Good": "#fb923c", "Excellent": "#ef4444",
      };
      const actColor = activityColors[props.activity_level] || "#94a3b8";
      new mapboxgl.Popup({ closeButton: true, closeOnClick: true, className: "signal-popup", offset: 10 })
        .setLngLat(coords)
        .setHTML(`
          <div style="font-family:Inter,sans-serif;padding:4px 0;min-width:150px;max-width:240px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="background:${actColor};width:8px;height:8px;border-radius:50%;display:inline-block"></span>
              <span style="font-weight:600;font-size:13px;color:#fff">${props.activity_level || "Unknown"}</span>
            </div>
            <div style="color:rgba(255,255,255,0.7);font-size:11px">${props.classification || ""}</div>
            ${props.location_name ? `<div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:3px">${props.location_name}${props.state_abbr ? ", " + props.state_abbr : ""}</div>` : ""}
            ${props.weather ? `<div style="color:rgba(255,255,255,0.4);font-size:10px;margin-top:3px">${props.weather}</div>` : ""}
            <div style="color:rgba(255,255,255,0.4);font-size:10px;margin-top:4px">${dateStr}</div>
          </div>
        `)
        .addTo(map);
    });

    // DU cluster click — zoom in
    map.on("click", "du-pins-clusters", (e) => {
      clickHandled = true;
      setTimeout(() => { clickHandled = false; }, 100);
      if (!e.features || e.features.length === 0) return;
      const clusterId = e.features[0].properties?.cluster_id;
      const source = map.getSource("du-pins") as mapboxgl.GeoJSONSource;
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        const coords = (e.features![0].geometry as any).coordinates as [number, number];
        map.flyTo({ center: coords, zoom, duration: 500 });
      });
    });

    // DU cursor changes
    map.on("mouseenter", "du-pins-dots", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "du-pins-dots", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "du-pins-clusters", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "du-pins-clusters", () => { map.getCanvas().style.cursor = ""; });

    // NWS alert click — show popup with details
    map.on("click", "nws-alert-fill", (e) => {
      clickHandled = true;
      setTimeout(() => { clickHandled = false; }, 100);
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties || {};
      const severity = props.severity || 'Minor';
      const severityColors: Record<string, string> = {
        Extreme: '#ef4444', Severe: '#fb923c', Moderate: '#facc15', Minor: '#60a5fa',
      };
      const color = severityColors[severity] || '#60a5fa';
      const onset = props.onset ? new Date(props.onset).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const expires = props.expires ? new Date(props.expires).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const timeRange = onset && expires ? `${onset} - ${expires}` : (onset || expires || '');
      const html = `
        <div style="max-width:280px;font-family:system-ui,sans-serif;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="background:${color};color:#000;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;">${severity}</span>
          </div>
          <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:4px;">${props.headline || props.event || 'Weather Alert'}</div>
          ${timeRange ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:6px;">${timeRange}</div>` : ''}
          <div style="font-size:11px;color:rgba(255,255,255,0.7);max-height:120px;overflow-y:auto;line-height:1.4;">${(props.description || '').slice(0, 300)}${(props.description || '').length > 300 ? '...' : ''}</div>
        </div>
      `;
      new mapboxgl.Popup({ closeButton: true, closeOnClick: true, className: "signal-popup", offset: 10, maxWidth: '300px' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    });
    map.on("mouseenter", "nws-alert-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "nws-alert-fill", () => { map.getCanvas().style.cursor = ""; });

    // Weather event click — show popup with METAR details
    map.on("click", "weather-event-circles", (e) => {
      clickHandled = true;
      setTimeout(() => { clickHandled = false; }, 100);
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties || {};
      const severityColors: Record<string, string> = { high: '#ef4444', medium: '#fb923c', low: '#facc15' };
      const color = severityColors[props.severity] || '#facc15';
      const time = props.timestamp ? new Date(props.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const html = `
        <div style="max-width:260px;font-family:system-ui,sans-serif;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="background:${color};width:8px;height:8px;border-radius:50%;display:inline-block"></span>
            <span style="font-weight:600;font-size:12px;color:#fff">${props.station}</span>
            ${time ? `<span style="font-size:10px;color:rgba(255,255,255,0.4)">${time}</span>` : ''}
          </div>
          <div style="font-size:12px;font-weight:500;color:#fff;margin-bottom:4px;">${props.title || 'Weather Event'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.7);line-height:1.4;">${props.content || ''}</div>
        </div>
      `;
      new mapboxgl.Popup({ closeButton: true, closeOnClick: true, className: "signal-popup", offset: 10 })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    });
    map.on("mouseenter", "weather-event-circles", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "weather-event-circles", () => { map.getCanvas().style.cursor = ""; });

    // Ocean buoy click — show popup with observation details
    map.on("click", "buoy-circles", (e) => {
      clickHandled = true;
      setTimeout(() => { clickHandled = false; }, 100);
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties || {};
      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      const html = `
        <div style="font-family:monospace;font-size:11px;color:#e2e8f0;background:#1e293b;padding:8px;border-radius:4px;max-width:260px;">
          <div style="font-weight:bold;color:#22d3ee;margin-bottom:4px;">Buoy ${props.stationId} &mdash; ${props.region || ''}</div>
          <div>SST: ${props.sstF != null ? props.sstF + '\u00B0F' : 'N/A'}</div>
          <div>Waves: ${props.waveHeightFt != null ? props.waveHeightFt + ' ft' : 'N/A'} (${props.wavePeriod != null ? props.wavePeriod + 's' : 'N/A'})</div>
          <div>Pressure: ${props.pressureMb != null ? props.pressureMb + ' mb' : 'N/A'}</div>
          <div>Wind: ${props.windSpeedMph != null ? props.windSpeedMph + ' mph' : 'N/A'} ${props.windDir != null ? props.windDir + '\u00B0' : ''}</div>
          <div>Air: ${props.airTempF != null ? props.airTempF + '\u00B0F' : 'N/A'}</div>
          <div style="color:#94a3b8;margin-top:4px;font-size:9px;">${props.obsTime || ''}</div>
        </div>
      `;
      new mapboxgl.Popup({ closeButton: true, closeOnClick: true, className: "signal-popup", offset: 10, maxWidth: '280px' })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);
    });
    map.on("mouseenter", "buoy-circles", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "buoy-circles", () => { map.getCanvas().style.cursor = ""; });

    // Cursor + popup (listen on both states-fill and states-pulse)
    const handleStateHover = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      // Feature-state hover management
      if (hoveredStateIdRef.current !== null) {
        map.setFeatureState({ source: 'states', id: hoveredStateIdRef.current }, { hover: false });
      }
      if (e.features?.[0]?.id !== undefined) {
        hoveredStateIdRef.current = e.features[0].id as number;
        map.setFeatureState({ source: 'states', id: hoveredStateIdRef.current }, { hover: true });
      }

      if (e.features?.[0]?.properties?.abbr) {
        const abbr = e.features[0].properties.abbr;
        if (statesWithData.has(abbr)) {
          map.getCanvas().style.cursor = "pointer";

          // Show popup at centroid
          const centroid = centroidsRef.current.get(abbr);
          if (centroid && !isMobile) {
            // Find active arc for this state
            let arcInfo: PopupArcInfo | null = null;
            const arcs = stateArcsRef.current;
            if (arcs && arcs.length > 0) {
              const phaseRank: Record<string, number> = { buildup: 0, recognition: 1, outcome: 2, grade: 3 };
              let bestArc: typeof arcs[0] | null = null;
              for (const arc of arcs) {
                if (arc.state_abbr !== abbr) continue;
                if (!bestArc || (phaseRank[arc.current_act] ?? 0) > (phaseRank[bestArc.current_act] ?? 0)) {
                  bestArc = arc;
                }
              }
              if (bestArc) {
                arcInfo = { phase: bestArc.current_act, grade: bestArc.grade };
              }
            }

            popupRef.current?.remove();
            popupRef.current = new mapboxgl.Popup({
              closeButton: false,
              closeOnClick: false,
              className: "signal-popup state-hover-popup",
              offset: 10,
            })
              .setLngLat(centroid)
              .setHTML(getPopupHTML(abbr, STATE_NAMES[abbr] || abbr, species, weatherCacheRef.current?.get(abbr), convergenceRef.current?.get(abbr) ?? null, getConvergenceRank(abbr, convergenceRef.current), arcInfo))
              .addTo(map);
          }
        }
      }
    };
    const handleStateLeave = () => {
      if (hoveredStateIdRef.current !== null) {
        map.setFeatureState({ source: 'states', id: hoveredStateIdRef.current }, { hover: false });
        hoveredStateIdRef.current = null;
      }
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
      popupRef.current = null;
    };
    map.on("mouseenter", "states-fill", handleStateHover);
    map.on("mouseenter", "states-pulse", handleStateHover);
    map.on("mouseleave", "states-fill", handleStateLeave);
    map.on("mouseleave", "states-pulse", handleStateLeave);

    // Zoom out detection for drill up
    map.on("zoomend", () => {
      if (flyingRef.current) return;
      const zoom = map.getZoom();
      if (zoom < DRILL_UP_ZOOM_THRESHOLD && selectedStateRef.current) {
        onDrillUp();
      }
    });

    map.on("moveend", () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      onMoveEnd?.([center.lng, center.lat], zoom);
    });
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pulse animation loop
  const startPulse = useCallback(() => {
    const animate = () => {
      const map = mapRef.current;
      if (!map || !map.getLayer("states-pulse")) return;

      const t = (Math.sin(Date.now() / 800) + 1) / 2;
      const opacity = 0.35 + t * 0.3;

      map.setPaintProperty("states-pulse", "fill-opacity", opacity);

      // NWS alert fill pulsing opacity
      if (map.getLayer("nws-alert-fill")) {
        const nwsOpacity = 0.15 + t * 0.2;
        map.setPaintProperty("nws-alert-fill", "fill-opacity", nwsOpacity);
      }

      // Weather event pulse (outer ring breathe)
      if (map.getLayer("weather-event-pulse")) {
        const weatherT = (Math.sin(Date.now() / 600) + 1) / 2;
        map.setPaintProperty("weather-event-pulse", "circle-radius", 10 + weatherT * 8);
        map.setPaintProperty("weather-event-pulse", "circle-opacity", 0.5 - weatherT * 0.4);
      }

      // Perfect Storm glow pulse (slow breathe)
      if (map.getLayer("perfect-storm-glow")) {
        const stormT = (Math.sin(Date.now() / 2000) + 1) / 2;
        map.setPaintProperty("perfect-storm-glow", "fill-opacity", 0.15 + stormT * 0.2);
      }

      // Intel mode: convergence heatmap breathing pulse (slow sine on fill-opacity)
      if (mapModeRef.current === 'intel' && map.getLayer("states-fill")) {
        const breatheT = (Math.sin(Date.now() / 1200) + 1) / 2;
        const fillOpacity = 0.40 + breatheT * 0.35; // oscillates 0.40 - 0.75
        map.setPaintProperty("states-fill", "fill-opacity", fillOpacity);
      }

      // Animated wind flow dash-array (~10fps for performance)
      const now = Date.now();
      if (map.getLayer("wind-flow") && now - lastDashTimeRef.current > 100) {
        lastDashTimeRef.current = now;
        const step = dashStepRef.current % 4;
        dashStepRef.current++;
        const dashArrays: [number, number, number, number][] = [
          [0, 2, 2, 0],
          [1, 2, 1, 0],
          [2, 2, 0, 0],
          [0, 1, 2, 1],
        ];
        map.setPaintProperty("wind-flow", "line-dasharray", dashArrays[step]);
      }

      // Animated migration front dash-array (marching ants, same timing as wind)
      if (map.getLayer("migration-front-line") && now - lastDashTimeRef.current < 200) {
        const migStep = dashStepRef.current % 4;
        const migDash: [number, number, number, number][] = [
          [0, 4, 4, 0],
          [1, 4, 3, 0],
          [2, 4, 2, 0],
          [3, 4, 1, 0],
        ];
        map.setPaintProperty("migration-front-line", "line-dasharray", migDash[migStep]);
      }

      // Animated flyway flow dash-array (marching ants, same timing as wind)
      if (map.getLayer("flyway-flow-lines") && now - lastDashTimeRef.current < 200) {
        // Reuse dashStepRef — already incremented above for wind
        const flywayStep = dashStepRef.current % 4;
        // Fall/winter (Oct-Feb): south direction (forward dash). Spring (Mar-Sep): reverse.
        const month = new Date().getMonth(); // 0-indexed
        const isFallWinter = month >= 9 || month <= 1; // Oct(9)-Feb(1)
        const flywayDash: [number, number, number, number][] = isFallWinter
          ? [[0, 2, 2, 0], [1, 2, 1, 0], [2, 2, 0, 0], [0, 1, 2, 1]]
          : [[2, 2, 0, 0], [1, 2, 1, 0], [0, 2, 2, 0], [0, 1, 2, 1]];
        map.setPaintProperty("flyway-flow-lines", "line-dasharray", flywayDash[flywayStep]);
      }

      pulseFrameRef.current = requestAnimationFrame(animate);
    };
    cancelAnimationFrame(pulseFrameRef.current);
    pulseFrameRef.current = requestAnimationFrame(animate);
  }, []);

  // Initialize map
  useEffect(() => {
    initMap();

    return () => {
      cancelAnimationFrame(pulseFrameRef.current);
      popupRef.current?.remove();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      loadedRef.current = false;
    };
  }, [initMap]);

  // Update fill colors when species or selectedState changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const expression = buildFillExpression(visualSpecies, selectedState);
    if (map.getLayer("states-fill")) {
      map.setPaintProperty("states-fill", "fill-color", expression);
    }
    if (map.getLayer("states-pulse")) {
      map.setPaintProperty("states-pulse", "fill-color", expression);
      map.setPaintProperty("states-pulse", "fill-opacity", 0.5);
      map.setFilter("states-pulse", buildPulseFilter(visualSpecies));
    }
    if (map.getLayer("states-selected-outline")) {
      map.setFilter("states-selected-outline", [
        "==",
        ["get", "abbr"],
        selectedState || "",
      ]);
      map.setPaintProperty(
        "states-selected-outline",
        "line-color",
        speciesConfig[visualSpecies].colors.selected,
      );
    }
  }, [species, selectedState]);

  // FlyTo when selectedState changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Reset flyingRef — if a previous animation's moveend never fired (interrupted),
    // this prevents the ref from staying stuck true and blocking all future flyTo calls.
    flyingRef.current = false;

    if (selectedState) {
      const centroid = centroidsRef.current.get(selectedState);
      if (centroid) {
        flyingRef.current = true;
        map.once('moveend', () => { flyingRef.current = false; });
        map.flyTo({ center: centroid, zoom: STATE_ZOOM, pitch: 45, bearing: -15, duration: 1500 });
      }
    } else {
      flyingRef.current = true;
      map.once('moveend', () => { flyingRef.current = false; });
      map.flyTo({ center: US_CENTER, zoom: US_ZOOM, pitch: 0, bearing: 0, duration: 1200 });
    }
  }, [selectedState]);

  // Toggle flyway layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const visible = showFlyways && isFlywaySpecies(visualSpecies);
    if (map.getLayer("flyway-fill")) {
      map.setLayoutProperty(
        "flyway-fill",
        "visibility",
        visible ? "visible" : "none",
      );
    }
  }, [showFlyways, species]);

  // Update weather tile sources when URLs change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !weatherTiles) return;

    const tileEntries: { id: string; url: string | null | undefined }[] = [
      { id: "radar", url: weatherTiles.radar },
      { id: "temp-tiles", url: weatherTiles.temperature },
    ];

    for (const { id, url } of tileEntries) {
      if (!url) continue;
      const source = map.getSource(id) as mapboxgl.RasterTileSource | undefined;
      if (source) {
        source.setTiles([url]);
      } else {
        // Source doesn't exist yet — add it + layer
        map.addSource(id, { type: "raster", tiles: [url], tileSize: 256, maxzoom: id === "radar" ? 6 : 12 });
        const layerId = `${id}-overlay`;
        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: "raster",
            source: id,
            paint: { "raster-opacity": id === "radar" ? 0.6 : 0.5 },
            layout: { visibility: "none" },
          }, "states-fill");
        }
      }
    }
  }, [weatherTiles]);

  // Update eBird sightings data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const source = map.getSource("ebird-sightings") as mapboxgl.GeoJSONSource | undefined;
    if (source && sightingsGeoJSON) {
      source.setData(sightingsGeoJSON);
    }
    const heatmapSource = map.getSource("ebird-heatmap-source") as mapboxgl.GeoJSONSource | undefined;
    if (!heatmapSource) return;

    if (sightingsGeoJSON && sightingsGeoJSON.features.length > 0) {
      // Use real sighting data when available (zoomed in)
      heatmapSource.setData(sightingsGeoJSON);
    } else if (convergenceScores && convergenceScores.size > 0) {
      // At national zoom, use convergence scores as heatmap proxy
      const features: Feature[] = [];
      for (const [abbr, data] of convergenceScores) {
        const centroid = centroidsRef.current.get(abbr);
        if (centroid && data.score > 20) {
          const pointCount = Math.ceil(data.score / 20); // 1-5 points per state
          for (let i = 0; i < pointCount; i++) {
            // Deterministic jitter so points don't jump on re-render
            const jitterX = Math.sin(abbr.charCodeAt(0) * 7 + abbr.charCodeAt(1) * 13 + i * 17) * 0.5;
            const jitterY = Math.cos(abbr.charCodeAt(0) * 11 + abbr.charCodeAt(1) * 3 + i * 23) * 0.5;
            features.push({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [centroid[0] + jitterX, centroid[1] + jitterY],
              },
              properties: { count: data.score, recency: 'today' },
            });
          }
        }
      }
      heatmapSource.setData({ type: 'FeatureCollection', features });
    }
  }, [sightingsGeoJSON, convergenceScores]);

  // Update DU migration map pins data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !duPinsGeoJSON) return;

    const source = map.getSource("du-pins") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(duPinsGeoJSON);
    }
  }, [duPinsGeoJSON]);

  // Update NWS alerts data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !nwsAlertsGeoJSON) return;

    const source = map.getSource("nws-alerts") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(nwsAlertsGeoJSON);
    }
  }, [nwsAlertsGeoJSON]);

  // Update weather events data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource("weather-events") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(weatherEventsGeoJSON || { type: 'FeatureCollection', features: [] });
    }
  }, [weatherEventsGeoJSON]);

  // Update ocean buoy data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource("ocean-buoys") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(buoyGeoJSON || { type: 'FeatureCollection', features: [] });
    }
  }, [buoyGeoJSON]);

  // Update migration front line when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const source = map.getSource("migration-front") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      const data: FeatureCollection = migrationFrontLine
        ? { type: "FeatureCollection", features: [migrationFrontLine] }
        : { type: "FeatureCollection", features: [] };
      source.setData(data);
    }
  }, [migrationFrontLine]);

  // Fetch yesterday's convergence scores for change indicators
  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    let cancelled = false;
    fetch(`${supabaseUrl}/rest/v1/hunt_convergence_scores?select=state_abbr,score&date=eq.${dateStr}`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    })
      .then(res => res.ok ? res.json() : [])
      .then((rows: { state_abbr: string; score: number }[]) => {
        if (cancelled) return;
        const scores = new Map<string, number>();
        for (const row of rows) {
          scores.set(row.state_abbr, row.score);
        }
        setYesterdayScores(scores);
      })
      .catch(() => { /* non-critical — arrows just won't show */ });

    return () => { cancelled = true; };
  }, []);

  // Update convergence score labels when scores change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !convergenceScores) return;

    const source = map.getSource("convergence-labels") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const features: Feature[] = [];
    for (const [abbr, data] of convergenceScores) {
      const centroid = centroidsRef.current.get(abbr);
      if (centroid) {
        const prevScore = yesterdayScores?.get(abbr);
        const change = prevScore != null ? data.score - prevScore : 0;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: centroid },
          properties: { abbr, score: data.score, scoreColor: convergenceScoreColor(data.score), change },
        });
      }
    }
    source.setData({ type: "FeatureCollection", features });

    // Also update hotspot pulsing rings
    const hotspotSource = map.getSource("convergence-hotspots") as mapboxgl.GeoJSONSource | undefined;
    if (hotspotSource) {
      const hotspotFeatures: Feature[] = [];
      for (const [abbr, data] of convergenceScores) {
        if (data.score < 70) continue;
        const centroid = centroidsRef.current.get(abbr);
        if (centroid) {
          hotspotFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: centroid },
            properties: { abbr, score: data.score, tier: data.score >= 81 ? 'fire' : 'hot' },
          });
        }
      }
      hotspotSource.setData({ type: "FeatureCollection", features: hotspotFeatures });
    }
  }, [convergenceScores, yesterdayScores]);

  // Toggle overlay visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const layerMap: Record<string, boolean> = {
      'wetland-fill': overlays.wetlands,
      'water-fill': overlays.waterBodies,
      'landcover-fill': overlays.landCover,
      'contour-lines': overlays.contours,
      'contour-labels': overlays.contours,
      'waterway-lines': overlays.waterways,
      'waterway-intermittent': overlays.waterways,
      'waterway-labels': overlays.waterways,
      'agriculture-fill': overlays.agriculture,
      'parks-fill': overlays.parks,
      'trails-lines': overlays.trails,
    };

    for (const [layerId, visible] of Object.entries(layerMap)) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }, [overlays]);

  // Mode-driven layer visibility + state fill coloring + wind/isobar data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    // --- BLOCK 1: Layer visibility ---
    if (visibleMapboxLayers) {
      // New path: LayerContext drives visibility — iterate ALL known Mapbox layer IDs
      for (const layerId of ALL_TOGGLABLE_MAPBOX_LAYERS) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', visibleMapboxLayers.has(layerId) ? 'visible' : 'none');
        }
      }
    } else {
      // Legacy path: mode-driven (fallback)
      for (const [layerId, modes] of Object.entries(LAYER_MODES)) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', modes.has(mapMode) ? 'visible' : 'none');
        }
      }
      if (map.getLayer('radar-overlay')) {
        map.setLayoutProperty('radar-overlay', 'visibility', showRadar ? 'visible' : 'none');
      }
      const duVis = showDUPins ? 'visible' : 'none';
      if (map.getLayer('du-pins-dots')) map.setLayoutProperty('du-pins-dots', 'visibility', duVis);
      if (map.getLayer('du-pins-clusters')) map.setLayoutProperty('du-pins-clusters', 'visibility', duVis);
      if (map.getLayer('du-pins-cluster-count')) map.setLayoutProperty('du-pins-cluster-count', 'visibility', duVis);
    }

    // --- BLOCK 2: State fill coloring (separate from visibility) ---
    // Always show convergence colors when scores are available
    const showConvergenceFill = true;
    if (showConvergenceFill && convergenceScores && convergenceScores.size > 0 && map.getLayer("states-fill")) {
      const entries: string[] = [];
      for (const [abbr, data] of convergenceScores) {
        entries.push(abbr, convergenceToColor(data.score));
      }
      if (entries.length > 0) {
        map.setPaintProperty("states-fill", "fill-color", [
          "match", ["get", "abbr"],
          ...entries,
          "rgba(100,100,100,0.2)",
        ] as mapboxgl.Expression);
        map.setPaintProperty("states-fill", "fill-opacity", 0.7);
      }
      // 3D extrusion — height proportional to score
      if (map.getLayer("states-extrusion")) {
        const extHeightEntries: (string | number)[] = [];
        const extColorEntries: string[] = [];
        for (const [abbr, data] of convergenceScores) {
          extHeightEntries.push(abbr, data.score * 800); // 0-80,000 meters (visible at globe zoom)
          extColorEntries.push(abbr, convergenceToColor(data.score));
        }
        if (extHeightEntries.length > 0) {
          map.setPaintProperty("states-extrusion", "fill-extrusion-height", [
            "match", ["get", "abbr"], ...extHeightEntries, 0
          ] as mapboxgl.Expression);
          map.setPaintProperty("states-extrusion", "fill-extrusion-color", [
            "match", ["get", "abbr"], ...extColorEntries, "rgba(100,100,100,0.2)"
          ] as mapboxgl.Expression);
        }
      }
    } else if (mapMode === 'weather' && weatherCache && weatherCache.size > 0 && map.getLayer("states-fill")) {
      const entries: (string | string)[] = [];
      for (const [abbr, w] of weatherCache) {
        entries.push(abbr, tempToColor(w.temp));
      }
      if (entries.length > 0) {
        map.setPaintProperty("states-fill", "fill-color", [
          "match", ["get", "abbr"],
          ...entries,
          "rgba(100,100,100,0.2)",
        ] as mapboxgl.Expression);
        map.setPaintProperty("states-fill", "fill-opacity", 0.7);
      }
    } else if (mapMode === 'scout' && map.getLayer("states-fill")) {
      const entries: string[] = [];
      for (const abbr of statesWithData) {
        entries.push(abbr, 'rgba(20, 184, 166, 0.35)');
      }
      if (entries.length > 0) {
        map.setPaintProperty("states-fill", "fill-color", [
          "match", ["get", "abbr"],
          ...entries,
          "rgba(100,100,100,0.15)",
        ] as mapboxgl.Expression);
        map.setPaintProperty("states-fill", "fill-opacity", 0.5);
      }
    } else if (mapMode === 'terrain' && map.getLayer("states-fill")) {
      const entries: string[] = [];
      for (const abbr of statesWithData) {
        entries.push(abbr, 'rgba(139, 119, 80, 0.25)');
      }
      if (entries.length > 0) {
        map.setPaintProperty("states-fill", "fill-color", [
          "match", ["get", "abbr"],
          ...entries,
          "rgba(100,100,100,0.15)",
        ] as mapboxgl.Expression);
        map.setPaintProperty("states-fill", "fill-opacity", 0.5);
      }
    } else if (map.getLayer("states-fill")) {
      map.setPaintProperty("states-fill", "fill-color", buildSatelliteFillExpression(visualSpecies, selectedState));
      map.setPaintProperty("states-fill", "fill-opacity", 0.85);
    }

    // State outlines — stronger in data modes, visible in default
    if (map.getLayer("states-line")) {
      const isDataMode = mapMode === 'intel' || mapMode === 'weather';
      const isDefault = mapMode === 'default';
      map.setPaintProperty("states-line", "line-width", isDataMode ? 1.2 : isDefault ? 1.2 : 1.0);
      map.setPaintProperty("states-line", "line-color", isDataMode ? "rgba(255,255,255,0.3)" : isDefault ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.2)");
    }

    // Selected state outline
    if (map.getLayer("states-selected-outline")) {
      map.setPaintProperty("states-selected-outline", "line-width", 2.5);
      map.setPaintProperty("states-selected-outline", "line-opacity", 0.9);
    }

    // --- BLOCK 3: Wind flow + isobar data generation ---
    const showWind = visibleMapboxLayers ? visibleMapboxLayers.has('wind-flow') : LAYER_MODES['wind-flow'].has(mapMode);
    if (showWind && weatherCache && weatherCache.size > 0) {
      const lineFeatures: Feature[] = [];
      const pointFeatures: Feature[] = [];
      for (const [abbr, w] of weatherCache) {
        const centroid = centroidsRef.current.get(abbr);
        if (centroid && w.wind > 1) {
          const lengthDeg = 0.3 + Math.min(w.wind, 30) / 30 * 1.7;
          const coords = windFlowLine(centroid, w.windDir, lengthDeg);
          lineFeatures.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: { abbr, windSpeed: w.wind },
          });
          // Place arrowhead at the line endpoint (downwind end), not centroid
          pointFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: coords[1] },
            properties: { abbr, windSpeed: w.wind, windDir: w.windDir },
          });
        }
      }
      const lineSource = map.getSource("wind-arrows") as mapboxgl.GeoJSONSource | undefined;
      if (lineSource) {
        lineSource.setData({ type: "FeatureCollection", features: lineFeatures });
      }
      const pointSource = map.getSource("wind-speed-points") as mapboxgl.GeoJSONSource | undefined;
      if (pointSource) {
        pointSource.setData({ type: "FeatureCollection", features: pointFeatures });
      }
    }

    if (showWind && weatherCache && weatherCache.size > 0) {
      const pressurePoints = [] as { lng: number; lat: number; pressure: number }[];
      for (const [abbr, w] of weatherCache) {
        const centroid = centroidsRef.current.get(abbr);
        if (centroid && w.pressure > 0) {
          pressurePoints.push({ lng: centroid[0], lat: centroid[1], pressure: w.pressure });
        }
      }
      // Pressure trend arrows
      const trendFeatures: Feature[] = [];
      for (const [abbr, w] of weatherCache) {
        const centroid = centroidsRef.current.get(abbr);
        if (centroid && (w as any).pressureTrend) {
          trendFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: centroid },
            properties: { abbr, trend: (w as any).pressureTrend },
          });
        }
      }
      const trendSource = map.getSource("pressure-trend-points") as mapboxgl.GeoJSONSource | undefined;
      if (trendSource) {
        trendSource.setData({ type: "FeatureCollection", features: trendFeatures });
      }

      if (pressurePoints.length >= 3) {
        const { contours, centers } = generateIsobars(pressurePoints);
        const isobarSource = map.getSource("isobar-lines") as mapboxgl.GeoJSONSource | undefined;
        if (isobarSource) {
          isobarSource.setData(contours as any);
        }
        const centerSource = map.getSource("pressure-centers") as mapboxgl.GeoJSONSource | undefined;
        if (centerSource) {
          centerSource.setData(centers as any);
        }
      }
    }
    // Perfect Storm overlay filter update
    const stormAbbrs = perfectStormStates ? [...perfectStormStates] : [];
    const stormFilter: mapboxgl.Expression = stormAbbrs.length > 0
      ? ["in", ["get", "abbr"], ["literal", stormAbbrs]] as mapboxgl.Expression
      : ["==", ["get", "abbr"], "__none__"] as mapboxgl.Expression;
    if (map.getLayer("perfect-storm-glow")) {
      map.setFilter("perfect-storm-glow", stormFilter);
    }
    if (map.getLayer("perfect-storm-ring")) {
      map.setFilter("perfect-storm-ring", stormFilter);
    }
  }, [mapMode, weatherCache, weatherTiles, species, selectedState, convergenceScores, statesWithData, perfectStormStates, showRadar, showDUPins, visibleMapboxLayers]);

  // Arc phase outlines — colored state borders for recognition/outcome/grade arcs
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer("arc-phase-outline")) return;

    const ARC_PHASE_COLORS: Record<string, string> = {
      recognition: "rgba(251, 146, 60, 0.9)",  // orange
      outcome:     "rgba(239, 68, 68, 0.9)",    // red
      grade:       "rgba(34, 197, 94, 0.9)",     // green
    };

    // Build per-state color entries from active arcs
    const arcAbbrs: string[] = [];
    const colorEntries: string[] = [];
    if (stateArcs && stateArcs.length > 0) {
      // Deduplicate: if a state has multiple arcs, highest-phase wins (grade > outcome > recognition)
      const phaseRank: Record<string, number> = { buildup: 0, recognition: 1, outcome: 2, grade: 3 };
      const bestPhase = new Map<string, string>();
      for (const arc of stateArcs) {
        const phase = arc.current_act;
        if (!ARC_PHASE_COLORS[phase]) continue; // skip buildup/closed
        const existing = bestPhase.get(arc.state_abbr);
        if (!existing || (phaseRank[phase] ?? 0) > (phaseRank[existing] ?? 0)) {
          bestPhase.set(arc.state_abbr, phase);
        }
      }
      for (const [abbr, phase] of bestPhase) {
        arcAbbrs.push(abbr);
        colorEntries.push(abbr, ARC_PHASE_COLORS[phase]);
      }
    }

    // Update filter — only show outlines for states with active arcs
    const filter: mapboxgl.Expression = arcAbbrs.length > 0
      ? ["in", ["get", "abbr"], ["literal", arcAbbrs]] as mapboxgl.Expression
      : ["==", ["get", "abbr"], "__none__"] as mapboxgl.Expression;
    map.setFilter("arc-phase-outline", filter);

    // Update line color per state
    if (colorEntries.length > 0) {
      map.setPaintProperty("arc-phase-outline", "line-color", [
        "match", ["get", "abbr"],
        ...colorEntries,
        "rgba(255,255,255,0.5)",
      ] as mapboxgl.Expression);
    }
  }, [stateArcs]);

  // Auto-activate layers on zoom (waterways at state zoom in scout/intel)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onZoom = () => {
      const zoom = map.getZoom();
      // Show waterways/water at state zoom when those layers are enabled
      const waterwayEnabled = visibleMapboxLayers ? visibleMapboxLayers.has('waterway-lines') : (mapMode === 'scout' || mapMode === 'intel');
      if (waterwayEnabled) {
        const vis = zoom >= 7 ? 'visible' : 'none';
        if (map.getLayer('waterway-lines')) map.setLayoutProperty('waterway-lines', 'visibility', vis);
        if (map.getLayer('water-fill')) map.setLayoutProperty('water-fill', 'visibility', vis);
      }
    };

    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapMode, visibleMapboxLayers]);

  // Dawn/dusk terminator: update every 60 seconds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const update = () => {
      const now = new Date();
      const terminatorSrc = map.getSource("terminator") as mapboxgl.GeoJSONSource | undefined;
      const goldenSrc = map.getSource("golden-hour") as mapboxgl.GeoJSONSource | undefined;
      if (terminatorSrc) terminatorSrc.setData(calculateTerminator(now));
      if (goldenSrc) goldenSrc.setData(calculateGoldenHour(now));
    };

    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Create/update county source + layers when GeoJSON loads (async, usually after map init)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !countyGeoJSON) return;

    const source = map.getSource("counties") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(countyGeoJSON);
    } else {
      // Source doesn't exist yet — create it + layers
      map.addSource("counties", { type: "geojson", data: countyGeoJSON });

      map.addLayer({
        id: "county-fill",
        type: "fill",
        source: "counties",
        paint: {
          "fill-color": "rgba(255,255,255,0.03)",
          "fill-opacity": 0,
        },
        minzoom: 5,
        layout: { visibility: (mapMode === 'scout' || mapMode === 'intel') ? "visible" : "none" },
      }, map.getLayer("states-fill") ? "states-fill" : undefined);

      map.addLayer({
        id: "county-line",
        type: "line",
        source: "counties",
        paint: {
          "line-color": "rgba(255,255,255,0.5)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.2, 8, 0.6, 10, 1],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 6, 0.3, 8, 0.6],
        },
        minzoom: 5,
      });
    }
  }, [countyGeoJSON, mapMode]);

  // Handle satellite style toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const newStyle = isSatellite ? "satellite" : "dark";
    if (newStyle === prevStyleRef.current) return;
    prevStyleRef.current = newStyle;

    const styleUrl = isSatellite
      ? "mapbox://styles/mapbox/satellite-streets-v12"
      : "mapbox://styles/mapbox/dark-v11";

    map.setStyle(styleUrl);

    // Re-add sources and layers after style loads
    map.once("style.load", () => {
      addSourcesAndLayers(map);
      if (show3D) {
        addTerrain(map);
      }
      startPulse();
    });
  }, [isSatellite, addSourcesAndLayers, show3D, startPulse]);

  // Handle 3D terrain toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    if (show3D) {
      addTerrain(map);
      if (map.getZoom() < 6) {
        // Zoom in + dramatic tilt so terrain is actually visible on globe projection
        map.flyTo({
          zoom: 5.5,
          pitch: 50,
          bearing: -20,
          duration: 1200,
        });
      } else {
        map.flyTo({ pitch: 50, bearing: -20, duration: 800 });
      }
    } else {
      removeTerrain(map);
      map.flyTo({ pitch: 0, bearing: 0, zoom: Math.min(map.getZoom(), 4.2), duration: 800 });
    }
  }, [show3D]);

  return (
    <div
      style={{ height: "100dvh", position: "relative", overflow: "hidden" }}
    >
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />
    </div>
  );
});

function addTerrain(map: mapboxgl.Map) {
  if (!map.getSource("mapbox-terrain")) {
    map.addSource("mapbox-terrain", {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
  }
  map.setTerrain({ source: "mapbox-terrain", exaggeration: map.getZoom() < 6 ? 3.5 : 1.5 });

  if (!map.getLayer("sky")) {
    map.addLayer({
      id: "sky",
      type: "sky",
      paint: {
        "sky-type": "atmosphere",
        "sky-atmosphere-sun": [0.0, 0.0],
        "sky-atmosphere-sun-intensity": 15,
      },
    });
  }

  map.setFog({
    color: 'rgb(10, 15, 26)',
    'high-color': 'rgb(25, 50, 100)',
    'horizon-blend': 0.1,
    'space-color': 'rgb(5, 8, 15)',
    'star-intensity': 0.5,
    range: [0.3, 8],
  });
}

function removeTerrain(map: mapboxgl.Map) {
  map.setTerrain(null);
  if (map.getLayer("sky")) {
    map.removeLayer("sky");
  }
  // Restore base atmosphere
  map.setFog({
    color: 'rgb(10, 15, 26)',
    'high-color': 'rgb(20, 40, 80)',
    'horizon-blend': 0.08,
    'space-color': 'rgb(5, 8, 15)',
    'star-intensity': 0.4,
    range: [0.5, 12],
  });
}

export default MapView;

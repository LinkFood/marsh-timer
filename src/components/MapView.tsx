import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import mapboxgl from "mapbox-gl";
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Species } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { fipsToAbbr } from "@/data/fips";
import { getPrimarySeasonForState, getStatesForSpecies } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";
import { getPopupHTML } from "@/components/MapPopup";
import { stateFlyways, FLYWAY_COLORS, isFlywaySpecies } from "@/data/flyways";
import type { FeatureCollection, Feature, Geometry, Position } from "geojson";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export type MapMode = 'default' | 'scout' | 'weather' | 'terrain' | 'intel';

export interface MapOverlays {
  wetlands: boolean;
  landCover: boolean;
  contours: boolean;
  waterways: boolean;
  agriculture: boolean;
  parks: boolean;
  trails: boolean;
}

// Mode -> layer mapping
const MODE_LAYERS: Record<MapMode, Partial<MapOverlays> & { radar?: boolean; tempHeatmap?: boolean; windArrows?: boolean }> = {
  default: {},
  scout: { wetlands: true, waterways: true, parks: true, trails: true },
  weather: { radar: true, tempHeatmap: true, windArrows: true },
  terrain: { landCover: true, contours: true },
  intel: { wetlands: true, waterways: true, radar: true, tempHeatmap: true, windArrows: true },
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

export interface MapViewProps {
  species: Species;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
  onDrillUp: () => void;
  showFlyways: boolean;
  isSatellite: boolean;
  show3D: boolean;
  isMobile?: boolean;
  showRadar?: boolean;
  radarTileUrl?: string | null;
  sightingsGeoJSON?: FeatureCollection | null;
  onMoveEnd?: (center: [number, number], zoom: number) => void;
  weatherCache?: Map<string, { temp: number; wind: number; windDir: number; pressure: number; precip: number }>;
  overlays?: MapOverlays;
  onElevation?: (elevation: number | null) => void;
  mapMode?: MapMode;
}

export interface MapViewRef {
  flyTo: (abbr: string) => void;
  flyToCoords: (lng: number, lat: number, zoom?: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

const TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const US_CENTER: [number, number] = [-98.5, 39.8];
const US_ZOOM = 3.5;
const STATE_ZOOM = 7;
const DRILL_UP_ZOOM_THRESHOLD = 4;

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
    showRadar = false,
    radarTileUrl = null,
    sightingsGeoJSON = null,
    onMoveEnd,
    weatherCache,
    overlays = { wetlands: false, landCover: false, contours: false, waterways: false, agriculture: false, parks: false, trails: false },
    onElevation,
    mapMode = 'default',
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const centroidsRef = useRef<Map<string, [number, number]>>(new Map());
  const pulseFrameRef = useRef<number>(0);
  const statesGeoRef = useRef<FeatureCollection | null>(null);
  const loadedRef = useRef(false);
  const flyingRef = useRef(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const selectedStateRef = useRef(selectedState);
  const prevStyleRef = useRef<string>("dark");
  const weatherCacheRef = useRef(weatherCache);

  selectedStateRef.current = selectedState;
  weatherCacheRef.current = weatherCache;

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
      flyToCoords: (lng: number, lat: number, zoom = 13) => {
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
        map.addSource("states", { type: "geojson", data: geoJSON });
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
            "fill-color": buildFillExpression(species, selectedState),
            "fill-opacity": 0.5,
          },
        });
      }

      // Pulse
      if (!map.getLayer("states-pulse")) {
        map.addLayer({
          id: "states-pulse",
          type: "fill",
          source: "states",
          filter: buildPulseFilter(species),
          paint: {
            "fill-color": buildFillExpression(species, selectedState),
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
            "line-color": speciesConfig[species].colors.selected,
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
              showFlyways && isFlywaySpecies(species) ? "visible" : "none",
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
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 10, 0.7],
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
          filter: ['==', ['get', 'class'], 'park'],
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
          minzoom: 8,
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

      // Radar overlay
      if (!map.getSource("radar")) {
        map.addSource("radar", {
          type: "raster",
          tiles: [radarTileUrl || ""],
          tileSize: 256,
        });
      }
      if (!map.getLayer("radar-overlay")) {
        map.addLayer(
          {
            id: "radar-overlay",
            type: "raster",
            source: "radar",
            paint: { "raster-opacity": 0.6 },
            layout: { visibility: showRadar && radarTileUrl ? "visible" : "none" },
          },
          "states-fill",
        );
      }

      // County boundaries (visible at state zoom, more prominent)
      if (!map.getLayer('county-boundaries')) {
        map.addLayer({
          id: 'county-boundaries',
          type: 'line',
          source: 'streets-v8',
          'source-layer': 'admin',
          filter: ['all', ['==', 'admin_level', 4], ['==', 'iso_3166_1', 'US']],
          paint: {
            'line-color': 'rgba(255,255,255,0.7)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 8, 0.8, 10, 1.2],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 6, 0.4, 8, 0.7],
          },
          minzoom: 4,
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

      // eBird sighting markers
      if (!map.getSource("ebird-sightings")) {
        map.addSource("ebird-sightings", {
          type: "geojson",
          data: sightingsGeoJSON || { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer("ebird-dots")) {
        map.addLayer({
          id: "ebird-dots",
          type: "circle",
          source: "ebird-sightings",
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

      // Wind arrows source (populated by weather data)
      if (!map.getSource("wind-arrows")) {
        map.addSource("wind-arrows", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer("wind-arrow-layer")) {
        map.addLayer({
          id: "wind-arrow-layer",
          type: "symbol",
          source: "wind-arrows",
          layout: {
            "icon-image": "wind-arrow",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 6, 0.7],
            "icon-rotate": ["get", "windDir"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            visibility: "none",
          },
          paint: {
            "icon-opacity": 0.7,
          },
        });
      }

      loadedRef.current = true;
    },
    [species, selectedState, showFlyways, statesWithData, showRadar, radarTileUrl, sightingsGeoJSON],
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
      // Create wind arrow icon (simple triangle pointing up, rotated by windDir)
      const arrowSize = 32;
      const canvas = document.createElement("canvas");
      canvas.width = arrowSize;
      canvas.height = arrowSize;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(arrowSize / 2, 4);
      ctx.lineTo(arrowSize / 2 + 8, arrowSize - 6);
      ctx.lineTo(arrowSize / 2, arrowSize - 10);
      ctx.lineTo(arrowSize / 2 - 8, arrowSize - 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      map.addImage("wind-arrow", { width: arrowSize, height: arrowSize, data: ctx.getImageData(0, 0, arrowSize, arrowSize).data } as any);

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

    // Click handler
    map.on("click", "states-fill", (e) => {
      if (!e.features || e.features.length === 0) return;
      const abbr = e.features[0].properties?.abbr;
      if (!abbr || !statesWithData.has(abbr)) return;
      onSelectState(abbr);
    });

    // Cursor + popup
    map.on("mouseenter", "states-fill", (e) => {
      if (e.features?.[0]?.properties?.abbr) {
        const abbr = e.features[0].properties.abbr;
        if (statesWithData.has(abbr)) {
          map.getCanvas().style.cursor = "pointer";

          // Show popup at centroid
          const centroid = centroidsRef.current.get(abbr);
          if (centroid && !isMobile) {
            popupRef.current?.remove();
            popupRef.current = new mapboxgl.Popup({
              closeButton: false,
              closeOnClick: false,
              className: "hunt-popup",
              offset: 10,
            })
              .setLngLat(centroid)
              .setHTML(getPopupHTML(abbr, STATE_NAMES[abbr] || abbr, species, weatherCacheRef.current?.get(abbr)))
              .addTo(map);
          }
        }
      }
    });

    map.on("mouseleave", "states-fill", () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
      popupRef.current = null;
    });

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

    const expression = buildFillExpression(species, selectedState);
    if (map.getLayer("states-fill")) {
      map.setPaintProperty("states-fill", "fill-color", expression);
    }
    if (map.getLayer("states-pulse")) {
      map.setPaintProperty("states-pulse", "fill-color", expression);
      map.setPaintProperty("states-pulse", "fill-opacity", 0.5);
      map.setFilter("states-pulse", buildPulseFilter(species));
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
        speciesConfig[species].colors.selected,
      );
    }
  }, [species, selectedState]);

  // FlyTo when selectedState changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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

    const visible = showFlyways && isFlywaySpecies(species);
    if (map.getLayer("flyway-fill")) {
      map.setLayoutProperty(
        "flyway-fill",
        "visibility",
        visible ? "visible" : "none",
      );
    }
  }, [showFlyways, species]);

  // Toggle radar overlay visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    if (map.getLayer("radar-overlay")) {
      map.setLayoutProperty(
        "radar-overlay",
        "visibility",
        showRadar && radarTileUrl ? "visible" : "none",
      );
    }
  }, [showRadar, radarTileUrl]);

  // Update radar tile URL
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !radarTileUrl) return;

    const source = map.getSource("radar") as mapboxgl.RasterTileSource | undefined;
    if (source) {
      source.setTiles([radarTileUrl]);
    }
  }, [radarTileUrl]);

  // Update eBird sightings data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const source = map.getSource("ebird-sightings") as mapboxgl.GeoJSONSource | undefined;
    if (source && sightingsGeoJSON) {
      source.setData(sightingsGeoJSON);
    }
  }, [sightingsGeoJSON]);

  // Toggle overlay visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const layerMap: Record<string, boolean> = {
      'wetland-fill': overlays.wetlands,
      'landcover-fill': overlays.landCover,
      'contour-lines': overlays.contours,
      'contour-labels': overlays.contours,
      'waterway-lines': overlays.waterways,
      'waterway-intermittent': overlays.waterways,
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

  // Mode-driven layer activation + temperature heatmap + wind arrows
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const modeConfig = MODE_LAYERS[mapMode];
    const showTempHeatmap = !!modeConfig.tempHeatmap;
    const showWindArrows = !!modeConfig.windArrows;

    // Apply overlay visibility from mode
    const layerMap: Record<string, boolean> = {
      'wetland-fill': !!modeConfig.wetlands,
      'landcover-fill': !!modeConfig.landCover,
      'contour-lines': !!modeConfig.contours,
      'contour-labels': !!modeConfig.contours,
      'waterway-lines': !!modeConfig.waterways,
      'waterway-intermittent': !!modeConfig.waterways,
      'agriculture-fill': !!modeConfig.agriculture,
      'parks-fill': !!modeConfig.parks,
      'trails-lines': !!modeConfig.trails,
      'wind-arrow-layer': showWindArrows,
    };

    for (const [layerId, visible] of Object.entries(layerMap)) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    }

    // Radar from mode
    if (map.getLayer("radar-overlay")) {
      const radarOn = !!modeConfig.radar && !!radarTileUrl;
      map.setLayoutProperty("radar-overlay", "visibility", radarOn ? "visible" : "none");
    }

    // Temperature heatmap: override state fill colors with temp-based gradient
    if (showTempHeatmap && weatherCache && weatherCache.size > 0 && map.getLayer("states-fill")) {
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
        map.setPaintProperty("states-fill", "fill-opacity", 0.65);
      }
    } else if (map.getLayer("states-fill")) {
      // Restore normal species-based fill
      map.setPaintProperty("states-fill", "fill-color", buildFillExpression(species, selectedState));
      map.setPaintProperty("states-fill", "fill-opacity", 0.5);
    }

    // Wind arrows: update GeoJSON with current weather data
    if (showWindArrows && weatherCache && weatherCache.size > 0) {
      const features: Feature[] = [];
      for (const [abbr, w] of weatherCache) {
        const centroid = centroidsRef.current.get(abbr);
        if (centroid && w.wind > 3) { // Only show arrows for wind > 3mph
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: centroid },
            properties: { abbr, windDir: w.windDir, windSpeed: w.wind },
          });
        }
      }
      const source = map.getSource("wind-arrows") as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData({ type: "FeatureCollection", features });
      }
    }
  }, [mapMode, weatherCache, radarTileUrl, species, selectedState]);

  // Auto-activate layers on zoom (county boundaries + waterways always show when zoomed in)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onZoom = () => {
      const zoom = map.getZoom();
      // Auto-show waterways at zoom 8+ in scout/intel modes
      if (mapMode === 'scout' || mapMode === 'intel') {
        if (map.getLayer('waterway-lines')) {
          map.setLayoutProperty('waterway-lines', 'visibility', zoom >= 7 ? 'visible' : 'none');
        }
      }
    };

    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapMode]);

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
    } else {
      removeTerrain(map);
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
  map.setTerrain({ source: "mapbox-terrain", exaggeration: 1.5 });

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
    range: [0.8, 8],
    color: '#0a1628',
    'horizon-blend': 0.05,
    'star-intensity': 0.15,
  });
}

function removeTerrain(map: mapboxgl.Map) {
  map.setTerrain(null);
  map.setFog(null);
  if (map.getLayer("sky")) {
    map.removeLayer("sky");
  }
}

export default MapView;

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
import { stateFlyways, FLYWAY_COLORS, isFlywaySpecies } from "@/data/flyways";
import type { FeatureCollection, Feature, Geometry, Position } from "geojson";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export interface MapViewProps {
  species: Species;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
  onDrillUp: () => void;
  showFlyways: boolean;
  isSatellite: boolean;
  show3D: boolean;
  isMobile?: boolean;
}

export interface MapViewRef {
  flyTo: (abbr: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

const TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const US_CENTER: [number, number] = [-98.5, 39.8];
const US_ZOOM = 3.5;
const STATE_ZOOM = 5.5;
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
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const centroidsRef = useRef<Map<string, [number, number]>>(new Map());
  const pulseFrameRef = useRef<number>(0);
  const statesGeoRef = useRef<FeatureCollection | null>(null);
  const loadedRef = useRef(false);
  const selectedStateRef = useRef(selectedState);
  const prevStyleRef = useRef<string>("dark");

  selectedStateRef.current = selectedState;

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
          map.flyTo({ center: centroid, zoom: STATE_ZOOM, duration: 1000 });
        }
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
        if (map) map.flyTo({ center: US_CENTER, zoom: US_ZOOM, duration: 1000 });
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
          paint: { "line-color": "#0a1a0a", "line-width": 0.5 },
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
            "line-width": 3,
            "line-opacity": 0.9,
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
            "text-color": "#d4d4d4",
            "text-halo-color": "#000000",
            "text-halo-width": 1,
          },
        });
      }

      loadedRef.current = true;
    },
    [species, selectedState, showFlyways, statesWithData],
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
    });

    map.touchZoomRotate.enable();
    mapRef.current = map;
    prevStyleRef.current = isSatellite ? "satellite" : "dark";

    map.on("load", async () => {
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
    });

    // Click handler
    map.on("click", "states-fill", (e) => {
      if (!e.features || e.features.length === 0) return;
      const abbr = e.features[0].properties?.abbr;
      if (!abbr || !statesWithData.has(abbr)) return;
      onSelectState(abbr);
    });

    // Cursor
    map.on("mouseenter", "states-fill", (e) => {
      if (e.features?.[0]?.properties?.abbr) {
        const abbr = e.features[0].properties.abbr;
        if (statesWithData.has(abbr)) {
          map.getCanvas().style.cursor = "pointer";
        }
      }
    });

    map.on("mouseleave", "states-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    // Zoom out detection for drill up
    map.on("zoomend", () => {
      const zoom = map.getZoom();
      if (zoom < DRILL_UP_ZOOM_THRESHOLD && selectedStateRef.current) {
        onDrillUp();
      }
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
        map.flyTo({ center: centroid, zoom: STATE_ZOOM, duration: 1000 });
      }
    } else {
      map.flyTo({ center: US_CENTER, zoom: US_ZOOM, duration: 1000 });
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
}

function removeTerrain(map: mapboxgl.Map) {
  map.setTerrain(null);
  if (map.getLayer("sky")) {
    map.removeLayer("sky");
  }
}

export default MapView;

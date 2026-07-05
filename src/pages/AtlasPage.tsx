import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SUPABASE_FUNCTIONS_URL } from "@/lib/supabase";

/**
 * ATLAS — the living map of the ground you stand on (docs/THE-VISION-AND-ROADMAP.md).
 * Globe-first, zoom smaller and smaller to the ground. Read-only: it never writes
 * the DB. First real layer = earthquakes (deep, true point coords). Click a dot ->
 * fly to the ACTUAL spot. The hunter operates it; the kid marvels at it.
 */
const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

type Quake = { lat: number; lng: number; magnitude: number; date: string; place: string; depth_km: number | null };

export default function AtlasPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [-98.5, 39.5],
      zoom: 2.4,
      minZoom: 0.8,
      maxZoom: 17,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");
    map.on("style.load", () => map.setProjection({ type: "globe" }));
    mapRef.current = map;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "280px" });

    map.on("load", async () => {
      map.resize();

      // First real layer: earthquakes (read-only fetch — no DB writes).
      let quakes: Quake[] = [];
      try {
        const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-earthquakes?minMag=4&from=1990-01-01`, {
          headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
        });
        const json = await res.json();
        quakes = Array.isArray(json?.points) ? json.points : [];
      } catch {
        quakes = [];
      }

      const fc = {
        type: "FeatureCollection" as const,
        features: quakes
          .filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.lng))
          .map((q) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [q.lng, q.lat] },
            properties: { mag: q.magnitude, date: q.date, place: q.place, depth: q.depth_km },
          })),
      };

      map.addSource("quakes", { type: "geojson", data: fc });
      map.addLayer({
        id: "quakes",
        type: "circle",
        source: "quakes",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 4, 4, 6, 10, 8, 18],
          "circle-color": ["interpolate", ["linear"], ["get", "mag"], 4, "#f2c14e", 5, "#e8853a", 6, "#d1462f", 8, "#8f1d1d"],
          "circle-opacity": 0.72,
          "circle-stroke-color": "#0f1016",
          "circle-stroke-width": 0.6,
        },
      });

      // Hover: cursor + telemetry readout that follows the dot.
      map.on("mouseenter", "quakes", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { mag: number; date: string; place: string; depth: number };
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        popup
          .setLngLat([lng, lat])
          .setHTML(
            `<div style="font-family:ui-monospace,monospace;font-size:11px;line-height:1.5;color:#1a1a1a">` +
              `<div style="font-weight:700;font-size:13px">M${p.mag} &middot; ${p.date}</div>` +
              `<div>${p.place}</div>` +
              `<div style="color:#777">depth ${p.depth ?? "?"} km &middot; click to fly here</div>` +
              `</div>`
          )
          .addTo(map);
      });
      map.on("mouseleave", "quakes", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      // Click a dot -> fly to the ACTUAL spot (precise coords, fall to the ground).
      map.on("click", "quakes", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        map.flyTo({ center: [lng, lat], zoom: 8.5, speed: 0.8, curve: 1.4, essential: true });
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-screen w-full bg-gray-950 text-gray-100">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 select-none">
        <div className="rounded bg-gray-950/80 px-3 py-2 backdrop-blur-sm ring-1 ring-white/10">
          <div className="font-mono text-[11px] tracking-[0.24em] text-cyan-300/90">DUCK COUNTDOWN</div>
          <div className="mt-0.5 text-sm text-gray-300">The ground you stand on</div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10">
        <div className="rounded bg-gray-950/70 px-3 py-1.5 font-mono text-[10px] text-gray-400 backdrop-blur-sm ring-1 ring-white/5">
          earthquakes 1990&ndash;now &middot; hover to read &middot; click to fly there
        </div>
      </div>
    </div>
  );
}

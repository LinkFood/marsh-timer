import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { US_STATES_GEOJSON } from "@/data/atlas/usStates.geojson";
import { fetchStateAnomaly, buildChoroplethPaint, QUIET_COLOR } from "@/lib/atlas/stateChoropleth";

/**
 * ATLAS — the living map of the ground you stand on (docs/THE-VISION-AND-ROADMAP.md).
 * NESTED BOXES, not a dot-scatter: the default view is US states as boxes shaded by
 * what they're doing NOW (anomaly vs each state's own history). Click a box to drill
 * in; the SPOT DOSSIER (now + past) lands next. Globe-first, Apple-clean, read-only.
 */
function anomalyPhrase(z: number | undefined): string {
  if (z === undefined) return "typical / no reading";
  if (z >= 2) return `much warmer than normal (z +${z.toFixed(1)})`;
  if (z >= 1) return `warmer than normal (z +${z.toFixed(1)})`;
  if (z <= -2) return `much colder than normal (z ${z.toFixed(1)})`;
  if (z <= -1) return `colder than normal (z ${z.toFixed(1)})`;
  return `about normal (z ${z >= 0 ? "+" : ""}${z.toFixed(1)})`;
}

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

    // Keep the canvas sized to its container. Without this, a map created before
    // its container has final size (or after a window resize) can get stuck with
    // a 0/stale viewport and never request tiles — the map renders blank.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    requestAnimationFrame(() => map.resize());

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px" });

    map.on("load", async () => {
      map.resize();

      // States shaded by what they're doing NOW (read-only fetch of per-state z).
      let zByState: Record<string, number> = {};
      try {
        zByState = await fetchStateAnomaly();
      } catch {
        zByState = {};
      }

      const paint =
        Object.keys(zByState).length > 0
          ? buildChoroplethPaint(zByState, { theme: "light" })
          : {
              "fill-color": QUIET_COLOR.light,
              "fill-opacity": 0.3,
              "fill-outline-color": "rgba(11,11,11,0.10)",
            };

      map.addSource("states", { type: "geojson", data: US_STATES_GEOJSON as unknown as GeoJSON.FeatureCollection });
      map.addLayer({ id: "states-fill", type: "fill", source: "states", paint });

      // Hover a box -> calm readout (name + how it compares to its own history).
      map.on("mousemove", "states-fill", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as { state?: string; name?: string };
        const abbr = props.state ?? "";
        const z = zByState[abbr];
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:ui-monospace,monospace;font-size:11px;line-height:1.55;color:#1a1a1a">` +
              `<div style="font-weight:700;font-size:13px">${props.name ?? abbr}</div>` +
              `<div style="color:#555">${anomalyPhrase(z)}</div>` +
              `<div style="color:#999">today vs 76 yrs here &middot; click to drill in</div>` +
              `</div>`
          )
          .addTo(map);
      });
      map.on("mouseleave", "states-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      // Click a box -> drill in (fall toward it; county boxes + spot dossier land next).
      map.on("click", "states-fill", (e) => {
        map.flyTo({ center: e.lngLat, zoom: 6, speed: 0.8, curve: 1.4, essential: true });
      });
    });

    return () => {
      ro.disconnect();
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
          states shaded by today vs their own history &middot; hover to read &middot; click to drill in
        </div>
      </div>
    </div>
  );
}

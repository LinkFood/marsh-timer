import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * ATLAS — Rung 1 shell of the living map (see docs/THE-VISION-AND-ROADMAP.md).
 * A granular, zoomable, ad-free map of the ground you stand on. This is the
 * extensible skeleton: the build swarm layers anomaly dots, click-to-dossier,
 * drill-down, and the rhyme trigger on top of it. Read-only — never writes the DB.
 */
export default function AtlasPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-98.5, 39.5], // continental US
      zoom: 3.6,
      minZoom: 2.5,
      maxZoom: 14,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-screen w-full bg-gray-950 text-gray-100">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 select-none">
        <div className="rounded bg-gray-950/80 px-3 py-2 backdrop-blur-sm ring-1 ring-white/10">
          <div className="font-mono text-[11px] tracking-[0.24em] text-cyan-300/90">DUCK COUNTDOWN</div>
          <div className="mt-0.5 text-sm text-gray-300">The ground you stand on</div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10">
        <div className="rounded bg-gray-950/70 px-3 py-1.5 font-mono text-[10px] text-gray-500 backdrop-blur-sm ring-1 ring-white/5">
          shell · anomaly dots + rhyme trigger land next
        </div>
      </div>
    </div>
  );
}

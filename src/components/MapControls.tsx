import { useState } from "react";
import { Crosshair, Layers, Navigation, HelpCircle, Plus, Minus, Mountain } from "lucide-react";

interface MapControlsProps {
  onGeolocate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  showFlyways: boolean;
  onToggleFlyways: () => void;
  showFlywayOption: boolean;
  isSatellite: boolean;
  onToggleSatellite: () => void;
  show3D: boolean;
  onToggle3D: () => void;
}

const legendItems = [
  { label: "Open", color: "#22c55e" },
  { label: "< 30 Days", color: "#f59e0b" },
  { label: "Upcoming", color: "#2d5a2d" },
  { label: "Closed", color: "#1a2e1a" },
];

export default function MapControls({
  onGeolocate,
  onZoomIn,
  onZoomOut,
  showFlyways,
  onToggleFlyways,
  showFlywayOption,
  onToggleSatellite,
  isSatellite,
  show3D,
  onToggle3D,
}: MapControlsProps) {
  const [legendOpen, setLegendOpen] = useState(false);

  const activeClass = "bg-primary/20 text-primary border-primary/30";
  const inactiveClass = "map-overlay-panel border border-border/50 text-foreground";
  const btnBase =
    "w-11 h-11 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div className="fixed bottom-6 right-4 z-20 flex flex-col items-end gap-2 sm:bottom-6 max-sm:bottom-20">
      {/* Control buttons */}
      <div className="flex flex-col gap-2">
        {/* Zoom controls */}
        <button
          onClick={onZoomIn}
          className={`${btnBase} ${inactiveClass}`}
          aria-label="Zoom in"
        >
          <Plus size={20} />
        </button>

        <button
          onClick={onZoomOut}
          className={`${btnBase} ${inactiveClass}`}
          aria-label="Zoom out"
        >
          <Minus size={20} />
        </button>

        <button
          onClick={onGeolocate}
          className={`${btnBase} ${inactiveClass}`}
          aria-label="Find my location"
        >
          <Crosshair size={20} />
        </button>

        <button
          onClick={onToggleSatellite}
          className={`${btnBase} ${isSatellite ? activeClass : inactiveClass}`}
          aria-label="Toggle satellite view"
        >
          <Layers size={20} />
        </button>

        <button
          onClick={onToggle3D}
          className={`${btnBase} ${show3D ? activeClass : inactiveClass}`}
          aria-label="Toggle 3D terrain"
        >
          <Mountain size={20} />
        </button>

        {showFlywayOption && (
          <button
            onClick={onToggleFlyways}
            className={`${btnBase} ${showFlyways ? activeClass : inactiveClass}`}
            aria-label="Toggle flyway overlay"
          >
            <Navigation size={20} />
          </button>
        )}

        <button
          onClick={() => setLegendOpen((prev) => !prev)}
          className={`${btnBase} ${legendOpen ? activeClass : inactiveClass}`}
          aria-label="Toggle legend"
        >
          <HelpCircle size={20} />
        </button>
      </div>

      {/* Legend */}
      {legendOpen && (
        <div className="map-overlay-panel rounded-lg border border-border/50 px-3 py-2 flex flex-col gap-1">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
              <span className="text-[10px] leading-none">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { Crosshair, Layers, Navigation, Plus, Minus, Mountain } from "lucide-react";

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
  const activeClass = "bg-cyan-400/10 text-cyan-400 border-cyan-400/20";
  const inactiveClass = "glass-panel border border-white/[0.06] text-white/60";
  const btnBase =
    "w-9 h-9 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div className="fixed bottom-6 right-4 z-20 flex flex-col items-end gap-2 sm:bottom-6 max-sm:bottom-[320px]">
      <div className="flex flex-col gap-2">
        {/* Zoom controls */}
        <button
          onClick={onZoomIn}
          className={`${btnBase} ${inactiveClass}`}
          aria-label="Zoom in"
        >
          <Plus size={16} />
        </button>

        <button
          onClick={onZoomOut}
          className={`${btnBase} ${inactiveClass}`}
          aria-label="Zoom out"
        >
          <Minus size={16} />
        </button>

        <button
          onClick={onGeolocate}
          className={`${btnBase} ${inactiveClass}`}
          aria-label="Find my location"
        >
          <Crosshair size={16} />
        </button>

        {/* Divider */}
        <div className="w-6 h-px bg-white/10 mx-auto" />

        {/* Toggle controls */}
        <button
          onClick={onToggleSatellite}
          className={`${btnBase} ${isSatellite ? activeClass : inactiveClass}`}
          aria-label="Toggle satellite view"
        >
          <Layers size={16} />
        </button>

        <button
          onClick={onToggle3D}
          className={`${btnBase} ${show3D ? activeClass : inactiveClass}`}
          aria-label="Toggle 3D terrain"
        >
          <Mountain size={16} />
        </button>

        {showFlywayOption && (
          <button
            onClick={onToggleFlyways}
            className={`${btnBase} ${showFlyways ? activeClass : inactiveClass}`}
            aria-label="Toggle flyway overlay"
          >
            <Navigation size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

import {
  Map,
  Eye,
  CloudRain,
  Mountain,
  Zap,
  Box,
  Layers,
  Navigation,
  Plus,
  Minus,
  Crosshair,
} from "lucide-react";

export type MapMode = "default" | "scout" | "weather" | "terrain" | "intel";

interface MapPresetsProps {
  mode: MapMode;
  onSetMode: (mode: MapMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onGeolocate: () => void;
  show3D: boolean;
  onToggle3D: () => void;
  isSatellite: boolean;
  onToggleSatellite: () => void;
  showFlyways: boolean;
  onToggleFlyways: () => void;
  showFlywayOption: boolean;
}

const modes: { key: MapMode; label: string; icon: typeof Map }[] = [
  { key: "default", label: "Default", icon: Map },
  { key: "scout", label: "Scout", icon: Eye },
  { key: "weather", label: "Weather", icon: CloudRain },
  { key: "terrain", label: "Terrain", icon: Mountain },
  { key: "intel", label: "Intel", icon: Zap },
];

export default function MapPresets({
  mode,
  onSetMode,
  onZoomIn,
  onZoomOut,
  onGeolocate,
  show3D,
  onToggle3D,
  isSatellite,
  onToggleSatellite,
  showFlyways,
  onToggleFlyways,
  showFlywayOption,
}: MapPresetsProps) {
  const panelClass =
    "bg-[rgba(10,15,30,0.85)] backdrop-blur-[12px] border border-white/[0.08] rounded-xl";

  const activeMode = "bg-cyan-400/10 text-cyan-400 border border-cyan-400/20";
  const inactiveMode = "text-white/50 hover:text-white/80 border border-transparent";

  const utilActive = "bg-cyan-400/10 text-cyan-400 border-cyan-400/20";
  const utilInactive = "text-white/50 hover:text-white/80 border-white/[0.06]";

  const zoomBtn =
    "w-8 h-8 rounded-full flex items-center justify-center transition-colors text-white/50 hover:text-white/80 border border-white/[0.06] bg-[rgba(10,15,30,0.85)] backdrop-blur-[12px]";

  return (
    <div className="fixed right-3 z-20 flex flex-col items-end gap-2 top-1/2 -translate-y-1/2 max-sm:top-auto max-sm:bottom-[300px] max-sm:translate-y-0">
      {/* Mode selector */}
      <div className={`${panelClass} p-1 flex max-sm:flex-row sm:flex-col gap-0.5`}>
        {modes.map(({ key, label, icon: Icon }) => {
          const isActive = mode === key;
          return (
            <button
              key={key}
              onClick={() => onSetMode(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-body transition-colors max-sm:px-2 max-sm:py-1.5 ${
                isActive ? activeMode : inactiveMode
              }`}
              aria-label={`${label} mode`}
            >
              <Icon size={14} />
              <span className="max-sm:hidden">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Utility toggles */}
      <div className={`${panelClass} p-1 flex gap-0.5`}>
        <button
          onClick={onToggle3D}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors border text-xs ${
            show3D ? utilActive : utilInactive
          }`}
          aria-label="Toggle 3D terrain"
        >
          <Box size={14} />
        </button>

        <button
          onClick={onToggleSatellite}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors border text-xs ${
            isSatellite ? utilActive : utilInactive
          }`}
          aria-label="Toggle satellite view"
        >
          <Layers size={14} />
        </button>

        {showFlywayOption && (
          <button
            onClick={onToggleFlyways}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors border text-xs ${
              showFlyways ? utilActive : utilInactive
            }`}
            aria-label="Toggle flyway overlay"
          >
            <Navigation size={14} />
          </button>
        )}
      </div>

      {/* Zoom + geolocate */}
      <div className="flex flex-col gap-1.5">
        <button onClick={onZoomIn} className={zoomBtn} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button onClick={onZoomOut} className={zoomBtn} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button onClick={onGeolocate} className={zoomBtn} aria-label="Find my location">
          <Crosshair size={14} />
        </button>
      </div>
    </div>
  );
}

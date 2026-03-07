import { Droplets, Mountain, TreePine, X } from "lucide-react";
import type { MapOverlays } from "./MapView";

interface LayersPanelProps {
  overlays: MapOverlays;
  onToggle: (key: keyof MapOverlays) => void;
  isOpen: boolean;
  onClose: () => void;
}

interface LayerToggleProps {
  label: string;
  active: boolean;
  color: string;
  onToggle: () => void;
}

function LayerToggle({ label, active, color, onToggle }: LayerToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-between w-full py-1.5 px-1 rounded-md hover:bg-white/5 transition-colors group"
    >
      <div className="flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-body text-white/70 group-hover:text-white/90 transition-colors">
          {label}
        </span>
      </div>
      <div
        className="w-7 h-4 rounded-full relative transition-colors duration-200 flex-shrink-0"
        style={{ backgroundColor: active ? "#22d3ee" : "rgba(255,255,255,0.2)" }}
      >
        <div
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200"
          style={{ transform: active ? "translateX(14px)" : "translateX(2px)" }}
        />
      </div>
    </button>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function Section({ icon, title, children }: SectionProps) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-1.5 mb-1.5 px-1">
        <span className="text-white/40">{icon}</span>
        <span className="uppercase tracking-wider text-[9px] text-white/40 font-medium">
          {title}
        </span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export default function LayersPanel({ overlays, onToggle, isOpen, onClose }: LayersPanelProps) {
  return (
    <div
      className="fixed"
      style={{
        top: 160,
        right: 12,
        zIndex: 25,
        width: 200,
        pointerEvents: isOpen ? "auto" : "none",
        transition: "opacity 250ms ease, transform 250ms ease",
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? "translateX(0)" : "translateX(20px)",
      }}
    >
      <div
        className="rounded-xl shadow-2xl overflow-hidden"
        style={{
          background: "rgba(10, 15, 30, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="uppercase tracking-wider text-[10px] text-white/50 font-semibold">
            Layers
          </span>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/80 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Sections */}
        <div className="px-2 pb-3">
          <Section icon={<Droplets size={10} />} title="Water">
            <LayerToggle
              label="Wetlands"
              active={overlays.wetlands}
              color="#2dd4bf"
              onToggle={() => onToggle("wetlands")}
            />
            <LayerToggle
              label="Waterways"
              active={overlays.waterways}
              color="#3b82f6"
              onToggle={() => onToggle("waterways")}
            />
          </Section>

          <Section icon={<Mountain size={10} />} title="Terrain">
            <LayerToggle
              label="Land Cover"
              active={overlays.landCover}
              color="#22c55e"
              onToggle={() => onToggle("landCover")}
            />
            <LayerToggle
              label="Contour Lines"
              active={overlays.contours}
              color="#ffffff"
              onToggle={() => onToggle("contours")}
            />
          </Section>

          <Section icon={<TreePine size={10} />} title="Land">
            <LayerToggle
              label="Agriculture"
              active={overlays.agriculture}
              color="#f59e0b"
              onToggle={() => onToggle("agriculture")}
            />
            <LayerToggle
              label="Parks"
              active={overlays.parks}
              color="#10b981"
              onToggle={() => onToggle("parks")}
            />
            <LayerToggle
              label="Trails"
              active={overlays.trails}
              color="#f97316"
              onToggle={() => onToggle("trails")}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Layers, ChevronDown, ChevronUp } from "lucide-react";
import type { MapMode } from "@/components/MapView";

interface MapLegendProps {
  mode: MapMode;
  sidebarExpanded?: boolean;
  isMobile?: boolean;
}

interface LegendItem {
  type: "scale" | "icon";
  label: string;
  // For scale: array of { color, label } stops
  stops?: { color: string; label: string }[];
  // For icon: single color swatch
  color?: string;
  // For icon: line style instead of circle
  line?: boolean;
  // For icon: dashed line
  dashed?: boolean;
}

const LEGEND_CONTENT: Record<MapMode, { title: string; items: LegendItem[] }> = {
  default: {
    title: "Season Overview",
    items: [
      {
        type: "scale",
        label: "Season Status",
        stops: [
          { color: "#10b981", label: "Open" },
          { color: "#f59e0b", label: "Soon" },
          { color: "#6b7280", label: "Closed" },
        ],
      },
      { type: "icon", label: "Flyway corridors", color: "rgba(100,180,255,0.5)", line: true },
      { type: "icon", label: "Bird activity", color: "#10b981" },
    ],
  },
  scout: {
    title: "Habitat Recon",
    items: [
      { type: "icon", label: "Huntable state", color: "rgba(20,184,166,0.6)" },
      { type: "icon", label: "Wetlands", color: "#22d3ee" },
      { type: "icon", label: "Parks / refuges", color: "#22c55e" },
      { type: "icon", label: "Water bodies", color: "#3b82f6" },
      {
        type: "scale",
        label: "eBird sightings",
        stops: [
          { color: "#10b981", label: "Today" },
          { color: "#f59e0b", label: "Recent" },
          { color: "#64748b", label: "Older" },
        ],
      },
    ],
  },
  weather: {
    title: "Weather",
    items: [
      {
        type: "scale",
        label: "Temperature",
        stops: [
          { color: "#3b82f6", label: "Cold" },
          { color: "#22d3ee", label: "" },
          { color: "#34d399", label: "" },
          { color: "#facc15", label: "" },
          { color: "#fb923c", label: "" },
          { color: "#ef4444", label: "Hot" },
        ],
      },
      { type: "icon", label: "Radar overlay", color: "#60a5fa" },
      { type: "icon", label: "Isobars + H/L", color: "rgba(150,200,255,0.7)", line: true },
      {
        type: "scale",
        label: "NWS alerts",
        stops: [
          { color: "#ef4444", label: "Warning" },
          { color: "#fb923c", label: "Watch" },
          { color: "#facc15", label: "Advisory" },
        ],
      },
      { type: "icon", label: "Wind flow", color: "rgba(255,255,255,0.8)", line: true, dashed: true },
    ],
  },
  terrain: {
    title: "Topographic",
    items: [
      {
        type: "scale",
        label: "Land cover",
        stops: [
          { color: "#a3e635", label: "Crop" },
          { color: "#22c55e", label: "Wood" },
          { color: "#84cc16", label: "Grass" },
        ],
      },
      { type: "icon", label: "Contour lines", color: "rgba(255,255,255,0.4)", line: true },
    ],
  },
  intel: {
    title: "Command Center",
    items: [
      {
        type: "scale",
        label: "Hunt Score",
        stops: [
          { color: "#6b7280", label: "0" },
          { color: "#3b82f6", label: "20" },
          { color: "#facc15", label: "40" },
          { color: "#fb923c", label: "60" },
          { color: "#ef4444", label: "100" },
        ],
      },
      { type: "icon", label: "Hotspots (70+)", color: "#ef4444" },
      { type: "icon", label: "Migration front", color: "#00ffff", line: true, dashed: true },
      { type: "icon", label: "NWS alerts", color: "#fb923c" },
      { type: "icon", label: "Flyway corridors", color: "rgba(100,180,255,0.5)", line: true },
    ],
  },
};

function ScaleRow({ stops }: { stops: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {stops.map((s, i) => (
        <div key={i} className="flex flex-col items-center">
          <div
            className="rounded-sm"
            style={{
              backgroundColor: s.color,
              width: s.label ? 18 : 12,
              height: 6,
            }}
          />
          {s.label && (
            <span className="text-[8px] text-white/40 mt-0.5 leading-none">{s.label}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function IconRow({ item }: { item: LegendItem }) {
  return (
    <div className="flex items-center gap-1.5">
      {item.line ? (
        <div className="flex items-center" style={{ width: 14, height: 10 }}>
          <div
            style={{
              width: 14,
              height: 0,
              borderTop: `2px ${item.dashed ? 'dashed' : 'solid'} ${item.color}`,
            }}
          />
        </div>
      ) : (
        <div
          className="rounded-full shrink-0"
          style={{ width: 8, height: 8, backgroundColor: item.color }}
        />
      )}
      <span className="text-[10px] text-white/60 leading-tight">{item.label}</span>
    </div>
  );
}

export default function MapLegend({ mode, sidebarExpanded, isMobile }: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(!!isMobile);
  const content = LEGEND_CONTENT[mode];

  const leftOffset = !isMobile && sidebarExpanded ? "calc(340px + 0.75rem)" : "0.75rem";

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed z-20 flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-300"
        style={{
          bottom: "3rem",
          left: leftOffset,
          background: "rgba(10,15,30,0.85)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        aria-label="Show map legend"
      >
        <Layers size={14} className="text-white/50" />
      </button>
    );
  }

  return (
    <div
      className="fixed z-20 rounded-xl transition-all duration-300"
      style={{
        bottom: "3rem",
        left: leftOffset,
        background: "rgba(10,15,30,0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.08)",
        minWidth: 140,
        maxWidth: 180,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(true)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 group"
      >
        <span className="text-[10px] font-body font-medium text-white/70 uppercase tracking-wider">
          {content.title}
        </span>
        <ChevronDown size={12} className="text-white/30 group-hover:text-white/60 transition-colors" />
      </button>

      {/* Items */}
      <div className="px-2.5 pb-2 flex flex-col gap-1.5">
        {content.items.map((item, i) => (
          <div key={i}>
            {item.type === "scale" && item.stops ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-white/50 leading-none">{item.label}</span>
                <ScaleRow stops={item.stops} />
              </div>
            ) : (
              <IconRow item={item} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

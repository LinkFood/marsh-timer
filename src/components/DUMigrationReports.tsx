import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useDUMapReports } from "@/hooks/useDUMapReports";

interface DUMigrationReportsProps {
  currentState?: string | null;
}

const ACTIVITY_COLORS: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: "bg-green-500/20", text: "text-green-400", label: "Light" },
  2: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "Moderate" },
  3: { bg: "bg-orange-500/20", text: "text-orange-400", label: "Good" },
  4: { bg: "bg-red-500/20", text: "text-red-400", label: "Excellent" },
};

const DEFAULT_ACTIVITY = { bg: "bg-white/[0.06]", text: "text-white/40", label: "Unknown" };

function getActivityStyle(id: number) {
  return ACTIVITY_COLORS[id] || DEFAULT_ACTIVITY;
}

function relativeDate(dateStr: string): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface ReportItem {
  activity_level: string;
  activity_level_id: number;
  classification: string;
  submit_date: string;
  weather: string;
  location_name: string;
  state_abbr: string;
}

export default function DUMigrationReports({ currentState }: DUMigrationReportsProps) {
  const { geojson, loading } = useDUMapReports();

  const grouped = useMemo(() => {
    const map = new Map<string, ReportItem[]>();
    for (const feature of geojson.features) {
      const props = feature.properties as ReportItem;
      const st = props.state_abbr;
      if (!st) continue;
      if (!map.has(st)) map.set(st, []);
      map.get(st)!.push(props);
    }
    // Sort states alphabetically, but put currentState first
    const entries = Array.from(map.entries()).sort((a, b) => {
      if (currentState) {
        if (a[0] === currentState) return -1;
        if (b[0] === currentState) return 1;
      }
      return a[0].localeCompare(b[0]);
    });
    return entries;
  }, [geojson, currentState]);

  const [expandedStates, setExpandedStates] = useState<Set<string>>(() => {
    return currentState ? new Set([currentState]) : new Set();
  });

  const toggleState = (abbr: string) => {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(abbr)) next.delete(abbr);
      else next.add(abbr);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 mt-3">
        <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium mb-2">
          DU Migration Reports
        </p>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-white/10 animate-pulse" />
          <span className="text-[11px] text-white/30">Loading reports...</span>
        </div>
      </div>
    );
  }

  if (grouped.length === 0) return null;

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 mt-3">
      <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium mb-2">
        DU Migration Reports
      </p>
      <div className="space-y-1">
        {grouped.map(([stateAbbr, reports]) => {
          const isOpen = expandedStates.has(stateAbbr);
          return (
            <div key={stateAbbr}>
              <button
                onClick={() => toggleState(stateAbbr)}
                className="w-full flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-white/80">
                    {stateAbbr}
                  </span>
                  <span className="text-[10px] text-white/40">
                    {reports.length} report{reports.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {isOpen ? (
                  <ChevronUp size={12} className="text-white/30" />
                ) : (
                  <ChevronDown size={12} className="text-white/30" />
                )}
              </button>
              {isOpen && (
                <div className="pl-2 pr-1 pb-1 space-y-1.5">
                  {reports.map((r, i) => {
                    const style = getActivityStyle(r.activity_level_id);
                    return (
                      <div
                        key={i}
                        className="rounded bg-white/[0.03] border border-white/[0.04] px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] text-white/60 truncate max-w-[140px]">
                            {r.location_name || "Unknown"}
                          </span>
                          <span
                            className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}
                          >
                            {style.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-white/40">
                          <span>{relativeDate(r.submit_date)}</span>
                          {r.weather && (
                            <>
                              <span className="text-white/20">|</span>
                              <span className="truncate max-w-[120px]">{r.weather}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

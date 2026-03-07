import type { Species } from "@/data/types";
import { getPrimarySeasonForState } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";

export interface PopupWeather {
  temp: number;
  wind: number;
}

const STATUS_COLORS: Record<string, string> = {
  open: "#10b981",
  soon: "#f59e0b",
  upcoming: "#3b82f6",
  closed: "#64748b",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Season Open",
  soon: "Opening Soon",
  upcoming: "Upcoming",
  closed: "Season Closed",
};

export function getPopupHTML(abbr: string, stateName: string, species: Species, weather?: PopupWeather | null, convergenceScore?: number | null): string {
  const season = getPrimarySeasonForState(species, abbr);
  const now = new Date();
  const status = season ? getSeasonStatus(season, now) : "closed";
  const color = STATUS_COLORS[status] || STATUS_COLORS.closed;
  const label = STATUS_LABELS[status] || "Closed";

  let dateInfo = "";
  if (season && season.dates.length > 0) {
    const nextDate = season.dates.find(d => new Date(d.close) >= now);
    if (nextDate) {
      const openDate = new Date(nextDate.open);
      const closeDate = new Date(nextDate.close);
      const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dateInfo = `<div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:4px">${fmt(openDate)} - ${fmt(closeDate)}</div>`;
    }
  }

  let weatherInfo = "";
  if (weather) {
    weatherInfo = `<div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:4px;display:flex;gap:8px">${Math.round(weather.temp)}&deg;F &middot; ${Math.round(weather.wind)} mph wind</div>`;
  }

  let convergenceInfo = "";
  if (convergenceScore != null) {
    const scoreColor = convergenceScore >= 81 ? '#ef4444' : convergenceScore >= 61 ? '#fb923c' : convergenceScore >= 41 ? '#facc15' : convergenceScore >= 21 ? '#3b82f6' : 'rgba(100,100,100,0.6)';
    convergenceInfo = `<div style="display:flex;align-items:center;gap:6px;margin-top:4px"><div style="width:8px;height:8px;border-radius:50%;background:${scoreColor};flex-shrink:0"></div><span style="font-size:12px;font-weight:600;color:${scoreColor}">${convergenceScore}/100</span><span style="font-size:10px;color:rgba(255,255,255,0.4)">hunt score</span></div>`;
  }

  return `
    <div style="font-family:Inter,sans-serif;padding:2px 0;min-width:120px">
      <div style="font-weight:600;font-size:13px;color:#fff;margin-bottom:4px">${stateName}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0"></div>
        <span style="font-size:11px;color:rgba(255,255,255,0.7)">${label}</span>
      </div>
      ${dateInfo}
      ${weatherInfo}
      ${convergenceInfo}
    </div>
  `;
}

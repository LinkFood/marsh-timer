import type { Species } from "@/data/types";
import { getPrimarySeasonForState } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";

export interface PopupWeather {
  temp: number;
  wind: number;
  windDir: number;
  pressure: number;
  precip: number;
}

export interface PopupConvergence {
  score: number;
  weather_component: number;
  migration_component: number;
  birdcast_component: number;
  solunar_component: number;
  pattern_component: number;
  reasoning?: string;
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

const SPECIES_LABELS: Record<string, string> = {
  duck: "Duck",
  goose: "Goose",
  deer: "Deer",
  turkey: "Turkey",
  dove: "Dove",
};

function getScoreTierColor(score: number): string {
  if (score >= 81) return "#ef4444";
  if (score >= 61) return "#fb923c";
  if (score >= 41) return "#facc15";
  if (score >= 21) return "#3b82f6";
  return "#64748b";
}

function getWindCardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function getPressureArrow(pressure: number): string {
  // Simple heuristic: low < 1010, high > 1020
  if (pressure < 1010) return "\u2193"; // down arrow
  if (pressure > 1020) return "\u2191"; // up arrow
  return "\u2194"; // neutral
}

function getMoonPhase(): { emoji: string; name: string } {
  // Known new moon: Jan 6 2000 18:14 UTC
  const knownNew = new Date("2000-01-06T18:14:00Z").getTime();
  const now = Date.now();
  const cycle = 29.53058867;
  const daysSince = (now - knownNew) / (1000 * 60 * 60 * 24);
  const phase = ((daysSince % cycle) + cycle) % cycle;
  const fraction = phase / cycle; // 0-1

  if (fraction < 0.0625) return { emoji: "\u{1F311}", name: "New Moon" };
  if (fraction < 0.1875) return { emoji: "\u{1F312}", name: "Waxing Crescent" };
  if (fraction < 0.3125) return { emoji: "\u{1F313}", name: "First Quarter" };
  if (fraction < 0.4375) return { emoji: "\u{1F314}", name: "Waxing Gibbous" };
  if (fraction < 0.5625) return { emoji: "\u{1F315}", name: "Full Moon" };
  if (fraction < 0.6875) return { emoji: "\u{1F316}", name: "Waning Gibbous" };
  if (fraction < 0.8125) return { emoji: "\u{1F317}", name: "Last Quarter" };
  if (fraction < 0.9375) return { emoji: "\u{1F318}", name: "Waning Crescent" };
  return { emoji: "\u{1F311}", name: "New Moon" };
}

const S = {
  card: `font-family:Inter,system-ui,sans-serif;min-width:220px;max-width:260px;background:rgba(10,15,30,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden`,
  section: `padding:8px 12px`,
  divider: `margin:0 12px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent)`,
  // Header
  headerRow: `display:flex;align-items:baseline;justify-content:space-between;gap:6px`,
  stateName: `font-weight:700;font-size:13px;color:#fff;letter-spacing:0.5px`,
  signalValue: (color: string) => `font-size:13px;font-weight:700;color:${color};letter-spacing:0.3px`,
  // Component breakdown
  compRow: `display:flex;flex-wrap:wrap;gap:4px 8px;font-size:10px;color:rgba(255,255,255,0.5);line-height:1.4`,
  compItem: (val: number, max: number) => {
    const pct = max > 0 ? val / max : 0;
    const color = pct >= 0.8 ? 'rgba(16,185,129,0.9)' : pct >= 0.5 ? 'rgba(250,204,21,0.9)' : 'rgba(255,255,255,0.5)';
    return `color:${color}`;
  },
  // Weather
  weatherRow: `display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(255,255,255,0.6);flex-wrap:wrap`,
  weatherValue: `font-weight:600;color:rgba(255,255,255,0.85)`,
  // Season
  seasonRow: `display:flex;align-items:center;gap:6px;font-size:10px`,
  statusDot: (color: string) => `width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0`,
  statusLabel: (color: string) => `color:${color};font-weight:600`,
  dateText: `color:rgba(255,255,255,0.35);font-size:10px`,
};

export function getPopupHTML(
  abbr: string,
  stateName: string,
  species: Species,
  weather?: PopupWeather | null,
  convergence?: PopupConvergence | null,
  convergenceRank?: number | null,
): string {
  const season = getPrimarySeasonForState(species, abbr);
  const now = new Date();
  const status = season ? getSeasonStatus(season, now) : "closed";
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.closed;
  const statusLabel = STATUS_LABELS[status] || "Closed";
  const speciesLabel = SPECIES_LABELS[species] || "Duck";

  // Season dates
  let dateStr = "";
  if (season && season.dates.length > 0) {
    const nextDate = season.dates.find(d => new Date(d.close) >= now);
    if (nextDate) {
      const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dateStr = `${fmt(new Date(nextDate.open))} - ${fmt(new Date(nextDate.close))}`;
    }
  }

  const moon = getMoonPhase();

  // --- Header: STATE NAME — Signal: XX/100 ---
  const score = convergence?.score ?? null;
  const tierColor = score != null ? getScoreTierColor(score) : "#64748b";
  const signalStr = score != null
    ? `<span style="${S.signalValue(tierColor)}">Signal: ${score}/100</span>`
    : `<span style="font-size:11px;color:rgba(255,255,255,0.3)">No signal</span>`;

  const headerSection = `
    <div style="${S.section}">
      <div style="${S.headerRow}">
        <span style="${S.stateName}">${stateName.toUpperCase()}</span>
        ${signalStr}
      </div>
    </div>
  `;

  // --- Component breakdown ---
  let compSection = "";
  if (convergence && score != null) {
    const wx = convergence.weather_component;
    const mig = convergence.migration_component;
    const bc = convergence.birdcast_component;
    const sol = convergence.solunar_component;
    const pat = convergence.pattern_component;

    compSection = `
      <div style="${S.divider}"></div>
      <div style="${S.section}">
        <div style="${S.compRow}">
          <span style="${S.compItem(wx, 25)}">Wx: ${wx}/25</span>
          <span style="color:rgba(255,255,255,0.15)">\u00B7</span>
          <span style="${S.compItem(mig, 25)}">Mig: ${mig}/25</span>
          <span style="color:rgba(255,255,255,0.15)">\u00B7</span>
          <span style="${S.compItem(bc, 20)}">BC: ${bc}/20</span>
        </div>
        <div style="${S.compRow};margin-top:2px">
          <span style="${S.compItem(sol, 15)}">Sol: ${sol}/15</span>
          <span style="color:rgba(255,255,255,0.15)">\u00B7</span>
          <span style="${S.compItem(pat, 15)}">Pat: ${pat}/15</span>
        </div>
      </div>
    `;
  }

  // --- Weather row ---
  let weatherSection = "";
  if (weather) {
    const cardinal = getWindCardinal(weather.windDir);
    const pressureArrow = getPressureArrow(weather.pressure);
    weatherSection = `
      <div style="${S.divider}"></div>
      <div style="${S.section}">
        <div style="${S.weatherRow}">
          <span style="${S.weatherValue}">${Math.round(weather.temp)}&deg;F</span>
          <span style="color:rgba(255,255,255,0.15)">\u00B7</span>
          <span>${cardinal} ${Math.round(weather.wind)}mph</span>
          <span style="color:rgba(255,255,255,0.15)">\u00B7</span>
          <span>${pressureArrow}${Math.round(weather.pressure)}mb</span>
          <span style="color:rgba(255,255,255,0.15)">\u00B7</span>
          <span>${moon.emoji}</span>
        </div>
      </div>
    `;
  } else {
    weatherSection = `
      <div style="${S.divider}"></div>
      <div style="${S.section}">
        <div style="font-size:11px;color:rgba(255,255,255,0.4)">${moon.emoji} ${moon.name}</div>
      </div>
    `;
  }

  // --- Season row ---
  const seasonSection = `
    <div style="${S.divider}"></div>
    <div style="${S.section}">
      <div style="${S.seasonRow}">
        <div style="${S.statusDot(statusColor)}"></div>
        <span style="${S.statusLabel(statusColor)}">${speciesLabel}: ${statusLabel}</span>
        ${dateStr ? `<span style="${S.dateText}">${dateStr}</span>` : ""}
      </div>
    </div>
  `;

  return `<div style="${S.card}">${headerSection}${compSection}${weatherSection}${seasonSection}</div>`;
}

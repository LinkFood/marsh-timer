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
  card: `font-family:Inter,system-ui,sans-serif;min-width:220px;background:rgba(10,15,30,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden`,
  section: `padding:10px 14px`,
  divider: `height:1px;background:rgba(255,255,255,0.06);margin:0`,
  headerRow: `display:flex;align-items:center;justify-content:space-between;gap:8px`,
  stateName: `font-weight:700;font-size:14px;color:#fff;letter-spacing:0.3px`,
  abbrBadge: `font-size:11px;color:rgba(255,255,255,0.4);font-weight:500`,
  statusDot: (color: string) => `width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0`,
  statusLabel: `font-size:11px;color:rgba(255,255,255,0.6)`,
  dateText: `color:rgba(255,255,255,0.4);font-size:10px;margin-top:2px`,
  // Score bar
  barOuter: `width:100%;height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden`,
  barFill: (pct: number, color: string) => `width:${pct}%;height:100%;border-radius:3px;background:${color};transition:width 0.3s`,
  scoreRow: `display:flex;align-items:center;justify-content:space-between;margin-bottom:6px`,
  scoreLabel: `font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.5px`,
  scoreValue: (color: string) => `font-size:16px;font-weight:700;color:${color}`,
  rankText: `font-size:10px;color:rgba(255,255,255,0.35);margin-top:4px`,
  // Weather
  weatherRow: `display:flex;align-items:center;gap:10px;font-size:12px;color:rgba(255,255,255,0.7)`,
  weatherSecondary: `display:flex;align-items:center;gap:10px;font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px`,
  weatherValue: `font-weight:600;color:#fff`,
  moonText: `font-size:11px;color:rgba(255,255,255,0.5)`,
};

export function getPopupHTML(
  abbr: string,
  stateName: string,
  species: Species,
  weather?: PopupWeather | null,
  convergenceScore?: number | null,
  convergenceRank?: number | null,
): string {
  const season = getPrimarySeasonForState(species, abbr);
  const now = new Date();
  const status = season ? getSeasonStatus(season, now) : "closed";
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.closed;
  const statusLabel = STATUS_LABELS[status] || "Closed";

  // Season dates
  let dateStr = "";
  if (season && season.dates.length > 0) {
    const nextDate = season.dates.find(d => new Date(d.close) >= now);
    if (nextDate) {
      const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dateStr = `${fmt(new Date(nextDate.open))} - ${fmt(new Date(nextDate.close))}`;
    }
  }

  // Moon phase
  const moon = getMoonPhase();

  // Build sections
  const headerSection = `
    <div style="${S.section}">
      <div style="${S.headerRow}">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="${S.stateName}">${stateName.toUpperCase()}</span>
          <span style="${S.abbrBadge}">${abbr}</span>
        </div>
        <div style="${S.statusDot(statusColor)}"></div>
      </div>
      <div style="margin-top:4px;display:flex;align-items:center;gap:6px">
        <span style="${S.statusLabel}">${statusLabel}</span>
      </div>
      ${dateStr ? `<div style="${S.dateText}">${dateStr}</div>` : ""}
    </div>
  `;

  let scoreSection = "";
  if (convergenceScore != null) {
    const tierColor = getScoreTierColor(convergenceScore);
    const rankStr = convergenceRank != null ? `<div style="${S.rankText}">#${convergenceRank} nationally</div>` : "";
    scoreSection = `
      <div style="${S.divider}"></div>
      <div style="${S.section}">
        <div style="${S.scoreRow}">
          <span style="${S.scoreLabel}">Hunt Score</span>
          <span style="${S.scoreValue(tierColor)}">${convergenceScore}/100</span>
        </div>
        <div style="${S.barOuter}">
          <div style="${S.barFill(convergenceScore, tierColor)}"></div>
        </div>
        ${rankStr}
      </div>
    `;
  }

  let weatherSection = "";
  if (weather) {
    const cardinal = getWindCardinal(weather.windDir);
    weatherSection = `
      <div style="${S.divider}"></div>
      <div style="${S.section}">
        <div style="${S.weatherRow}">
          <span><span style="${S.weatherValue}">${Math.round(weather.temp)}&deg;F</span></span>
          <span>${cardinal} ${Math.round(weather.wind)} mph</span>
          <span>${moon.emoji} ${moon.name}</span>
        </div>
        <div style="${S.weatherSecondary}">
          <span>${Math.round(weather.pressure)} mb</span>
          <span>${weather.precip.toFixed(1)}&Prime; precip</span>
        </div>
      </div>
    `;
  } else {
    // Still show moon even without weather
    weatherSection = `
      <div style="${S.divider}"></div>
      <div style="${S.section}">
        <div style="${S.moonText}">${moon.emoji} ${moon.name}</div>
      </div>
    `;
  }

  return `<div style="${S.card}">${headerSection}${scoreSection}${weatherSection}</div>`;
}

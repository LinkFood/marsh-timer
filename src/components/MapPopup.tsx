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
};

export function getPopupHTML(
  abbr: string,
  stateName: string,
  _species?: unknown,
  weather?: PopupWeather | null,
  convergence?: PopupConvergence | null,
  convergenceRank?: number | null,
): string {
  const moon = getMoonPhase();

  // --- Header: STATE NAME — Signal: XX/100 ---
  const score = convergence?.score ?? null;
  const tierColor = score != null ? getScoreTierColor(score) : "#64748b";
  const signalStr = score != null
    ? `<span style="${S.signalValue(tierColor)}">Signal: ${score}/100</span>`
    : `<span style="font-size:11px;color:rgba(255,255,255,0.3)">No signal</span>`;
  const rankStr = convergenceRank != null && convergenceRank > 0
    ? `<div style="font-size:9px;color:rgba(255,255,255,0.4);margin-top:2px">#${convergenceRank} of 50 states</div>`
    : '';

  // --- Top signal: highest scoring component ---
  let topSignalStr = '';
  if (convergence && score != null) {
    const components: [string, number][] = [
      ['Weather', convergence.weather_component],
      ['Migration', convergence.migration_component],
      ['BirdCast', convergence.birdcast_component],
      ['Solunar', convergence.solunar_component],
      ['Pattern', convergence.pattern_component],
    ];
    const top = components.reduce((a, b) => b[1] > a[1] ? b : a);
    if (top[1] > 0) {
      topSignalStr = `<div style="font-size:9px;color:rgba(255,255,255,0.45);margin-top:1px">Top signal: ${top[0]}</div>`;
    }
  }

  const headerSection = `
    <div style="${S.section}">
      <div style="${S.headerRow}">
        <span style="${S.stateName}">${stateName.toUpperCase()}</span>
        ${signalStr}
      </div>
      ${rankStr}
      ${topSignalStr}
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
        ${convergence?.reasoning ? `
          <div style="font-size:9px;color:rgba(255,255,255,0.35);margin-top:4px;line-height:1.3;max-height:36px;overflow:hidden;font-style:italic">
            ${convergence.reasoning.slice(0, 120)}${convergence.reasoning.length > 120 ? '...' : ''}
          </div>
        ` : ''}
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

  return `<div style="${S.card}">${headerSection}${compSection}${weatherSection}</div>`;
}

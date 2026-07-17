/**
 * humanize — turns raw ingestion titles into human headlines.
 *
 * The archive stores machine-speak ("Daily Weather AL 1950-07-02",
 * "M2.6 earthquake 37 km SSW of Ferndale, California"). Anything shown on a
 * card goes through here first. Shared by the this-day precedent cards and
 * the latest-from-the-layers feed.
 */

const TYPE_LABELS: Record<string, string> = {
  'ghcn-daily': 'Daily weather record',
  'nasa-daily': 'Satellite weather record',
  'storm-event': 'Storm event report',
  'earthquake-event': 'Seismic event',
  'drought-weekly': 'Drought conditions report',
  'drought-index': 'Drought index reading',
  'climate-index': 'Climate index reading',
  'climate-index-daily': 'Climate index reading',
  'astronomical': 'Astronomical event',
  'astronomical-event': 'Astronomical event',
  'space-weather': 'Space weather reading',
  'noaa-tide': 'Tide gauge reading',
  'tide-gauge': 'Tide gauge reading',
  'ocean-buoy': 'Ocean buoy reading',
  'river-discharge': 'River gauge reading',
  'usgs-water': 'Stream gauge reading',
  'soil-conditions': 'Soil conditions report',
  'snotel-daily': 'Snowpack record',
  'crop-progress': 'Crop progress report',
  'crop-progress-weekly': 'Crop progress report',
  'snow-cover-monthly': 'Snow cover record',
  'glerl-ice-cover': 'Great Lakes ice cover',
  'geomagnetic-kp': 'Geomagnetic reading',
  'air-quality': 'Air quality reading',
  'anomaly-alert': 'Statistical anomaly',
  'migration-spike-extreme': 'Extreme migration spike',
  'migration-spike-significant': 'Significant migration spike',
  'migration-spike-moderate': 'Migration spike',
  'nws-alert': 'NWS alert',
  'bio-absence-signal': 'Bird absence signal',
  'wildfire-perimeter': 'Wildfire perimeter',
};

function readableType(contentType: string): string {
  const t = contentType.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Caps words that are legitimate acronyms — never title-cased. */
const ACRONYMS = new Set(['NWS', 'NOAA', 'USGS', 'USA', 'KP', 'NASA', 'SNOTEL', 'SWE']);

/** Content types whose entries are routine daily weather bookkeeping. */
export function isRoutineWeather(contentType: string, title?: string | null): boolean {
  return contentType === 'ghcn-daily' || contentType === 'nasa-daily' || /^daily weather\b/i.test(title || '');
}

/**
 * Machine row keys must never reach a visitor's eye. The wildfire-perimeter
 * lane titles rows "fire-{IRWIN-UUID}-2026-07-17" / "fire-Nelson-MN-2025-10-06";
 * its content column holds the real sentence ("Wildfire Nelson in MN: 0 acres,
 * 0% contained, started 2025-10-06, cause: Human. fire"). Turn that sentence
 * into the museum headline: "Wildfire Nelson — 0 acres, 0% contained".
 */
const MACHINE_KEY_RE = /^fire-|[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;

function fireHeadline(content: string | null | undefined): string | null {
  const m = (content || '').match(/^Wildfire\s+(.+?)\s+in\s+[A-Z]{2}:\s*([\d,]+|unknown)\s*acres,\s*(\d+)%\s*contained/i);
  if (!m) return null;
  const acres = m[2].toLowerCase() === 'unknown'
    ? 'unknown acreage'
    : `${Number(m[2].replace(/,/g, '')).toLocaleString()} acres`;
  return `Wildfire ${m[1]} — ${acres}, ${m[3]}% contained`;
}

/** "6548" → "6,548" — every count on a museum card reads as a number, not a key. */
function num(s: string): string {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n.toLocaleString() : s;
}

/**
 * Lane sentence builders — the museum-quality pass (SITE-BLUEPRINT §Wave 3:
 * "lane titles as sentences everywhere"). Most lanes ingest with machine
 * titles ("AK river discharge 2026-07-10", "ocean-buoy 45004 2026-07-10")
 * while their content column holds real readings. Each builder parses the
 * content into one honest headline sentence; any parse miss returns null and
 * the generic title path below takes over. Never invents — only re-speaks
 * what the row already says.
 */
const LANE_SENTENCES: Record<string, (title: string, content: string) => string | null> = {
  'river-discharge': (_t, c) => {
    const m = c.match(/current\s+([\d.,]+)\s*m³\/s/i);
    if (!m) return null;
    const desc = c.match(/\)\.?\s*([a-z][a-z\s-]+?)\s*$/i);
    const label = desc && !/^(unknown|n\/a|none)$/i.test(desc[1].trim()) ? ` — ${desc[1].trim()}` : '';
    return `Rivers ran at ${m[1]} m³/s${label}`;
  },
  'ocean-buoy': (_t, c) => {
    const m = c.match(/Ocean buoy\s+(\S+)\s+\(([^)]+)\)/i);
    if (!m) return null;
    const p = c.match(/pressure\s+([\d.]+)\s*mb/i);
    const w = c.match(/wind\s+([\d.]+)\s*mph/i);
    const bits = [p && `${p[1]} mb`, w && `wind ${w[1]} mph`].filter(Boolean).join(', ');
    return `Buoy ${m[1]}, ${m[2]}${bits ? ` — ${bits}` : ''}`;
  },
  'tide-gauge': (_t, c) => {
    const m = c.match(/tide gauge at\s+(.+?)\s+\([A-Z]{2}\)\s+recorded a daily mean water level of\s+([\d.-]+)\s*ft.*?peaking at\s+([\d.-]+)\s*ft/i);
    return m ? `${m[1]} gauge — mean ${m[2]} ft, peak ${m[3]} ft` : null;
  },
  'soil-conditions': (_t, c) => {
    const m = c.match(/surface temp\s+([\d.-]+)°F/i);
    if (!m) return null;
    const f = c.match(/Freeze\/thaw:\s*(\w+)/i);
    return `Soil surface ${m[1]}°F${f ? `, ${f[1]}` : ''}`;
  },
  'snotel-daily': (_t, c) => {
    const swe = c.match(/SWE avg:([\d.]+)in/i);
    const st = c.match(/stations:(\d+)\s+with_snow:(\d+)/i);
    if (!swe || !st) return null;
    return Number(st[2]) === 0
      ? `Snowpack bare — 0 of ${st[1]} stations holding snow`
      : `Snowpack ${swe[1]}" water equivalent — ${st[2]} of ${st[1]} stations holding snow`;
  },
  'snow-cover-monthly': (_t, c) => {
    const lvl = c.match(/cover_level:([\w-]+)/i);
    const st = c.match(/stations:(\d+)\s*\|\s*with_snow:(\d+)/i);
    if (!lvl || !st) return null;
    const avg = c.match(/avg_depth:([\d.]+)in/i);
    return `Snow cover ${lvl[1]} — ${st[2]} of ${st[1]} stations${avg && Number(avg[1]) > 0 ? `, avg ${avg[1]}"` : ''}`;
  },
  'nasa-daily': (_t, c) => {
    const solar = c.match(/solar:([\d.]+)kWh/i);
    const cloud = c.match(/cloud:([\d.]+)%/i);
    const bits = [solar && `solar ${solar[1]} kWh/m²`, cloud && `cloud ${cloud[1]}%`].filter(Boolean).join(', ');
    return bits ? `Satellite read — ${bits}` : 'Satellite weather record';
  },
  'drought-weekly': (_t, c) => {
    const cls = c.match(/class:([\w-]+)/i);
    if (!cls) return null;
    const clear = c.match(/none:([\d.]+)%/i);
    if (/^(normal|none)$/i.test(cls[1]) && clear) return `No drought — ${Math.round(Number(clear[1]))}% of the state clear`;
    const impact = c.match(/impact:\s*([^|]+?)\s*$/i);
    return `Drought ${cls[1]}${impact ? ` — ${impact[1].split('—')[0].trim()}` : ''}`;
  },
  'crop-progress-weekly': (_t, c) => {
    const m = c.match(/\|\s*([a-z][\w ]*?)\s*\|\s*([a-z_]+):(\d+)%/i);
    if (!m) return null;
    const crop = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return `${crop} ${m[3]}% ${m[2].replace(/_/g, ' ')}`;
  },
  'migration-daily': (_t, c) => {
    const s = c.match(/sightings:(\d+)/i);
    if (!s) return null;
    const d = c.match(/deviation:(-?[\d.]+)%/i);
    const dev = d ? Number(d[1]) : null;
    const devLine = dev === null ? '' : dev >= 0 ? ` — ${Math.abs(Math.round(dev))}% above baseline` : ` — ${Math.abs(Math.round(dev))}% below baseline`;
    return `${num(s[1])} bird sightings${devLine}`;
  },
  'birdweather-acoustic': (t, c) => {
    const sp = t.match(/^birdweather\s+(.+?)(?:\s+\d{4}-\d{2}-\d{2})?$/i) || c.match(/birdweather-acoustic\s*\|\s*([^|]+?)\s*\|/i);
    const d = c.match(/detections:(\d+)/i);
    if (!sp || !d) return null;
    const act = c.match(/activity:(\w+)/i);
    return `${sp[1].trim()} — ${num(d[1])} acoustic detections${act ? ` (${act[1]})` : ''}`;
  },
  'inaturalist-daily': (_t, c) => {
    const m = c.match(/inaturalist-daily\s*\|\s*[A-Z]{2}\s*\|\s*([^|]+?)\s*\|.*?observations:(\d+)/i);
    if (!m) return null;
    const sp = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const act = c.match(/activity:(\w+)/i);
    return `${sp} — ${num(m[2])} observations${act ? ` (${act[1]} activity)` : ''}`;
  },
  'space-weather': (_t, c) => {
    const w = c.match(/solar wind\s+([\d.]+)\s*km\/s/i);
    const kp = c.match(/Kp index\s+([\d.]+)\s*\(([^)]+)\)/i);
    if (!w && !kp) return null;
    return ['Solar wind' + (w ? ` ${w[1]} km/s` : ''), kp ? `Kp ${kp[1]} (${kp[2]})` : '']
      .filter(Boolean).join(' — ');
  },
  'astronomical': (_t, c) => {
    const m = c.match(/moon was an?\s+([^,]+?)\s+at\s+([\d.]+)%\s+illumination/i);
    return m ? `${m[1]} moon — ${m[2]}% lit` : null;
  },
  'air-quality': (_t, c) => {
    const m = c.match(/AQI\s+(\d+)/i);
    if (!m) return null;
    const g = c.match(/\.\s*([a-z][^.]*?air quality)\.?\s*$/i);
    return `AQI ${m[1]}${g ? ` — ${g[1].toLowerCase()}` : ''}`;
  },
  'climate-index-daily': (_t, c) => {
    const m = c.match(/climate-index-daily\s*\|\s*(\w+)\s*\|.*?value:(-?[\d.]+)\s*\|\s*phase:(\w+)/i);
    return m ? `${m[1]} at ${m[2]} — ${m[3]} phase` : null;
  },
  'climate-index': (_t, c) => {
    const m = c.match(/climate-index\s*\|\s*(\w+)\s*\(([^)]+)\)\s*\|.*?phase:(\w+)\s*\|\s*([^|]+?)\s*$/i);
    return m ? `${m[2]} ${m[3]} — ${m[4].split('—')[0].trim()}` : null;
  },
  'weather-event': (_t, c) => {
    const m = c.match(/\|\s*type:[\w-]+\s*\|?\s*(.+?)\s*$/i);
    return m && m[1] && !/^type:/i.test(m[1]) ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : null;
  },
  'nws-alert': (t) => {
    const m = t.match(/^(.+?)\s*[-–—]\s*[A-Z]{2}$/);
    return m ? m[1].trim() : null;
  },
};

/**
 * One raw ingestion title → one human headline. Never returns machine suffixes.
 *
 * Examples:
 *   "Daily Weather AL 1950-07-02"                  → "Daily weather record"
 *   "MD air-quality"                               → "Air quality reading"
 *   "MD soil-conditions"                           → "Soil conditions report"
 *   "TX river-discharge"                           → "River discharge reading"
 *   "Thunderstorm Wind 60 MONTGOMERY"              → "Thunderstorm wind 60 — Montgomery"
 *   "M2.6 earthquake 37 km SSW of Ferndale, California" → "M2.6 earthquake near Ferndale, California"
 *   "fire-{C12BFCD9-…}-2026-07-17" + content       → "Wildfire Cedar Creek — 14,102 acres, 3% contained"
 *
 * `content` is optional: when the title is a machine row key, the human
 * sentence is rebuilt from the content column instead — never the raw key.
 */
export function humanizeEntry(title: string | null | undefined, contentType: string, content?: string | null): string {
  let t = (title || '').trim();

  // Lane sentence builders first — the content column speaks when it can.
  const build = LANE_SENTENCES[contentType];
  if (build) {
    const sentence = build(t, content || '');
    if (sentence) return sentence.length > 90 ? sentence.slice(0, 87).trimEnd() + '…' : sentence;
  }

  // Machine row keys (UUIDs, fire-… identity strings): honest fallbacks only.
  if (MACHINE_KEY_RE.test(t)) {
    const fire = fireHeadline(content);
    if (fire) return fire;
    const firstSentence = (content || '').split(/(?<=\.)\s/)[0]?.trim();
    if (firstSentence && !MACHINE_KEY_RE.test(firstSentence)) {
      return firstSentence.length > 90 ? firstSentence.slice(0, 87).trimEnd() + '…' : firstSentence;
    }
    return TYPE_LABELS[contentType] ?? readableType(contentType);
  }

  // Strip trailing machine suffixes: "… AL 1950-07-02", "… 1950-07-02", "… AK 202102"
  t = t.replace(/[\s—–:-]*(?:\b[A-Z]{2}\s+)?\d{4}(?:-\d{2}-\d{2}|\d{2})\s*$/, '').trim();
  t = t.replace(/[\s—–:-]+$/, '').trim();

  if (!t) return TYPE_LABELS[contentType] ?? readableType(contentType);
  if (/^daily weather\b/i.test(t)) return 'Daily weather record';

  // Bare "<STATE> <content-type>" ("MD air-quality", "AK river discharge") —
  // the state shows as a tag elsewhere, so the title collapses to the lane label.
  const bare = t.match(/^[A-Z]{2}\s+([a-z][a-z0-9 -]*)$/);
  if (bare) {
    const key = bare[1].trim().replace(/\s+/g, '-');
    if (key === contentType || TYPE_LABELS[key]) return TYPE_LABELS[key] ?? TYPE_LABELS[contentType] ?? readableType(contentType);
  }

  // "M2.6 earthquake 37 km SSW of Ferndale" → "M2.6 earthquake near Ferndale"
  t = t.replace(/\b\d+(?:\.\d+)?\s*km\s+[NSEW]{1,3}\s+of\s+/i, 'near ');

  // De-shout ALL-CAPS ingestion titles → title case (small words stay lowercase)
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length > 8 && letters === letters.toUpperCase()) {
    const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'near']);
    t = t
      .toLowerCase()
      .replace(/[a-z]+/g, w => (SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .replace(/^([a-z])/, c => c.toUpperCase());
  }

  // Trailing ALL-CAPS place name ("Thunderstorm Wind 60 MONTGOMERY") →
  // sentence-case the event, em-dash the place ("Thunderstorm wind 60 — Montgomery").
  // 2-letter caps (state abbrs) and known acronyms are left alone.
  const tail = t.match(/\s+((?:[A-Z]{3,}\s*)+)$/);
  if (tail && !tail[1].trim().split(/\s+/).some(w => ACRONYMS.has(w))) {
    const place = tail[1].trim().split(/\s+/).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    const head = (t.slice(0, tail.index).trim())
      .replace(/\b[A-Z][a-z]+\b/g, (w, i: number) => (i === 0 ? w : w.toLowerCase()))
      .replace(/[\s—–:-]+$/, ''); // a title already ending in a dash never doubles it
    t = `${head} — ${place}`;
  }
  // Any remaining shouted words mid-title get title-cased in place
  t = t.replace(/\b[A-Z]{3,}\b/g, w => (ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
  // Acronyms the de-shout lowercased get their caps back ("Nasa Power" → "NASA Power")
  t = t.replace(/\b[A-Za-z]{2,6}\b/g, w => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w));

  if (t.length > 90) t = t.slice(0, 87).trimEnd() + '…';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface YearLine {
  text: string;
  stateTag: string | null;
}

interface RawEntry {
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
}

/**
 * Build the 1-2 humanized lines for one year's precedent card.
 * Prefers non-weather entries; a weather-only year gets the quiet-day phrasing.
 */
export function yearLines(entries: RawEntry[]): YearLine[] {
  if (entries.length === 0) return [];

  if (entries.every(e => isRoutineWeather(e.content_type, e.title))) {
    return [{ text: 'A quiet day — routine weather records.', stateTag: entries[0].state_abbr }];
  }

  const ranked = [...entries].sort(
    (a, b) => Number(isRoutineWeather(a.content_type, a.title)) - Number(isRoutineWeather(b.content_type, b.title)),
  );

  const lines: YearLine[] = [];
  const seen = new Set<string>();
  for (const e of ranked) {
    const text = humanizeEntry(e.title || e.content, e.content_type, e.content);
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push({ text, stateTag: e.state_abbr });
    if (lines.length === 2) break;
  }
  return lines;
}

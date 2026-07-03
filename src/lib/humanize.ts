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
const ACRONYMS = new Set(['NWS', 'NOAA', 'USGS', 'USA', 'KP']);

/** Content types whose entries are routine daily weather bookkeeping. */
export function isRoutineWeather(contentType: string, title?: string | null): boolean {
  return contentType === 'ghcn-daily' || contentType === 'nasa-daily' || /^daily weather\b/i.test(title || '');
}

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
 */
export function humanizeEntry(title: string | null | undefined, contentType: string): string {
  let t = (title || '').trim();

  // Strip trailing machine suffixes: "… AL 1950-07-02", "… 1950-07-02"
  t = t.replace(/[\s—–:-]*(?:\b[A-Z]{2}\s+)?\d{4}-\d{2}-\d{2}\s*$/, '').trim();
  t = t.replace(/[\s—–:-]+$/, '').trim();

  if (!t) return TYPE_LABELS[contentType] ?? readableType(contentType);
  if (/^daily weather\b/i.test(t)) return 'Daily weather record';

  // Bare "<STATE> <content-type>" ("MD air-quality") — state shows as a tag elsewhere
  const bare = t.match(/^[A-Z]{2}\s+([a-z][a-z0-9-]*)$/);
  if (bare) return TYPE_LABELS[bare[1]] ?? `${readableType(bare[1])} reading`;

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
      .replace(/\b[A-Z][a-z]+\b/g, (w, i: number) => (i === 0 ? w : w.toLowerCase()));
    t = `${head} — ${place}`;
  }
  // Any remaining shouted words mid-title get title-cased in place
  t = t.replace(/\b[A-Z]{3,}\b/g, w => (ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));

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
    const text = humanizeEntry(e.title || e.content, e.content_type);
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push({ text, stateTag: e.state_abbr });
    if (lines.length === 2) break;
  }
  return lines;
}

/** Category metadata for the latest-from-the-layers feed. */
export function layerMeta(contentType: string): { label: string; color: string } {
  if (contentType === 'anomaly-alert') return { label: 'anomaly', color: '#fbbf24' };
  if (contentType.startsWith('migration-spike')) return { label: 'migration', color: '#2dd4bf' };
  if (contentType === 'nws-alert' || contentType === 'storm-event') return { label: 'weather', color: '#f87171' };
  if (contentType === 'bio-absence-signal') return { label: 'absence', color: '#a78bfa' };
  if (contentType === 'wildfire-perimeter') return { label: 'wildfire', color: '#fb923c' };
  return { label: contentType.replace(/-/g, ' '), color: '#64748b' };
}

import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Today's solunar row — direct PostgREST read of hunt_solunar_calendar.
 *
 * hunt-today-briefing still reads the stale hunt_solunar_cache (last row
 * 2026-04-10); the precompute cron writes hunt_solunar_calendar. One tiny
 * bounded fetch (single row keyed by local date) is cheaper than reworking
 * the briefing payload.
 */

export interface SolunarRow {
  date: string;
  moon_phase: string;
  illumination_pct: number;
  moon_age_days: number;
  major_start_1: string | null;
  major_end_1: string | null;
  major_start_2: string | null;
  major_end_2: string | null;
  minor_start_1: string | null;
  minor_end_1: string | null;
  is_prime: boolean;
  prime_reason: string | null;
}

const PHASE_GLYPH: Record<string, string> = {
  new_moon: '\u{1F311}',
  waxing_crescent: '\u{1F312}',
  first_quarter: '\u{1F313}',
  waxing_gibbous: '\u{1F314}',
  full_moon: '\u{1F315}',
  waning_gibbous: '\u{1F316}',
  last_quarter: '\u{1F317}',
  waning_crescent: '\u{1F318}',
};

/** "17:04:00" → { h, m } (local-ish wall-clock, no timezone math). */
function parseHM(t: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

/** "17:04:00" → "5:04 PM" */
function fmtTime(t: string): string {
  const hm = parseHM(t);
  if (!hm) return t;
  const h12 = ((hm.h + 11) % 12) + 1;
  return `${h12}:${String(hm.m).padStart(2, '0')} ${hm.h < 12 ? 'AM' : 'PM'}`;
}

/** "17:04:00".."19:04:00" → "5:04–7:04 PM" (meridiem shown once when shared). */
function fmtWindow(start: string, end: string): string {
  const s = fmtTime(start);
  const e = fmtTime(end);
  const sMer = s.slice(-2);
  return sMer === e.slice(-2) ? `${s.slice(0, -3)}–${e}` : `${s}–${e}`;
}

/**
 * One elegant line, moon-first: glyph + phase + illumination, then the feed
 * window — prime phrasing when is_prime, otherwise the next major window.
 */
export function formatSolunarLine(row: SolunarRow, now: Date = new Date()): string {
  const glyph = PHASE_GLYPH[row.moon_phase] ?? '\u{1F315}';
  const phase = row.moon_phase.replace(/_/g, ' ');
  const phaseCap = phase.charAt(0).toUpperCase() + phase.slice(1);
  const head = `${glyph} ${phaseCap}, ${Math.round(row.illumination_pct)}% lit`;

  const windows: Array<[string, string]> = [];
  if (row.major_start_1 && row.major_end_1) windows.push([row.major_start_1, row.major_end_1]);
  if (row.major_start_2 && row.major_end_2) windows.push([row.major_start_2, row.major_end_2]);
  if (windows.length === 0) return `${head}.`;
  windows.sort((a, b) => ((parseHM(a[0])?.h ?? 0) * 60 + (parseHM(a[0])?.m ?? 0)) - ((parseHM(b[0])?.h ?? 0) * 60 + (parseHM(b[0])?.m ?? 0)));

  if (row.is_prime) {
    // prime_reason names the time of day ("...aligns with dusk"); pick the
    // matching major window — dusk → afternoon window, dawn → morning window.
    const reason = (row.prime_reason ?? '').toLowerCase();
    const timeWord = reason.includes('dusk') ? 'dusk' : reason.includes('dawn') ? 'dawn' : null;
    let win = windows[0];
    if (timeWord) {
      const afternoon = windows.find(w => (parseHM(w[0])?.h ?? 0) >= 12);
      const morning = windows.find(w => (parseHM(w[0])?.h ?? 0) < 12);
      win = (timeWord === 'dusk' ? afternoon : morning) ?? windows[0];
    }
    const at = timeWord ? ` at ${timeWord}` : '';
    return `${head} — prime feed window${at} (${fmtWindow(win[0], win[1])})`;
  }

  // Not prime: phase + illumination + next major window (first one still ahead
  // of local wall-clock; if both have passed, show the last one plainly).
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const upcoming = windows.find(w => {
    const end = parseHM(w[1]);
    return end != null && end.h * 60 + end.m > nowMin;
  });
  const win = upcoming ?? windows[windows.length - 1];
  const label = upcoming ? 'next major feed window' : 'major feed window';
  return `${head} — ${label} ${fmtWindow(win[0], win[1])}`;
}

export function useSolunarToday() {
  const [row, setRow] = useState<SolunarRow | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    if (!SUPABASE_URL || !SUPABASE_KEY) return;

    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    fetch(`${SUPABASE_URL}/rest/v1/hunt_solunar_calendar?date=eq.${today}&limit=1`, {
      headers: { apikey: SUPABASE_KEY },
    })
      .then(async res => {
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) setRow(data[0] as SolunarRow);
      })
      .catch(() => {
        /* degrade silently — the line just doesn't render */
      });
  }, []);

  return row;
}

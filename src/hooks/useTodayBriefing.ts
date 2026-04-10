import { useState, useEffect, useCallback, useRef } from 'react';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

// --- Types ---

export interface CurrentWeather {
  temperature_f: number | null;
  temp_high_f: number | null;
  temp_low_f: number | null;
  conditions: string;
  wind_mph: number | null;
  wind_direction: string;
  pressure_mb: number | null;
  humidity_pct: number | null;
  dewpoint_f: number | null;
  visibility_mi: number | null;
  cloud_cover_pct: number | null;
  precipitation_mm: number | null;
}

export interface SolunarData {
  moon_phase: string;
  moon_illumination: number;
  next_major: string;
  next_minor: string;
  rating: string;
}

export interface ConvergenceComponent {
  domain: string;
  score: number;
  max_score: number;
  label: string;
}

export interface ConvergenceData {
  total_score: number;
  components: ConvergenceComponent[];
}

export interface ThisDayEntry {
  year: number;
  content_type: string;
  summary: string;
  state_abbr: string | null;
  metadata?: Record<string, unknown>;
}

export interface ClaimGrade {
  id: string;
  claim_text: string;
  status: 'watching' | 'confirmed' | 'partially_confirmed' | 'missed' | 'false_alarm';
  deadline: string | null;
  grade_reason: string | null;
  accuracy_pct: number | null;
  created_at: string;
}

export interface Anomaly {
  id: string;
  description: string;
  domains: string[];
  severity: number;
  detected_at: string;
}

export interface BrainStats {
  total_entries: number;
  content_types: number;
  entries_today: number;
}

export interface TodayBriefingData {
  current_weather: CurrentWeather | null;
  solunar: SolunarData | null;
  convergence: ConvergenceData | null;
  this_day_history: ThisDayEntry[];
  claims_grades: ClaimGrade[];
  anomalies: Anomaly[];
  brain_stats: BrainStats | null;
}

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useTodayBriefing(stateAbbr: string) {
  const [data, setData] = useState<TodayBriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBriefing = useCallback(async (abbr: string) => {
    if (!abbr || !SUPABASE_FUNCTIONS_URL) {
      setLoading(false);
      return;
    }

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `${SUPABASE_FUNCTIONS_URL}/hunt-today-briefing?state=${abbr}`,
        {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
          },
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        throw new Error(`${res.status}`);
      }

      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load briefing');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + refetch on state change
  useEffect(() => {
    if (!stateAbbr) return;
    fetchBriefing(stateAbbr);

    const interval = setInterval(() => fetchBriefing(stateAbbr), REFRESH_INTERVAL);
    return () => {
      clearInterval(interval);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [stateAbbr, fetchBriefing]);

  return { data, loading, error, refetch: () => fetchBriefing(stateAbbr) };
}

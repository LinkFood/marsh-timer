import { useState, useEffect, useRef } from "react";

export interface ScoutReport {
  brief_text: string;
  created_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REFRESH_MS = 60 * 60 * 1000;

export function useScoutReport() {
  const [report, setReport] = useState<ScoutReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function fetchReport() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_intel_briefs?order=created_at.desc&limit=1&select=brief_text,created_at`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        clearTimeout(timeout);
        if (!res.ok) return;
        const data: any[] = await res.json();

        if (data.length > 0) {
          setReport({
            brief_text: data[0].brief_text,
            created_at: data[0].created_at,
          });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('Request timed out: scout report');
        }
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
    const interval = setInterval(() => {
      fetchReport();
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  return { report, loading, error };
}

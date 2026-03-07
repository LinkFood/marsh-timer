import { useQuery } from '@tanstack/react-query';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

interface SolunarData {
  solunar: Record<string, unknown>;
  sunrise: Record<string, unknown>;
  date: string;
}

export function useSolunar(lat: number | null, lng: number | null, date?: string) {
  const today = date || new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: ['solunar', lat, lng, today],
    queryFn: async (): Promise<SolunarData | null> => {
      if (!lat || !lng || !SUPABASE_FUNCTIONS_URL) return null;

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-solunar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, date: today }),
      });

      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!lat && !!lng,
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

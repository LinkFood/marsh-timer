import { useState, useEffect } from 'react';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

interface RecallEntry {
  id: string;
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  effective_date: string;
}

interface RecallYear {
  year: number;
  entries: RecallEntry[];
}

export function useRecall(stateAbbr: string | null, species: string) {
  const [data, setData] = useState<RecallYear[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRecall() {
      try {
        const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-recall`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
          },
          body: JSON.stringify({ state_abbr: stateAbbr, species }),
        });
        if (res.ok) {
          const result = await res.json();
          setData(result.recalls || []);
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    fetchRecall();
  }, [stateAbbr, species]);

  return { data, loading };
}

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface PulseEntry {
  content_type: string;
  state_abbr: string | null;
  created_at: string;
  title: string;
}

const DOMAIN_COLORS: Record<string, string> = {
  'weather': 'bg-orange-400',
  'storm': 'bg-red-400',
  'migration': 'bg-cyan-400',
  'birdcast': 'bg-cyan-300',
  'drought': 'bg-amber-400',
  'climate': 'bg-purple-400',
  'earthquake': 'bg-rose-400',
  'water': 'bg-blue-400',
  'river': 'bg-blue-300',
  'ocean': 'bg-teal-400',
  'tide': 'bg-teal-300',
  'soil': 'bg-amber-300',
  'air': 'bg-emerald-300',
  'fire': 'bg-red-500',
  'anomaly': 'bg-pink-400',
  'correlation': 'bg-violet-400',
  'synthesis': 'bg-indigo-400',
  'convergence': 'bg-yellow-400',
  'power': 'bg-amber-500',
  'space': 'bg-violet-300',
  'moon': 'bg-yellow-200',
  'photo': 'bg-yellow-300',
  'ghcn': 'bg-orange-300',
  'astronomical': 'bg-violet-200',
};

export function getDomainColor(contentType: string): string {
  for (const [key, color] of Object.entries(DOMAIN_COLORS)) {
    if (contentType.includes(key)) return color;
  }
  return 'bg-white/30';
}

export function useBrainPulse() {
  const [entries, setEntries] = useState<PulseEntry[]>([]);

  useEffect(() => {
    if (!supabase) return;

    const fetchRecent = () => {
      supabase
        .from('hunt_knowledge')
        .select('content_type,state_abbr,created_at,title')
        .order('created_at', { ascending: false })
        .limit(10)
        .then(({ data }) => {
          if (data) {
            setEntries(data.map(d => ({
              content_type: d.content_type || '',
              state_abbr: d.state_abbr || null,
              created_at: d.created_at || '',
              title: d.title || '',
            })));
          }
        })
        .catch(() => {});
    };

    fetchRecent();
    const interval = setInterval(fetchRecent, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, []);

  return entries;
}

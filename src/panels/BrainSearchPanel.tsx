import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Loader2, Database } from 'lucide-react';
import { useDeck } from '@/contexts/DeckContext';
import type { PanelComponentProps } from './PanelTypes';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface BrainResult {
  title: string;
  content: string;
  content_type: string;
  species: string | null;
  state_abbr: string | null;
  effective_date: string | null;
  similarity: number;
}

export default function BrainSearchPanel({}: PanelComponentProps) {
  const { species } = useDeck();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BrainResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [brainCount, setBrainCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, {
      headers: { apikey: SUPABASE_KEY },
    })
      .then(r => r.json())
      .then(data => { if (data.stats?.total_entries) setBrainCount(data.stats.total_entries); })
      .catch(() => {});
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !SUPABASE_URL) return;
    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          query: query.trim(),
          species: species === 'all' ? null : species,
          limit: 15,
        }),
      });

      if (!res.ok) {
        setResults([]);
        return;
      }

      const data = await res.json();
      const entries = Array.isArray(data.vector) ? data.vector : Array.isArray(data.results) ? data.results : [];
      setResults(entries.map((r: any) => ({
        title: r.title || '',
        content: r.content || '',
        content_type: r.content_type || '',
        species: r.species || null,
        state_abbr: r.state_abbr || null,
        effective_date: r.effective_date || null,
        similarity: r.similarity || 0,
      })));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, species]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  function typeColor(ct: string): string {
    if (ct.includes('weather')) return 'text-orange-400 bg-orange-400/10';
    if (ct.includes('migration') || ct.includes('ebird') || ct.includes('birdcast')) return 'text-cyan-400 bg-cyan-400/10';
    if (ct.includes('convergence')) return 'text-red-400 bg-red-400/10';
    if (ct.includes('solunar') || ct.includes('photo')) return 'text-yellow-400 bg-yellow-400/10';
    if (ct.includes('drought') || ct.includes('water') || ct.includes('tide')) return 'text-blue-400 bg-blue-400/10';
    if (ct.includes('movebank') || ct.includes('inat')) return 'text-emerald-400 bg-emerald-400/10';
    return 'text-white/50 bg-white/[0.06]';
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-2 border-b border-white/[0.06]">
        <Database size={12} className="text-cyan-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search the brain..."
          className="flex-1 bg-transparent text-xs font-body text-white/80 placeholder:text-white/20 outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="p-1 rounded hover:bg-white/[0.06] transition-colors disabled:opacity-30"
        >
          {loading ? (
            <Loader2 size={12} className="text-cyan-400 animate-spin" />
          ) : (
            <Search size={12} className="text-white/50" />
          )}
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!searched && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20">
            <Database size={24} />
            <span className="text-[10px]">{brainCount ? brainCount.toLocaleString() : '1M+'} entries in the brain</span>
            <span className="text-[9px]">Search by topic, species, state, weather pattern...</span>
          </div>
        )}

        {searched && !loading && results.length === 0 && (
          <div className="flex items-center justify-center h-full text-white/40 text-xs">
            No results for "{query}"
          </div>
        )}

        {results.map((r, i) => (
          <div
            key={i}
            className="px-2.5 py-2 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${typeColor(r.content_type)}`}>
                {r.content_type}
              </span>
              {r.state_abbr && (
                <span className="text-[9px] font-mono text-white/40">{r.state_abbr}</span>
              )}
              {r.effective_date && (
                <span className="text-[9px] font-mono text-white/20">{r.effective_date}</span>
              )}
              <span className="text-[8px] font-mono text-cyan-400/40 ml-auto">
                {(r.similarity * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-[10px] text-white/60 leading-relaxed line-clamp-3">
              {r.content.slice(0, 200)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

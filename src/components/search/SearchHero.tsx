import { useState, useEffect, useRef } from 'react';
import { Search, MessageSquare, Brain } from 'lucide-react';
import WhatDropdown from './WhatDropdown';
import WhereDropdown from './WhereDropdown';
import WhenDropdown from './WhenDropdown';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface SearchHeroProps {
  onSearch: (params: {
    query?: string;
    contentTypeGroup: string | null;
    stateAbbr: string | null;
    dateFrom: string | null;
    dateTo: string | null;
  }) => void;
  onChatOpen: () => void;
  loading: boolean;
  brainCount: number | null;
}

function useAnimatedCount(target: number | null, duration = 1500): number {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (target === null || target === 0) return;
    const start = performance.now();
    const from = 0;

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.floor(from + (target - from) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, duration]);

  return display;
}

export default function SearchHero({ onSearch, onChatOpen, loading, brainCount }: SearchHeroProps) {
  const [contentTypeGroup, setContentTypeGroup] = useState<string | null>(null);
  const [stateAbbr, setStateAbbr] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [chatInput, setChatInput] = useState('');

  // Fetch brain count from suggested-prompts if not provided
  const [localCount, setLocalCount] = useState<number | null>(brainCount);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (brainCount !== null) {
      setLocalCount(brainCount);
      return;
    }
    if (fetchedRef.current || !SUPABASE_URL || !SUPABASE_KEY) return;
    fetchedRef.current = true;

    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, {
      headers: { apikey: SUPABASE_KEY },
    })
      .then(r => r.json())
      .then(data => {
        if (data?.stats?.total_entries) setLocalCount(data.stats.total_entries);
      })
      .catch(() => {});
  }, [brainCount]);

  const animatedCount = useAnimatedCount(localCount);

  function handleSearch() {
    onSearch({
      contentTypeGroup,
      stateAbbr,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    });
  }

  function handleChatSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSearch({
      query: chatInput.trim(),
      contentTypeGroup,
      stateAbbr,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    });
    setChatInput('');
  }

  return (
    <div className="bg-[#0a0f1a] py-12 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto text-center">
        {/* Headline */}
        <h1 className="font-display text-2xl sm:text-3xl text-white/90 mb-8 leading-tight">
          What happened the last time conditions looked like this?
        </h1>

        {/* Dropdowns row */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <WhatDropdown value={contentTypeGroup} onChange={setContentTypeGroup} />
          <WhereDropdown value={stateAbbr} onChange={setStateAbbr} />
          <WhenDropdown value={dateRange} onChange={setDateRange} />
        </div>

        {/* Search button */}
        <button
          onClick={handleSearch}
          disabled={loading}
          className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 mx-auto mb-6"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-white" />
          )}
          <span className="font-body text-sm font-medium text-white">Search the Brain</span>
        </button>

        {/* Brain counter */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <Brain className="w-4 h-4 text-cyan-400/60" />
          <span className="font-mono text-xs text-white/40">
            {animatedCount > 0
              ? `${animatedCount.toLocaleString()}+ records across 83 domains`
              : 'Loading brain...'}
          </span>
        </div>

        {/* Chat input */}
        <form onSubmit={handleChatSubmit} className="max-w-xl mx-auto">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0d1117] border border-white/10 hover:border-white/20 focus-within:border-cyan-400/30 transition-colors">
            <MessageSquare className="w-4 h-4 shrink-0 text-white/30" />
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="or ask the brain directly..."
              className="flex-1 bg-transparent text-sm font-body text-white/90 placeholder:text-white/30 outline-none"
            />
            <button
              type="button"
              onClick={onChatOpen}
              className="text-xs font-mono text-cyan-400/60 hover:text-cyan-400 transition-colors whitespace-nowrap"
            >
              Open Chat
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

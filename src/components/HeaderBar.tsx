import { useState, useMemo, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import type { Species } from "@/data/types";
import { speciesConfig, SPECIES_ORDER } from "@/data/speciesConfig";
import { getSeasonsForSpecies } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";
import UserMenu from './UserMenu';

interface HeaderBarProps {
  species: Species;
  onSelectSpecies: (s: Species) => void;
  onSearch: (abbr: string) => void;
}

const HeaderBar = ({ species, onSelectSpecies, onSearch }: HeaderBarProps) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const now = new Date();
    const result: Record<Species, number> = { duck: 0, goose: 0, deer: 0, turkey: 0, dove: 0 };
    for (const sp of SPECIES_ORDER) {
      const seasons = getSeasonsForSpecies(sp);
      const seen = new Set<string>();
      for (const s of seasons) {
        if (!seen.has(s.abbreviation) && getSeasonStatus(s, now) === "open") {
          seen.add(s.abbreviation);
          result[sp]++;
        }
      }
    }
    return result;
  }, []);

  const stateList = useMemo(() => {
    const all = getSeasonsForSpecies(species);
    const seen = new Set<string>();
    return all.filter(s => {
      if (seen.has(s.abbreviation)) return false;
      seen.add(s.abbreviation);
      return true;
    });
  }, [species]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return stateList
      .filter(s => s.state.toLowerCase().includes(q) || s.abbreviation.toLowerCase() === q)
      .slice(0, 6);
  }, [query, stateList]);

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setQuery("");
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    if (searchOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [searchOpen]);

  return (
    <header className="fixed top-0 left-0 right-0 z-30 h-12 glass-panel border-b border-white/[0.06]">
      <div className="h-full max-w-7xl mx-auto px-3 flex items-center justify-between gap-2">
        {/* Left: Brand */}
        <div className="flex items-center shrink-0">
          <span className="font-display text-sm font-bold tracking-widest text-white/90 hidden sm:inline">
            DUCK COUNTDOWN
          </span>
          <span className="font-display text-sm font-bold tracking-widest text-white/90 sm:hidden">
            DC
          </span>
        </div>

        {/* Center: Species pills */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          {SPECIES_ORDER.map(sp => {
            const config = speciesConfig[sp];
            const isActive = sp === species;
            const count = counts[sp];
            return (
              <button
                key={sp}
                onClick={() => onSelectSpecies(sp)}
                className={`px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition-all ${
                  isActive
                    ? "text-cyan-400 border-b-2 border-cyan-400"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {config.label}
                {count > 0 && (
                  <span className="ml-1.5 text-[9px] font-bold text-emerald-400">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: User + Search */}
        <div className="flex items-center gap-1.5 shrink-0">
          <UserMenu />
          <div ref={searchContainerRef} className="relative">
          {!searchOpen ? (
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Search states"
            >
              <Search className="w-4 h-4" />
            </button>
          ) : (
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center">
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search state..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-48 sm:w-64 pl-3 pr-8 py-1.5 rounded-full bg-white/5 border border-white/10 text-foreground placeholder:text-muted-foreground font-body text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                />
                <button
                  onClick={() => { setSearchOpen(false); setQuery(""); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {results.length > 0 && (
                <div className="absolute top-full right-0 mt-2 w-48 sm:w-64 glass-panel rounded-lg shadow-xl overflow-hidden z-50">
                  {results.map(s => (
                    <button
                      key={s.abbreviation}
                      onMouseDown={() => {
                        onSearch(s.abbreviation);
                        setSearchOpen(false);
                        setQuery("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-secondary transition-colors text-xs font-body text-foreground flex justify-between items-center"
                    >
                      <span>{s.state}</span>
                      <span className="text-muted-foreground text-[10px]">{s.abbreviation}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default HeaderBar;

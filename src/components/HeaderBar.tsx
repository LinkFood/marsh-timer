import { useState, useMemo, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import type { Species } from "@/data/types";
import { speciesConfig, SPECIES_ORDER } from "@/data/speciesConfig";
import { getSeasonsForSpecies } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";

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
    <header className="fixed top-0 left-0 right-0 z-30 h-12 map-overlay-panel border-b border-border/50">
      <div className="h-full max-w-7xl mx-auto px-3 flex items-center justify-between gap-2">
        {/* Left: Brand */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-base">🦆</span>
          <span className="font-display text-sm font-bold tracking-wide text-foreground hidden sm:inline">
            DUCK COUNTDOWN
          </span>
          <span className="font-display text-sm font-bold tracking-wide text-foreground sm:hidden">
            DCD
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
                className={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-full text-xs font-body font-semibold transition-all ${
                  isActive
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="text-xs sm:text-sm">{config.emoji}</span>
                <span className="hidden sm:inline text-xs">{config.label}</span>
                {count > 0 && (
                  <span
                    className="text-[9px] font-bold px-1 py-px rounded-full"
                    style={{ background: `${config.colors.open}20`, color: config.colors.open }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Search */}
        <div ref={searchContainerRef} className="relative shrink-0">
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
                  className="w-48 sm:w-64 pl-3 pr-8 py-1.5 rounded-full bg-secondary border border-border text-foreground placeholder:text-muted-foreground font-body text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  onClick={() => { setSearchOpen(false); setQuery(""); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {results.length > 0 && (
                <div className="absolute top-full right-0 mt-2 w-48 sm:w-64 bg-card border border-border rounded-lg shadow-xl overflow-hidden z-50">
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
    </header>
  );
};

export default HeaderBar;

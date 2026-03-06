import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import type { Species } from "@/data/types";
import { getSeasonsForSpecies } from "@/data/seasons";

interface SearchBarProps {
  species: Species;
  onSelectState: (abbr: string) => void;
}

const SearchBar = ({ species, onSelectState }: SearchBarProps) => {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const seasons = useMemo(() => {
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
    return seasons.filter(
      s => s.state.toLowerCase().includes(q) || s.abbreviation.toLowerCase() === q
    ).slice(0, 6);
  }, [query, seasons]);

  const showDropdown = focused && results.length > 0;

  return (
    <motion.div
      className="relative max-w-md mx-auto px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.5 }}
    >
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by state name..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          className="w-full pl-11 pr-4 py-3 rounded-full bg-secondary border border-border text-foreground placeholder:text-muted-foreground font-body text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        />
      </div>
      {showDropdown && (
        <div className="absolute z-50 mt-2 w-full left-0 px-4">
          <div className="bg-card border border-border rounded-lg shadow-xl overflow-hidden">
            {results.map(s => (
              <button
                key={s.abbreviation}
                onMouseDown={() => {
                  onSelectState(s.abbreviation);
                  setQuery("");
                }}
                className="w-full text-left px-4 py-3 hover:bg-secondary transition-colors text-sm font-body text-foreground flex justify-between items-center"
              >
                <span>{s.state}</span>
                <span className="text-muted-foreground text-xs">{s.abbreviation}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default SearchBar;

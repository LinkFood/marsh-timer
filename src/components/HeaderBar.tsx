import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Search, X, MapPin, Loader2, HelpCircle, Plus, Layers, MessageSquare } from "lucide-react";
import type { Species } from "@/data/types";
import { speciesConfig, SPECIES_ORDER } from "@/data/speciesConfig";
import { getSeasonsForSpecies } from "@/data/seasons";
import UserMenu from './UserMenu';
import GridPresetSelector from './GridPresetSelector';
import DeckSelector from './DeckSelector';
import AlertBell from './AlertBell';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

interface GeoResult {
  name: string;
  lng: number;
  lat: number;
  stateAbbr: string | null;
  type: "place";
}

interface StateResult {
  name: string;
  abbreviation: string;
  type: "state";
}

type SearchResult = GeoResult | StateResult;

interface HeaderBarProps {
  species: Species;
  onSelectSpecies: (s: Species) => void;
  onSearch: (abbr: string) => void;
  onSearchLocation?: (lng: number, lat: number, stateAbbr: string | null) => void;
  onHelpOpen?: () => void;
  onToggleLayers?: () => void;
  onToggleChat?: () => void;
  onTogglePanelAdd?: () => void;
}

const HeaderBar = ({ species, onSelectSpecies, onSearch, onSearchLocation, onHelpOpen, onToggleLayers, onToggleChat, onTogglePanelAdd }: HeaderBarProps) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const stateList = useMemo(() => {
    const all = getSeasonsForSpecies(species);
    const seen = new Set<string>();
    return all.filter(s => {
      if (seen.has(s.abbreviation)) return false;
      seen.add(s.abbreviation);
      return true;
    });
  }, [species]);

  const stateResults = useMemo((): StateResult[] => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return stateList
      .filter(s => s.state.toLowerCase().includes(q) || s.abbreviation.toLowerCase() === q)
      .slice(0, 3)
      .map(s => ({ name: s.state, abbreviation: s.abbreviation, type: "state" as const }));
  }, [query, stateList]);

  // State abbreviation lookup for geocoding results
  const STATE_ABBRS: Record<string, string> = {
    Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",
    Colorado:"CO",Connecticut:"CT",Delaware:"DE",Florida:"FL",Georgia:"GA",
    Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",
    Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",
    Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",
    Montana:"MT",Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ",
    "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",Ohio:"OH",
    Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI","South Carolina":"SC",
    "South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",
    Virginia:"VA",Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY",
  };

  const geocode = useCallback(async (q: string) => {
    if (!MAPBOX_TOKEN || q.length < 2) { setGeoResults([]); return; }
    setIsGeocoding(true);
    try {
      const encoded = encodeURIComponent(q);
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&country=US&types=postcode,place,locality,neighborhood,address,poi&limit=4`
      );
      if (!res.ok) { setGeoResults([]); setIsGeocoding(false); return; }
      const data = await res.json();
      const results: GeoResult[] = (data.features || []).map((f: any) => {
        const [lng, lat] = f.center;
        const regionCtx = f.context?.find((c: any) => c.id?.startsWith("region"));
        const stateName = regionCtx?.text || null;
        const stateAbbr = stateName ? STATE_ABBRS[stateName] || null : null;
        return { name: f.place_name, lng, lat, stateAbbr, type: "place" as const };
      });
      setGeoResults(results);
    } catch {
      setGeoResults([]);
    } finally {
      setIsGeocoding(false);
    }
  }, []);

  // Debounced geocoding
  useEffect(() => {
    if (!query.trim() || query.length < 2) { setGeoResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => geocode(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, geocode]);

  const allResults: SearchResult[] = useMemo(() => {
    return [...stateResults, ...geoResults].slice(0, 6);
  }, [stateResults, geoResults]);

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
        {/* Left: Brand + Deck Selector */}
        <div className="flex items-center shrink-0 gap-1.5">
          <button
            onClick={() => onSelectSpecies('all' as Species)}
            className="flex flex-col items-start shrink-0"
          >
            <span className="font-display text-sm font-bold tracking-widest text-white/90 hidden sm:inline">
              DUCK COUNTDOWN
            </span>
            <span className="font-display text-[7px] tracking-[0.2em] text-white/40 hidden sm:block -mt-0.5">
              ENVIRONMENTAL INTELLIGENCE
            </span>
            <span className="font-display text-sm font-bold tracking-widest text-white/90 sm:hidden">
              DC
            </span>
          </button>
          <DeckSelector />
        </div>

        {/* Center: Species filter */}
        <div className="flex items-center gap-1 flex-1 justify-center">
          <select
            value={species}
            onChange={e => onSelectSpecies(e.target.value as Species)}
            className="bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-[9px] sm:text-[10px] font-display uppercase tracking-widest text-white/70 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 cursor-pointer appearance-none"
            style={{ backgroundImage: 'none' }}
          >
            {SPECIES_ORDER.map(sp => (
              <option key={sp} value={sp} className="bg-[#0a0f1a] text-white">
                {speciesConfig[sp].label}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Actions + User + Search */}
        <div className="flex items-center gap-1.5 shrink-0">
          <GridPresetSelector />
          {onTogglePanelAdd && (
            <button
              onClick={onTogglePanelAdd}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Add panel"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          {onToggleLayers && (
            <button
              onClick={onToggleLayers}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Layers"
            >
              <Layers className="w-4 h-4" />
            </button>
          )}
          {onToggleChat && (
            <button
              onClick={onToggleChat}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Chat"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          )}
          <AlertBell />
          {onHelpOpen && (
            <button
              onClick={onHelpOpen}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Help"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          )}
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
                  placeholder="Search state, city, or zip..."
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
              {isGeocoding && allResults.length === 0 && (
                <div className="absolute top-full right-0 mt-2 w-64 sm:w-80 glass-panel rounded-lg shadow-xl z-50 px-3 py-2.5 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                  <span className="text-xs text-white/50">Searching...</span>
                </div>
              )}
              {allResults.length > 0 && (
                <div className="absolute top-full right-0 mt-2 w-64 sm:w-80 glass-panel rounded-lg shadow-xl overflow-hidden z-50">
                  {allResults.map((r, i) => (
                    r.type === "state" ? (
                      <button
                        key={`state-${r.abbreviation}`}
                        onMouseDown={() => {
                          onSearch(r.abbreviation);
                          setSearchOpen(false);
                          setQuery("");
                          setGeoResults([]);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-secondary transition-colors text-xs font-body text-foreground flex justify-between items-center"
                      >
                        <span>{r.name}</span>
                        <span className="text-muted-foreground text-[10px]">{r.abbreviation}</span>
                      </button>
                    ) : (
                      <button
                        key={`geo-${i}`}
                        onMouseDown={() => {
                          if (onSearchLocation) {
                            onSearchLocation(r.lng, r.lat, r.stateAbbr);
                          } else if (r.stateAbbr) {
                            onSearch(r.stateAbbr);
                          }
                          setSearchOpen(false);
                          setQuery("");
                          setGeoResults([]);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-secondary transition-colors text-xs font-body text-foreground flex items-center gap-2"
                      >
                        <MapPin size={12} className="text-cyan-400 flex-shrink-0" />
                        <span className="truncate">{r.name}</span>
                      </button>
                    )
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

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import type { Species } from "@/data/types";
import { isValidSpecies } from "@/data/types";
import { getStatesForSpecies } from "@/data/seasons";
import Header from "@/components/Header";
import SpeciesSelector from "@/components/SpeciesSelector";
import StatusBar from "@/components/StatusBar";
import SearchBar from "@/components/SearchBar";
import USMap from "@/components/USMap";
import StateDetail from "@/components/StateDetail";
import StateList from "@/components/StateList";
import FavoritesBar from "@/components/FavoritesBar";
import Footer from "@/components/Footer";
import { useFavorites } from "@/hooks/useFavorites";

const Index = () => {
  const { first, second } = useParams<{ first?: string; second?: string }>();
  const navigate = useNavigate();
  const detailRef = useRef<HTMLDivElement>(null);
  const { favorites, toggleFavorite, isFavorite, getFavoritesForSpecies } = useFavorites();

  // Parse route params: /:species/:stateAbbr or /:stateAbbr (legacy)
  const parsed = useMemo(() => {
    if (!first) return { species: "duck" as Species, stateAbbr: null, redirect: null };

    const lower = first.toLowerCase();
    if (isValidSpecies(lower)) {
      // /:species or /:species/:stateAbbr
      const abbr = second?.toUpperCase() || null;
      const validAbbr = abbr && getStatesForSpecies(lower as Species).has(abbr) ? abbr : null;
      if (abbr && !validAbbr) return { species: lower as Species, stateAbbr: null, redirect: `/${lower}` };
      return { species: lower as Species, stateAbbr: validAbbr, redirect: null };
    }

    // Legacy: /:stateAbbr (2-letter) → redirect to /duck/:stateAbbr
    const upper = first.toUpperCase();
    if (upper.length === 2 && getStatesForSpecies("duck").has(upper)) {
      return { species: "duck" as Species, stateAbbr: upper, redirect: `/duck/${upper}` };
    }

    return { species: "duck" as Species, stateAbbr: null, redirect: "/" };
  }, [first, second]);

  const [species, setSpecies] = useState<Species>(parsed.species);
  const [selectedState, setSelectedState] = useState<string | null>(parsed.stateAbbr);

  // Handle redirects
  useEffect(() => {
    if (parsed.redirect) {
      navigate(parsed.redirect, { replace: true });
    }
  }, [parsed.redirect, navigate]);

  // Sync URL params to state
  useEffect(() => {
    setSpecies(parsed.species);
    setSelectedState(parsed.stateAbbr);
  }, [parsed.species, parsed.stateAbbr]);

  const handleSelectSpecies = useCallback((s: Species) => {
    setSpecies(s);
    setSelectedState(null);
    navigate(`/${s}`, { replace: true });
  }, [navigate]);

  const handleSelectState = useCallback((abbr: string) => {
    setSelectedState(abbr);
    navigate(`/${species}/${abbr}`, { replace: true });
    setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [navigate, species]);

  const handleDeselectState = useCallback(() => {
    setSelectedState(null);
    navigate(`/${species}`, { replace: true });
  }, [navigate, species]);

  const handleSwitchSpecies = useCallback((s: Species) => {
    setSpecies(s);
    // Keep the same state selected if it has data for the new species
    if (selectedState && getStatesForSpecies(s).has(selectedState)) {
      navigate(`/${s}/${selectedState}`, { replace: true });
    } else {
      setSelectedState(null);
      navigate(`/${s}`, { replace: true });
    }
  }, [navigate, selectedState]);

  const speciesFavorites = useMemo(
    () => getFavoritesForSpecies(species),
    [getFavoritesForSpecies, species]
  );

  return (
    <div className="min-h-screen bg-background relative">
      <div className="grain-overlay" />
      <div className="relative z-10">
        <Header />
        <SpeciesSelector selected={species} onSelect={handleSelectSpecies} />
        <StatusBar species={species} />
        <SearchBar species={species} onSelectState={handleSelectState} />
        <FavoritesBar
          species={species}
          favorites={speciesFavorites}
          onSelectState={handleSelectState}
          onToggleFavorite={toggleFavorite}
        />
        <USMap
          species={species}
          selectedState={selectedState}
          onSelectState={handleSelectState}
        />
        <div ref={detailRef}>
          <AnimatePresence mode="wait">
            {selectedState && (
              <StateDetail
                key={`${species}-${selectedState}`}
                species={species}
                abbreviation={selectedState}
                onDeselect={handleDeselectState}
                isFavorite={isFavorite(species, selectedState)}
                onToggleFavorite={toggleFavorite}
                onSwitchSpecies={handleSwitchSpecies}
              />
            )}
          </AnimatePresence>
        </div>
        <StateList
          species={species}
          onSelectState={handleSelectState}
          selectedState={selectedState}
          favorites={speciesFavorites}
          onToggleFavorite={toggleFavorite}
        />
        <Footer />
      </div>
    </div>
  );
};

export default Index;

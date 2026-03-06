import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Header from "@/components/Header";
import StatusBar from "@/components/StatusBar";
import SearchBar from "@/components/SearchBar";
import USMap from "@/components/USMap";
import StateDetail from "@/components/StateDetail";
import StateList from "@/components/StateList";
import FavoritesBar from "@/components/FavoritesBar";
import Footer from "@/components/Footer";
import { duckSeasons } from "@/data/seasonData";
import { useFavorites } from "@/hooks/useFavorites";

const validAbbrs = new Set(duckSeasons.map(s => s.abbreviation));

const Index = () => {
  const { stateAbbr } = useParams<{ stateAbbr?: string }>();
  const navigate = useNavigate();
  const detailRef = useRef<HTMLDivElement>(null);
  const { favorites, toggleFavorite, isFavorite } = useFavorites();

  // Normalize route param to uppercase and validate
  const routeAbbr = stateAbbr?.toUpperCase();
  const initialState = routeAbbr && validAbbrs.has(routeAbbr) ? routeAbbr : null;

  const [selectedState, setSelectedState] = useState<string | null>(initialState);

  // Sync URL param to state on navigation
  useEffect(() => {
    const normalized = stateAbbr?.toUpperCase();
    if (normalized && validAbbrs.has(normalized)) {
      setSelectedState(normalized);
    } else if (stateAbbr && !validAbbrs.has(stateAbbr.toUpperCase())) {
      navigate("/", { replace: true });
    }
  }, [stateAbbr, navigate]);

  const handleSelectState = useCallback((abbr: string) => {
    setSelectedState(abbr);
    navigate(`/${abbr}`, { replace: true });
    setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [navigate]);

  const handleDeselectState = useCallback(() => {
    setSelectedState(null);
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background relative">
      <div className="grain-overlay" />
      <div className="relative z-10">
        <Header />
        <StatusBar />
        <SearchBar onSelectState={handleSelectState} />
        <FavoritesBar
          favorites={favorites}
          onSelectState={handleSelectState}
          onToggleFavorite={toggleFavorite}
        />
        <USMap
          selectedState={selectedState}
          onSelectState={handleSelectState}
        />
        <div ref={detailRef}>
          <AnimatePresence mode="wait">
            {selectedState && (
              <StateDetail
                key={selectedState}
                abbreviation={selectedState}
                onDeselect={handleDeselectState}
                isFavorite={isFavorite(selectedState)}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </AnimatePresence>
        </div>
        <StateList
          onSelectState={handleSelectState}
          selectedState={selectedState}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />
        <Footer />
      </div>
    </div>
  );
};

export default Index;

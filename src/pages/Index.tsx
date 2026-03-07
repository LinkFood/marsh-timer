import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Species } from "@/data/types";
import { isValidSpecies } from "@/data/types";
import { getStatesForSpecies } from "@/data/seasons";
import { isFlywaySpecies } from "@/data/flyways";
import { useFavorites } from "@/hooks/useFavorites";
import { useIsMobile } from "@/hooks/useIsMobile";
import MapView from "@/components/MapView";
import HeaderBar from "@/components/HeaderBar";
import LiveTicker from "@/components/LiveTicker";
import CountdownBoard from "@/components/CountdownBoard";
import StateDetailPanel from "@/components/StateDetailPanel";
import MapControls from "@/components/MapControls";

const Index = () => {
  const { first, second } = useParams<{ first?: string; second?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { favorites, toggleFavorite, isFavorite, getFavoritesForSpecies } = useFavorites();
  const mapRef = useRef<{ flyTo: (abbr: string) => void }>(null);

  // Parse route params: /:species/:stateAbbr or /:stateAbbr (legacy)
  const parsed = useMemo(() => {
    if (!first) return { species: "duck" as Species, stateAbbr: null, redirect: null };

    const lower = first.toLowerCase();
    if (isValidSpecies(lower)) {
      const abbr = second?.toUpperCase() || null;
      const validAbbr = abbr && getStatesForSpecies(lower as Species).has(abbr) ? abbr : null;
      if (abbr && !validAbbr) return { species: lower as Species, stateAbbr: null, redirect: `/${lower}` };
      return { species: lower as Species, stateAbbr: validAbbr, redirect: null };
    }

    // Legacy: /:stateAbbr (2-letter) -> redirect to /duck/:stateAbbr
    const upper = first.toUpperCase();
    if (upper.length === 2 && getStatesForSpecies("duck").has(upper)) {
      return { species: "duck" as Species, stateAbbr: upper, redirect: `/duck/${upper}` };
    }

    return { species: "duck" as Species, stateAbbr: null, redirect: "/" };
  }, [first, second]);

  const [species, setSpecies] = useState<Species>(parsed.species);
  const [selectedState, setSelectedState] = useState<string | null>(parsed.stateAbbr);
  const [showFlyways, setShowFlyways] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);

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

  // Reset flyway toggle when switching to non-flyway species
  useEffect(() => {
    if (!isFlywaySpecies(species)) setShowFlyways(false);
  }, [species]);

  const handleSelectSpecies = useCallback((s: Species) => {
    setSpecies(s);
    setSelectedState(null);
    navigate(`/${s}`, { replace: true });
  }, [navigate]);

  const handleSelectState = useCallback((abbr: string) => {
    setSelectedState(abbr);
    navigate(`/${species}/${abbr}`, { replace: true });
  }, [navigate, species]);

  const handleDeselectState = useCallback(() => {
    setSelectedState(null);
    navigate(`/${species}`, { replace: true });
  }, [navigate, species]);

  const handleSwitchSpecies = useCallback((s: Species) => {
    setSpecies(s);
    if (selectedState && getStatesForSpecies(s).has(selectedState)) {
      navigate(`/${s}/${selectedState}`, { replace: true });
    } else {
      setSelectedState(null);
      navigate(`/${s}`, { replace: true });
    }
  }, [navigate, selectedState]);

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Simple reverse-geocode: find nearest state centroid
        // For now just center the map — full geocoding is v2
        console.log("User location:", pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        console.log("Geolocation denied");
      }
    );
  }, []);

  const speciesFavorites = useMemo(
    () => getFavoritesForSpecies(species),
    [getFavoritesForSpecies, species]
  );

  return (
    <div className="h-[100dvh] w-screen overflow-hidden relative">
      {/* Map background */}
      <MapView
        species={species}
        selectedState={selectedState}
        onSelectState={handleSelectState}
        showFlyways={showFlyways}
      />

      {/* Header */}
      <HeaderBar
        species={species}
        onSelectSpecies={handleSelectSpecies}
        onSearch={handleSelectState}
      />

      {/* Ticker below header */}
      <div className="fixed top-12 left-0 right-0 z-20 map-overlay-panel border-b border-border/30 py-1">
        <LiveTicker species={species} />
      </div>

      {/* Countdown Board */}
      <CountdownBoard
        species={species}
        selectedState={selectedState}
        onSelectState={handleSelectState}
        favorites={speciesFavorites}
        onToggleFavorite={toggleFavorite}
        isMobile={isMobile}
      />

      {/* State Detail Panel */}
      {selectedState && (
        <StateDetailPanel
          key={`${species}-${selectedState}`}
          species={species}
          abbreviation={selectedState}
          onClose={handleDeselectState}
          isFavorite={isFavorite(species, selectedState)}
          onToggleFavorite={toggleFavorite}
          onSwitchSpecies={handleSwitchSpecies}
          isMobile={isMobile}
        />
      )}

      {/* Map Controls */}
      <MapControls
        onGeolocate={handleGeolocate}
        showFlyways={showFlyways}
        onToggleFlyways={() => setShowFlyways(f => !f)}
        showFlywayOption={isFlywaySpecies(species)}
        onToggleSatellite={() => setIsSatellite(s => !s)}
        isSatellite={isSatellite}
      />

      {/* Grain overlay */}
      <div className="grain-overlay" />
    </div>
  );
};

export default Index;

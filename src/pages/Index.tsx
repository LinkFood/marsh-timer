import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Species } from "@/data/types";
import { isValidSpecies } from "@/data/types";
import { getStatesForSpecies, getSeasonsByState } from "@/data/seasons";
import { isFlywaySpecies } from "@/data/flyways";
import { useFavorites } from "@/hooks/useFavorites";
import { useIsMobile } from "@/hooks/useIsMobile";
import MapView from "@/components/MapView";
import type { MapViewRef } from "@/components/MapView";
import HeaderBar from "@/components/HeaderBar";
import BottomPanel from "@/components/BottomPanel";
import MapControls from "@/components/MapControls";

type DrillLevel = "national" | "state" | "zone";

const Index = () => {
  const { first, second, third } = useParams<{
    first?: string;
    second?: string;
    third?: string;
  }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { favorites, toggleFavorite, isFavorite, getFavoritesForSpecies } =
    useFavorites();
  const mapRef = useRef<MapViewRef>(null);

  // Parse route params
  const parsed = useMemo(() => {
    if (!first)
      return {
        species: "duck" as Species,
        stateAbbr: null,
        zoneSlug: null,
        redirect: null,
      };

    const lower = first.toLowerCase();
    if (isValidSpecies(lower)) {
      const abbr = second?.toUpperCase() || null;
      const validAbbr =
        abbr && getStatesForSpecies(lower as Species).has(abbr) ? abbr : null;
      if (abbr && !validAbbr)
        return {
          species: lower as Species,
          stateAbbr: null,
          zoneSlug: null,
          redirect: `/${lower}`,
        };

      const zone = third?.toLowerCase() || null;
      // Validate zone slug if present
      let validZone: string | null = null;
      if (zone && validAbbr) {
        const seasons = getSeasonsByState(lower as Species, validAbbr);
        if (seasons.some((s) => s.zoneSlug === zone)) {
          validZone = zone;
        }
      }

      return {
        species: lower as Species,
        stateAbbr: validAbbr,
        zoneSlug: validZone,
        redirect: null,
      };
    }

    // Legacy: /:stateAbbr (2-letter) -> redirect to /duck/:stateAbbr
    const upper = first.toUpperCase();
    if (upper.length === 2 && getStatesForSpecies("duck").has(upper)) {
      return {
        species: "duck" as Species,
        stateAbbr: upper,
        zoneSlug: null,
        redirect: `/duck/${upper}`,
      };
    }

    return {
      species: "duck" as Species,
      stateAbbr: null,
      zoneSlug: null,
      redirect: "/",
    };
  }, [first, second, third]);

  const [species, setSpecies] = useState<Species>(parsed.species);
  const [selectedState, setSelectedState] = useState<string | null>(
    parsed.stateAbbr,
  );
  const [zoneSlug, setZoneSlug] = useState<string | null>(parsed.zoneSlug);
  const [showFlyways, setShowFlyways] = useState(false);
  const [isSatellite, setIsSatellite] = useState(true);
  const [show3D, setShow3D] = useState(true);

  // Derive drill level
  const level: DrillLevel = useMemo(() => {
    if (zoneSlug && selectedState) return "zone";
    if (selectedState) return "state";
    return "national";
  }, [selectedState, zoneSlug]);

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
    setZoneSlug(parsed.zoneSlug);
  }, [parsed.species, parsed.stateAbbr, parsed.zoneSlug]);

  // Reset flyway toggle when switching to non-flyway species
  useEffect(() => {
    if (!isFlywaySpecies(species)) setShowFlyways(false);
  }, [species]);

  const handleSelectSpecies = useCallback(
    (s: Species) => {
      setSpecies(s);
      setSelectedState(null);
      setZoneSlug(null);
      navigate(`/${s}`, { replace: true });
    },
    [navigate],
  );

  const handleSelectState = useCallback(
    (abbr: string) => {
      setSelectedState(abbr);
      setZoneSlug(null);
      navigate(`/${species}/${abbr}`, { replace: true });
      mapRef.current?.flyTo(abbr);
    },
    [navigate, species],
  );

  const handleSelectZone = useCallback(
    (slug: string) => {
      if (!selectedState) return;
      setZoneSlug(slug);
      navigate(`/${species}/${selectedState}/${slug}`, { replace: true });
    },
    [navigate, species, selectedState],
  );

  const handleBack = useCallback(() => {
    if (zoneSlug) {
      // Zone -> State
      setZoneSlug(null);
      navigate(`/${species}/${selectedState}`, { replace: true });
    } else if (selectedState) {
      // State -> National
      setSelectedState(null);
      setZoneSlug(null);
      navigate(`/${species}`, { replace: true });
    }
  }, [navigate, species, selectedState, zoneSlug]);

  const handleDrillUp = useCallback(() => {
    // Called by map when user zooms out past threshold
    if (selectedState) {
      setSelectedState(null);
      setZoneSlug(null);
      navigate(`/${species}`, { replace: true });
    }
  }, [navigate, species, selectedState]);

  const handleSwitchSpecies = useCallback(
    (s: Species) => {
      setSpecies(s);
      if (selectedState && getStatesForSpecies(s).has(selectedState)) {
        setZoneSlug(null);
        navigate(`/${s}/${selectedState}`, { replace: true });
      } else {
        setSelectedState(null);
        setZoneSlug(null);
        navigate(`/${s}`, { replace: true });
      }
    },
    [navigate, selectedState],
  );

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.log(
          "User location:",
          pos.coords.latitude,
          pos.coords.longitude,
        );
      },
      () => {
        console.log("Geolocation denied");
      },
    );
  }, []);

  const speciesFavorites = useMemo(
    () => getFavoritesForSpecies(species),
    [getFavoritesForSpecies, species],
  );

  return (
    <div className="h-[100dvh] w-screen overflow-hidden relative">
      {/* Map background */}
      <MapView
        ref={mapRef}
        species={species}
        selectedState={selectedState}
        onSelectState={handleSelectState}
        onDrillUp={handleDrillUp}
        showFlyways={showFlyways}
        isSatellite={isSatellite}
        show3D={show3D}
        isMobile={isMobile}
      />

      {/* Header */}
      <HeaderBar
        species={species}
        onSelectSpecies={handleSelectSpecies}
        onSearch={handleSelectState}
      />

      {/* Bottom Panel */}
      <BottomPanel
        level={level}
        species={species}
        stateAbbr={selectedState}
        zoneSlug={zoneSlug}
        onSelectState={handleSelectState}
        onSelectZone={handleSelectZone}
        onBack={handleBack}
        onSwitchSpecies={handleSwitchSpecies}
        isMobile={isMobile}
        favorites={speciesFavorites}
        onToggleFavorite={toggleFavorite}
        isFavorite={selectedState ? isFavorite(species, selectedState) : false}
      />

      {/* Map Controls */}
      <MapControls
        onGeolocate={handleGeolocate}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        showFlyways={showFlyways}
        onToggleFlyways={() => setShowFlyways((f) => !f)}
        showFlywayOption={isFlywaySpecies(species)}
        onToggleSatellite={() => setIsSatellite((s) => !s)}
        isSatellite={isSatellite}
        show3D={show3D}
        onToggle3D={() => setShow3D((s) => !s)}
      />

      {/* Grain overlay */}
      <div className="grain-overlay" />
    </div>
  );
};

export default Index;

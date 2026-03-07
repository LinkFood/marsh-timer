import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Species } from "@/data/types";
import { isValidSpecies } from "@/data/types";
import { getStatesForSpecies, getSeasonsByState } from "@/data/seasons";
import { isFlywaySpecies } from "@/data/flyways";
import { useFavorites } from "@/hooks/useFavorites";
import { useIsMobile } from "@/hooks/useIsMobile";
import MapView from "@/components/MapView";
import type { MapViewRef, MapOverlays } from "@/components/MapView";
import HeaderBar from "@/components/HeaderBar";
import BottomPanel from "@/components/BottomPanel";
import MapControls from "@/components/MapControls";
import LayersPanel from "@/components/LayersPanel";
import { useRadarTiles } from "@/hooks/useRadarTiles";
import { useEBirdMapSightings } from "@/hooks/useEBirdMapSightings";
import { useNationalWeather } from "@/hooks/useNationalWeather";

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
  const [showRadar, setShowRadar] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [overlays, setOverlays] = useState<MapOverlays>({
    wetlands: false,
    landCover: false,
    contours: false,
    waterways: false,
    agriculture: false,
    parks: false,
    trails: false,
  });
  const [elevation, setElevation] = useState<number | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState(3.5);
  const radarTileUrl = useRadarTiles();
  const sightingsGeoJSON = useEBirdMapSightings(species, mapCenter, mapZoom);
  const weatherCache = useNationalWeather();

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

  const handleToggleOverlay = useCallback((key: keyof MapOverlays) => {
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleSearchLocation = useCallback(
    (lng: number, lat: number, stateAbbr: string | null) => {
      // If we know the state, set it for the panel
      if (stateAbbr && getStatesForSpecies(species).has(stateAbbr)) {
        setSelectedState(stateAbbr);
        setZoneSlug(null);
        navigate(`/${species}/${stateAbbr}`, { replace: true });
      }
      // Fly to the exact coordinates at high zoom with terrain
      mapRef.current?.flyToCoords(lng, lat);
    },
    [navigate, species],
  );

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // Fly to user's location
        mapRef.current?.flyToCoords(longitude, latitude);
        // Try to reverse-geocode to determine state
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (token) {
          fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${token}&types=region&limit=1`)
            .then(r => r.json())
            .then(data => {
              const stateFeature = data.features?.[0];
              if (stateFeature?.properties?.short_code) {
                const abbr = stateFeature.properties.short_code.replace("US-", "");
                if (getStatesForSpecies(species).has(abbr)) {
                  setSelectedState(abbr);
                  setZoneSlug(null);
                  navigate(`/${species}/${abbr}`, { replace: true });
                }
              }
            })
            .catch(() => {});
        }
      },
      () => {},
    );
  }, [navigate, species]);

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
        showRadar={showRadar}
        radarTileUrl={radarTileUrl}
        sightingsGeoJSON={sightingsGeoJSON}
        weatherCache={weatherCache}
        overlays={overlays}
        onElevation={setElevation}
        onMoveEnd={(center, zoom) => { setMapCenter(center); setMapZoom(zoom); }}
      />

      {/* Header */}
      <HeaderBar
        species={species}
        onSelectSpecies={handleSelectSpecies}
        onSearch={handleSelectState}
        onSearchLocation={handleSearchLocation}
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
        showRadar={showRadar}
        onToggleRadar={() => setShowRadar((r) => !r)}
        showLayers={showLayers}
        onToggleLayers={() => setShowLayers((l) => !l)}
      />

      {/* Layers Panel */}
      <LayersPanel
        overlays={overlays}
        onToggle={handleToggleOverlay}
        isOpen={showLayers}
        onClose={() => setShowLayers(false)}
      />

      {/* Elevation HUD */}
      {show3D && elevation !== null && mapZoom > 8 && (
        <div className="fixed bottom-6 left-4 z-20 glass-panel rounded-lg px-3 py-1.5 border border-white/[0.06]">
          <span className="text-[10px] text-white/40 uppercase tracking-wider mr-1.5">Elev</span>
          <span className="text-xs text-white/80 font-body font-medium">{elevation.toLocaleString()}ft</span>
        </div>
      )}

      {/* Grain overlay */}
      <div className="grain-overlay" />
    </div>
  );
};

export default Index;

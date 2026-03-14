import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Species } from "@/data/types";
import { isValidSpecies } from "@/data/types";
import { getStatesForSpecies, getSeasonsByState } from "@/data/seasons";
import { isFlywaySpecies } from "@/data/flyways";
import { useFavorites } from "@/hooks/useFavorites";
import { useIsMobile } from "@/hooks/useIsMobile";
import MapView from "@/components/MapView";
import type { MapViewRef, MapMode } from "@/components/MapView";
import HeaderBar from "@/components/HeaderBar";
import Sidebar from "@/components/Sidebar";
import MobileSheet from "@/components/MobileSheet";
import MapPresets from "@/components/MapPresets";
import MapLegend from "@/components/MapLegend";
import { useWeatherTiles } from "@/hooks/useWeatherTiles";
import { useEBirdMapSightings } from "@/hooks/useEBirdMapSightings";
import { useNationalWeather } from "@/hooks/useNationalWeather";
import { useHuntAlerts } from "@/hooks/useHuntAlerts";
import { useConvergenceScores } from "@/hooks/useConvergenceScores";
import { useScoutReport } from "@/hooks/useScoutReport";
import { useConvergenceAlerts } from "@/hooks/useConvergenceAlerts";
import { useCountyGeoJSON } from "@/hooks/useCountyGeoJSON";
import { useNWSAlerts } from "@/hooks/useNWSAlerts";
import { useMigrationFront } from "@/hooks/useMigrationFront";
import { useDUMapReports } from "@/hooks/useDUMapReports";
import TimelineScrubber from "@/components/TimelineScrubber";
import HelpModal, { useHelpModal } from "@/components/HelpModal";
import { MapActionProvider } from "@/contexts/MapActionContext";

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
  const [showRadar, setShowRadar] = useState(false);
  const [showDUPins, setShowDUPins] = useState(false);
  const [isSatellite, setIsSatellite] = useState(true);
  const [show3D, setShow3D] = useState(true);
  const [mapMode, setMapModeRaw] = useState<MapMode>('default');
  const setMapMode = useCallback((mode: MapMode) => {
    setMapModeRaw(mode);
    if (mode === 'terrain') setShow3D(true);
  }, []);
  const [elevation, setElevation] = useState<number | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState(3.5);
  const weatherTiles = useWeatherTiles();
  const countyGeoJSON = useCountyGeoJSON();
  const nwsAlertsGeoJSON = useNWSAlerts();
  const migrationFrontLine = useMigrationFront();
  const { geojson: duPinsGeoJSON } = useDUMapReports();
  const sightingsGeoJSON = useEBirdMapSightings(species, mapCenter, mapZoom);
  const weatherCache = useNationalWeather();
  const { alerts } = useHuntAlerts();
  const { scores: convergenceScores, topStates: convergenceTopStates, loading: convergenceLoading } = useConvergenceScores();
  const { report: scoutReport, loading: scoutReportLoading } = useScoutReport();
  const { alerts: convergenceAlerts } = useConvergenceAlerts();
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const helpModal = useHelpModal();
  const [scrubDate, setScrubDate] = useState<Date | null>(null);
  const [scrubScores, setScrubScores] = useState<Map<string, number> | null>(null);
  const [scrubLoading, setScrubLoading] = useState(false);

  // Build convergence score map for MapView (abbr -> score number)
  // MUST be defined before activeConvergenceScores which depends on it
  const convergenceScoreMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [abbr, data] of convergenceScores) {
      map.set(abbr, data.score);
    }
    return map;
  }, [convergenceScores]);

  // "Perfect Storm" states — convergence >= 85, weather >= 80, migration >= 70
  const perfectStormStates = useMemo(() => {
    const states = new Set<string>();
    for (const [abbr, data] of convergenceScores) {
      if (data.score >= 80 && data.weather_component >= 20 && data.migration_component >= 20) {
        states.add(abbr);
      }
    }
    return states;
  }, [convergenceScores]);

  // Fetch historical convergence scores when scrub date changes
  useEffect(() => {
    if (!scrubDate) {
      setScrubScores(null);
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scrubDay = new Date(scrubDate);
    scrubDay.setHours(0, 0, 0, 0);

    if (scrubDay.getTime() === today.getTime()) {
      setScrubScores(null);
      return;
    }

    if (scrubDay > today) {
      setScrubScores(null);
      return;
    }

    const dateStr = scrubDay.toISOString().split('T')[0];
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    let cancelled = false;
    setScrubLoading(true);

    fetch(
      `${supabaseUrl}/rest/v1/hunt_convergence_scores?select=state_abbr,score&date=eq.${dateStr}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    )
      .then(r => r.json())
      .then((rows: Array<{ state_abbr: string; score: number }>) => {
        if (cancelled) return;
        if (!Array.isArray(rows) || rows.length === 0) {
          setScrubScores(new Map());
        } else {
          const map = new Map<string, number>();
          for (const row of rows) {
            map.set(row.state_abbr, row.score);
          }
          setScrubScores(map);
        }
      })
      .catch(() => {
        if (!cancelled) setScrubScores(new Map());
      })
      .finally(() => {
        if (!cancelled) setScrubLoading(false);
      });

    return () => { cancelled = true; };
  }, [scrubDate]);

  // Determine which convergence scores to pass to MapView
  const activeConvergenceScores = useMemo(() => {
    if (scrubScores !== null) return scrubScores;
    return convergenceScoreMap;
  }, [scrubScores, convergenceScoreMap]);

  // Compute whether we're viewing a non-today date
  const isViewingHistory = useMemo(() => {
    if (!scrubDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scrubDay = new Date(scrubDate);
    scrubDay.setHours(0, 0, 0, 0);
    return scrubDay.getTime() !== today.getTime();
  }, [scrubDate]);

  const isFutureDate = useMemo(() => {
    if (!scrubDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scrubDay = new Date(scrubDate);
    scrubDay.setHours(0, 0, 0, 0);
    return scrubDay > today;
  }, [scrubDate]);

  // Get convergence score for selected state
  const selectedConvergenceScore = useMemo(() => {
    if (!selectedState) return null;
    return convergenceScores.get(selectedState) || null;
  }, [selectedState, convergenceScores]);

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
      setMapMode('default');
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
      setZoneSlug(null);
      navigate(`/${species}/${selectedState}`, { replace: true });
    } else if (selectedState) {
      setSelectedState(null);
      setZoneSlug(null);
      navigate(`/${species}`, { replace: true });
    }
  }, [navigate, species, selectedState, zoneSlug]);

  const handleDrillUp = useCallback(() => {
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

  const handleSearchLocation = useCallback(
    (lng: number, lat: number, stateAbbr: string | null) => {
      if (stateAbbr && getStatesForSpecies(species).has(stateAbbr)) {
        setSelectedState(stateAbbr);
        setZoneSlug(null);
        navigate(`/${species}/${stateAbbr}`, { replace: true });
      }
      mapRef.current?.flyToCoords(lng, lat);
    },
    [navigate, species],
  );

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        mapRef.current?.flyToCoords(longitude, latitude);
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
        weatherTiles={weatherTiles}
        countyGeoJSON={countyGeoJSON}
        sightingsGeoJSON={sightingsGeoJSON}
        weatherCache={weatherCache}
        onElevation={setElevation}
        onMoveEnd={(center, zoom) => { setMapCenter(center); setMapZoom(zoom); }}
        mapMode={mapMode}
        convergenceScores={activeConvergenceScores}
        perfectStormStates={perfectStormStates}
        nwsAlertsGeoJSON={nwsAlertsGeoJSON}
        migrationFrontLine={migrationFrontLine}
        scrubDate={scrubDate}
        showRadar={showRadar}
        showDUPins={showDUPins}
        duPinsGeoJSON={duPinsGeoJSON}
      />

      {/* Header */}
      <HeaderBar
        species={species}
        onSelectSpecies={handleSelectSpecies}
        onSearch={handleSelectState}
        onSearchLocation={handleSearchLocation}
        onHelpOpen={helpModal.show}
      />

      {/* Sidebar (desktop) / MobileSheet (mobile) */}
      <MapActionProvider
        flyTo={handleSelectState}
        flyToCoords={(lng, lat, zoom) => mapRef.current?.flyToCoords(lng, lat, zoom)}
        setMapMode={setMapMode}
      >
        {isMobile ? (
          <MobileSheet
            level={level}
            species={species}
            stateAbbr={selectedState}
            zoneSlug={zoneSlug}
            onSelectState={handleSelectState}
            onSelectZone={handleSelectZone}
            onBack={handleBack}
            onSwitchSpecies={handleSwitchSpecies}
            favorites={speciesFavorites}
            onToggleFavorite={toggleFavorite}
            isFavorite={selectedState ? isFavorite(species, selectedState) : false}
            alerts={alerts}
            weatherSnapshot={weatherCache}
          />
        ) : (
          <Sidebar
            level={level}
            species={species}
            stateAbbr={selectedState}
            zoneSlug={zoneSlug}
            onSelectState={handleSelectState}
            onSelectZone={handleSelectZone}
            onBack={handleBack}
            onSwitchSpecies={handleSwitchSpecies}
            favorites={speciesFavorites}
            onToggleFavorite={toggleFavorite}
            isFavorite={selectedState ? isFavorite(species, selectedState) : false}
            alerts={alerts}
            weatherSnapshot={weatherCache}
            convergenceTopStates={convergenceTopStates}
            convergenceLoading={convergenceLoading}
            convergenceScore={selectedConvergenceScore}
            scoutReport={scoutReport}
            scoutReportLoading={scoutReportLoading}
            convergenceAlerts={convergenceAlerts}
            expanded={sidebarExpanded}
            onToggleExpanded={() => setSidebarExpanded(e => !e)}
          />
        )}
      </MapActionProvider>

      {/* Map Mode Presets */}
      <MapPresets
        mode={mapMode}
        onSetMode={setMapMode}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onGeolocate={handleGeolocate}
        show3D={show3D}
        onToggle3D={() => setShow3D((s) => !s)}
        isSatellite={isSatellite}
        onToggleSatellite={() => setIsSatellite((s) => !s)}
        showFlyways={showFlyways}
        onToggleFlyways={() => setShowFlyways((f) => !f)}
        showFlywayOption={isFlywaySpecies(species)}
        showRadar={showRadar}
        onToggleRadar={() => setShowRadar((r) => !r)}
        showDUPins={showDUPins}
        onToggleDUPins={() => setShowDUPins((d) => !d)}
      />

      {/* Map Legend */}
      <MapLegend
        mode={mapMode}
        sidebarExpanded={sidebarExpanded}
        isMobile={isMobile}
        drillLevel={level}
        species={species}
      />

      {/* Elevation HUD */}
      {show3D && elevation !== null && mapZoom > 8 && (
        <div
          className="fixed bottom-6 z-20 glass-panel rounded-lg px-3 py-1.5 border border-white/[0.06] transition-all duration-300"
          style={{ left: !isMobile && sidebarExpanded ? 'calc(340px + 1rem)' : '1rem' }}
        >
          <span className="text-[10px] text-white/40 uppercase tracking-wider mr-1.5">Elev</span>
          <span className="text-xs text-white/80 font-body font-medium">{elevation.toLocaleString()}ft</span>
        </div>
      )}

      {/* Timeline Scrubber — Intel mode only */}
      {mapMode === 'intel' && (
        <TimelineScrubber
          onDateChange={setScrubDate}
          sidebarOffset={!isMobile && sidebarExpanded ? 340 : 0}
        />
      )}

      {/* Viewing indicator for non-today dates */}
      {mapMode === 'intel' && isViewingHistory && (
        <div
          className="fixed z-30 glass-panel rounded-lg px-3 py-1.5 border border-white/[0.06]"
          style={{
            bottom: '48px',
            left: !isMobile && sidebarExpanded ? 'calc(340px + 1rem)' : '1rem',
          }}
        >
          <span className="text-[10px] text-white/40 uppercase tracking-wider mr-1.5">Viewing</span>
          <span className="text-xs text-cyan-400 font-body font-medium">
            {scrubDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          {scrubLoading && (
            <span className="text-[10px] text-white/30 ml-2">Loading...</span>
          )}
          {!scrubLoading && scrubScores && scrubScores.size === 0 && (
            <span className="text-[10px] text-white/30 ml-2">No data</span>
          )}
        </div>
      )}

      {/* Future date indicator */}
      {mapMode === 'intel' && isFutureDate && (
        <div
          className="fixed z-30 glass-panel rounded-lg px-3 py-1.5 border border-white/[0.06]"
          style={{
            bottom: '48px',
            left: !isMobile && sidebarExpanded ? 'calc(340px + 1rem)' : '1rem',
          }}
        >
          <span className="text-[10px] text-white/40 uppercase tracking-wider mr-1.5">Forecast</span>
          <span className="text-xs text-white/50 font-body font-medium">Not available</span>
        </div>
      )}

      {/* Help Modal */}
      <HelpModal open={helpModal.open} onClose={helpModal.close} />

      {/* Grain overlay */}
      <div className="grain-overlay" />
    </div>
  );
};

export default Index;

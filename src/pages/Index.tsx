import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import type { Species } from "@/data/types";
import { isValidSpecies } from "@/data/types";
import { getStatesForSpecies, getSeasonsByState } from "@/data/seasons";
import { useIsMobile } from "@/hooks/useIsMobile";
import MapView from "@/components/MapView";
import type { MapViewRef } from "@/components/MapView";
import HeaderBar from "@/components/HeaderBar";
import { useWeatherTiles } from "@/hooks/useWeatherTiles";
import { useEBirdMapSightings } from "@/hooks/useEBirdMapSightings";
import { useNationalWeather } from "@/hooks/useNationalWeather";
import { usePatternAlerts } from "@/hooks/usePatternAlerts";
import { useConvergenceScores } from "@/hooks/useConvergenceScores";
import { useConvergenceAlerts } from "@/hooks/useConvergenceAlerts";
import { useCountyGeoJSON } from "@/hooks/useCountyGeoJSON";
import { useNWSAlerts } from "@/hooks/useNWSAlerts";
import { useMigrationFront } from "@/hooks/useMigrationFront";
import { useDUMapReports } from "@/hooks/useDUMapReports";
import { useWeatherEvents } from "@/hooks/useWeatherEvents";
// Ocean buoy data loaded directly in MapView (Vite tree-shaking breaks prop passing)
import { useMurmurationIndex } from "@/hooks/useMurmurationIndex";
import { useStateArcs } from "@/hooks/useStateArcs";
import { useStateBrief } from "@/hooks/useStateBrief";
import { useConvergenceHistory, useConvergenceHistoryAll } from "@/hooks/useConvergenceHistory";
import { useAlertCalibration } from "@/hooks/useAlertCalibration";
import HelpModal, { useHelpModal } from "@/components/HelpModal";
import { MapActionProvider } from "@/contexts/MapActionContext";
import { DeckProvider, useDeck } from "@/contexts/DeckContext";
import { LayerProvider, useLayerContext } from "@/contexts/LayerContext";
import DeckLayout from "@/layout/DeckLayout";
import TerminalLayout from "@/layout/TerminalLayout";
import WidgetManager from "@/panels/WidgetManager";
import ErrorBoundary from "@/components/ErrorBoundary";

interface IndexProps {
  legacyLayout?: boolean;
}

const Index = ({ legacyLayout }: IndexProps = {}) => {
  const { first, second, third } = useParams<{
    first?: string;
    second?: string;
    third?: string;
  }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const mapRef = useRef<MapViewRef>(null);

  // Parse route params
  const parsed = useMemo(() => {
    if (!first)
      return { species: "all" as Species, stateAbbr: null, zoneSlug: null, redirect: null };

    const lower = first.toLowerCase();
    if (isValidSpecies(lower)) {
      const abbr = second?.toUpperCase() || null;
      const validAbbr =
        abbr && getStatesForSpecies(lower as Species).has(abbr) ? abbr : null;
      if (abbr && !validAbbr)
        return { species: lower as Species, stateAbbr: null, zoneSlug: null, redirect: `/${lower}` };

      const zone = third?.toLowerCase() || null;
      let validZone: string | null = null;
      if (zone && validAbbr) {
        const seasons = getSeasonsByState(lower as Species, validAbbr);
        if (seasons.some((s) => s.zoneSlug === zone)) validZone = zone;
      }

      return { species: lower as Species, stateAbbr: validAbbr, zoneSlug: validZone, redirect: null };
    }

    const upper = first.toUpperCase();
    if (upper.length === 2 && getStatesForSpecies("all").has(upper)) {
      return { species: "all" as Species, stateAbbr: upper, zoneSlug: null, redirect: null };
    }

    return { species: "all" as Species, stateAbbr: null, zoneSlug: null, redirect: "/" };
  }, [first, second, third]);

  const [species, setSpecies] = useState<Species>(parsed.species);
  const [selectedState, setSelectedState] = useState<string | null>(parsed.stateAbbr);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState(3.5);

  // Data hooks — map data
  const weatherTiles = useWeatherTiles();
  const countyGeoJSON = useCountyGeoJSON();
  const { alertsGeoJSON: nwsAlertsGeoJSON } = useNWSAlerts();
  const migrationFrontLine = useMigrationFront();
  const { geojson: duPinsGeoJSON } = useDUMapReports();
  const { eventsGeoJSON: weatherEventsGeoJSON } = useWeatherEvents();
  // buoy data loaded directly in MapView
  const sightingsGeoJSON = useEBirdMapSightings(species, mapCenter, mapZoom);
  const weatherCache = useNationalWeather();

  // Data hooks — critical path first
  const { alerts } = usePatternAlerts();
  const { scores: convergenceScores } = useConvergenceScores();
  const { alerts: convergenceAlerts } = useConvergenceAlerts();
  const { data: murmurationIndex } = useMurmurationIndex();

  // Secondary hooks — defer until scores load to avoid connection pool congestion
  const scoresReady = convergenceScores.size > 0;
  const { arcs: stateArcs } = useStateArcs(scoresReady);
  const { brief: stateBrief, loading: briefLoading } = useStateBrief(selectedState);
  const { historyMap: convergenceHistoryMap } = useConvergenceHistoryAll(scoresReady ? 7 : 0);
  const { history: stateConvergenceHistory } = useConvergenceHistory(selectedState, 3);
  const { byState: calibrationByState } = useAlertCalibration(scoresReady);
  const helpModal = useHelpModal();

  // Build convergence score map for MapView — full objects, not just numbers
  const convergenceScoreMap = useMemo(() => {
    const map = new Map<string, { score: number; weather_component: number; migration_component: number; birdcast_component: number; solunar_component: number; pattern_component: number; reasoning?: string }>();
    for (const [abbr, data] of convergenceScores) {
      map.set(abbr, {
        score: data.score,
        weather_component: data.weather_component || 0,
        migration_component: data.migration_component || 0,
        birdcast_component: data.birdcast_component || 0,
        solunar_component: data.solunar_component || 0,
        pattern_component: data.pattern_component || 0,
        reasoning: data.reasoning,
      });
    }
    return map;
  }, [convergenceScores]);

  // "Perfect Storm" states
  const perfectStormStates = useMemo(() => {
    const states = new Set<string>();
    for (const [abbr, data] of convergenceScores) {
      if (data.score >= 80 && data.weather_component >= 20 && data.migration_component >= 20) {
        states.add(abbr);
      }
    }
    return states;
  }, [convergenceScores]);

  // Handle redirects
  useEffect(() => {
    if (parsed.redirect) navigate(parsed.redirect, { replace: true });
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
    navigate(legacyLayout ? `/${species}/${abbr}` : `/${abbr}`, { replace: true });
    mapRef.current?.flyTo(abbr);
  }, [navigate, species, legacyLayout]);

  const handleDrillUp = useCallback(() => {
    if (selectedState) {
      setSelectedState(null);
      navigate(legacyLayout ? `/${species}` : '/', { replace: true });
    }
  }, [navigate, species, selectedState, legacyLayout]);

  const handleSearchLocation = useCallback((lng: number, lat: number, stateAbbr: string | null) => {
    if (stateAbbr && getStatesForSpecies(species).has(stateAbbr)) {
      setSelectedState(stateAbbr);
      navigate(legacyLayout ? `/${species}/${stateAbbr}` : `/${stateAbbr}`, { replace: true });
    }
    mapRef.current?.flyToCoords(lng, lat);
  }, [navigate, species]);

  const setSelectedStateWrapped = useCallback((abbr: string | null) => {
    setSelectedState(abbr);
    if (legacyLayout) {
      if (abbr) navigate(`/${species}/${abbr}`, { replace: true });
      else navigate(`/${species}`, { replace: true });
    } else {
      if (abbr) navigate(`/${abbr}`, { replace: true });
      else navigate('/', { replace: true });
    }
  }, [navigate, species, legacyLayout]);

  return (
    <DeckProvider
      species={species}
      setSpecies={handleSelectSpecies}
      selectedState={selectedState}
      setSelectedState={setSelectedStateWrapped}
    >
      <LayerProvider>
        <MapActionProvider
          flyTo={handleSelectState}
          flyToCoords={(lng, lat, zoom) => mapRef.current?.flyToCoords(lng, lat, zoom)}
          setMapMode={() => {}}
        >
          <div className="h-[100dvh] w-screen overflow-hidden relative">
            {/* Header */}
            <HeaderBarWithDeck
              species={species}
              onSelectSpecies={handleSelectSpecies}
              onSearch={handleSelectState}
              onSearchLocation={handleSearchLocation}
              onHelpOpen={helpModal.show}
            />

            {/* Main deck layout — below header */}
            <div className="fixed top-12 left-0 right-0 bottom-0 z-10">
              <ErrorBoundary fallback={
                <div className="flex items-center justify-center h-full w-full bg-background">
                  <p className="text-xs font-body text-white/40">Layout failed to load. Refresh to try again.</p>
                </div>
              }>
                {legacyLayout ? (
                  <DeckLayout
                    convergenceAlerts={convergenceAlerts}
                    weatherEventsGeoJSON={weatherEventsGeoJSON}
                    nwsAlertsGeoJSON={nwsAlertsGeoJSON}
                    huntAlerts={alerts}
                    murmurationIndex={murmurationIndex}
                  >
                    <MapWithLayers
                      mapRef={mapRef}
                      species={species}
                      selectedState={selectedState}
                      onSelectState={handleSelectState}
                      onDrillUp={handleDrillUp}
                      isMobile={isMobile}
                      weatherTiles={weatherTiles}
                      countyGeoJSON={countyGeoJSON}
                      sightingsGeoJSON={sightingsGeoJSON}
                      weatherCache={weatherCache}
                      convergenceScores={convergenceScoreMap}
                      perfectStormStates={perfectStormStates}
                      nwsAlertsGeoJSON={nwsAlertsGeoJSON}
                      migrationFrontLine={migrationFrontLine}
                      duPinsGeoJSON={duPinsGeoJSON}
                      weatherEventsGeoJSON={weatherEventsGeoJSON}
                      onMoveEnd={(center, zoom) => { setMapCenter(center); setMapZoom(zoom); }}
                    />
                  </DeckLayout>
                ) : (
                  <TerminalLayout
                    convergenceAlerts={convergenceAlerts}
                    weatherEventsGeoJSON={weatherEventsGeoJSON}
                    nwsAlertsGeoJSON={nwsAlertsGeoJSON}
                    huntAlerts={alerts}
                    murmurationIndex={murmurationIndex}
                    convergenceScores={convergenceScores}
                    stateArcs={stateArcs}
                    stateBrief={stateBrief}
                    briefLoading={briefLoading}
                    convergenceHistoryMap={convergenceHistoryMap}
                    stateConvergenceHistory={stateConvergenceHistory}
                    calibrationByState={calibrationByState}
                    onSelectState={handleSelectState}
                  >
                    <MapWithLayers
                      mapRef={mapRef}
                      species={species}
                      selectedState={selectedState}
                      onSelectState={handleSelectState}
                      onDrillUp={handleDrillUp}
                      isMobile={isMobile}
                      weatherTiles={weatherTiles}
                      countyGeoJSON={countyGeoJSON}
                      sightingsGeoJSON={sightingsGeoJSON}
                      weatherCache={weatherCache}
                      convergenceScores={convergenceScoreMap}
                      perfectStormStates={perfectStormStates}
                      nwsAlertsGeoJSON={nwsAlertsGeoJSON}
                      migrationFrontLine={migrationFrontLine}
                      duPinsGeoJSON={duPinsGeoJSON}
                      weatherEventsGeoJSON={weatherEventsGeoJSON}
                      onMoveEnd={(center, zoom) => { setMapCenter(center); setMapZoom(zoom); }}
                    />
                  </TerminalLayout>
                )}
              </ErrorBoundary>
            </div>

            {/* Help Modal */}
            <HelpModal open={helpModal.open} onClose={helpModal.close} />

            {/* Grain overlay */}
            <div className="grain-overlay" />
          </div>
        </MapActionProvider>
      </LayerProvider>
    </DeckProvider>
  );
};

/** Wrapper that connects HeaderBar to DeckContext toggles + renders WidgetManager slide-out */
function HeaderBarWithDeck(props: React.ComponentProps<typeof HeaderBar>) {
  const { toggleChat, toggleLayerPicker, togglePanelAdd } = useDeck();
  const { pathname } = useLocation();
  const isMapRoute = pathname.startsWith('/map');
  return (
    <>
      <HeaderBar
        {...props}
        onToggleLayers={isMapRoute ? toggleLayerPicker : undefined}
        onToggleChat={toggleChat}
        onTogglePanelAdd={isMapRoute ? togglePanelAdd : undefined}
      />
      <WidgetManager />
    </>
  );
}

/** Thin wrapper that reads LayerContext and passes layer state to MapView */
function MapWithLayers({
  mapRef,
  species,
  selectedState,
  onSelectState,
  onDrillUp,
  isMobile,
  weatherTiles,
  countyGeoJSON,
  sightingsGeoJSON,
  weatherCache,
  convergenceScores,
  perfectStormStates,
  nwsAlertsGeoJSON,
  migrationFrontLine,
  duPinsGeoJSON,
  weatherEventsGeoJSON,
  onMoveEnd,
}: any) {
  const { isSatellite, is3D, isLayerOn, visibleMapboxLayers } = useLayerContext();
  const { historyDate } = useDeck();
  const [elevation, setElevation] = useState<number | null>(null);
  const [historyScores, setHistoryScores] = useState<Map<string, { score: number; weather_component: number; migration_component: number; birdcast_component: number; solunar_component: number; pattern_component: number; reasoning?: string }> | null>(null);

  // Fetch historical convergence scores when historyDate changes
  useEffect(() => {
    if (!historyDate) {
      setHistoryScores(null);
      return;
    }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    let cancelled = false;
    fetch(
      `${supabaseUrl}/rest/v1/hunt_convergence_scores?select=state_abbr,score,weather_component,migration_component,birdcast_component,solunar_component,pattern_component,reasoning&date=eq.${historyDate}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    )
      .then(r => r.json())
      .then((rows: Array<{ state_abbr: string; score: number; weather_component: number; migration_component: number; birdcast_component: number; solunar_component: number; pattern_component: number; reasoning?: string }>) => {
        if (cancelled || !Array.isArray(rows)) return;
        const map = new Map<string, { score: number; weather_component: number; migration_component: number; birdcast_component: number; solunar_component: number; pattern_component: number; reasoning?: string }>();
        for (const row of rows) map.set(row.state_abbr, {
          score: row.score,
          weather_component: row.weather_component || 0,
          migration_component: row.migration_component || 0,
          birdcast_component: row.birdcast_component || 0,
          solunar_component: row.solunar_component || 0,
          pattern_component: row.pattern_component || 0,
          reasoning: row.reasoning,
        });
        setHistoryScores(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [historyDate]);

  // Use history scores when replaying, otherwise live
  const activeScores = historyScores ?? convergenceScores;

  return (
    <ErrorBoundary fallback={
      <div className="flex items-center justify-center h-full w-full bg-background">
        <p className="text-xs font-body text-white/40">Map failed to load. Refresh to try again.</p>
      </div>
    }>
      <MapView
        ref={mapRef}
        species={species}
        selectedState={selectedState}
        onSelectState={onSelectState}
        onDrillUp={onDrillUp}
        showFlyways={isLayerOn('flyway-corridors')}
        isSatellite={isSatellite}
        show3D={is3D}
        isMobile={isMobile}
        weatherTiles={weatherTiles}
        countyGeoJSON={countyGeoJSON}
        sightingsGeoJSON={sightingsGeoJSON}
        weatherCache={weatherCache}
        onMoveEnd={onMoveEnd}
        onElevation={setElevation}
        mapMode="intel"
        convergenceScores={activeScores}
        perfectStormStates={perfectStormStates}
        nwsAlertsGeoJSON={nwsAlertsGeoJSON}
        migrationFrontLine={migrationFrontLine}
        showRadar={isLayerOn('radar')}
        showDUPins={isLayerOn('du-pins')}
        duPinsGeoJSON={duPinsGeoJSON}
        weatherEventsGeoJSON={weatherEventsGeoJSON}
        visibleMapboxLayers={visibleMapboxLayers}
      />
      {/* Elevation HUD */}
      {is3D && elevation !== null && (
        <div className="absolute bottom-4 left-3 z-20 glass-panel rounded-lg px-3 py-1.5 border border-white/[0.06]">
          <span className="text-[10px] text-white/40 uppercase tracking-wider mr-1.5">Elev</span>
          <span className="text-xs text-white/80 font-body font-medium">{elevation.toLocaleString()}ft</span>
        </div>
      )}
    </ErrorBoundary>
  );
}

export default Index;

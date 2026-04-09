import { useState, useMemo, useEffect } from 'react';
import { useOpsData } from '@/hooks/useOpsData';
import { useStateArcs } from '@/hooks/useStateArcs';
import { useBrainActivity } from '@/hooks/useBrainActivity';
import { useConvergenceScores } from '@/hooks/useConvergenceScores';
import { useConvergenceHistoryAll } from '@/hooks/useConvergenceHistory';
import { useSignalFeed } from '@/hooks/useSignalFeed';
import { useMurmurationIndex } from '@/hooks/useMurmurationIndex';
import { useSolunar } from '@/hooks/useSolunar';
import { useNWSAlerts } from '@/hooks/useNWSAlerts';
import { useScoutReport } from '@/hooks/useScoutReport';
import { usePatternLinks } from '@/hooks/usePatternLinks';
import { useWeatherEvents } from '@/hooks/useWeatherEvents';
import { useDisasterWatch } from '@/hooks/useDisasterWatch';
import { useDataSourceHealth } from '@/hooks/useDataSourceHealth';
import { useBrainJournal } from '@/hooks/useBrainJournal';
import { useChat } from '@/hooks/useChat';
import { useTrackRecord } from '@/hooks/useTrackRecord';
import { useNationalWeather } from '@/hooks/useNationalWeather';

import IntelHeader from '@/components/intelligence/IntelHeader';
import LeftColumn from '@/components/intelligence/LeftColumn';
import CenterColumn from '@/components/intelligence/CenterColumn';
import RightColumn from '@/components/intelligence/RightColumn';
import ChatOverlay from '@/components/intelligence/ChatOverlay';

// ── Ticker (inline, lightweight) ──

const FC: Record<string, string> = {
  'compound-risk': '#f87171', weather: '#fb923c', convergence: '#22d3ee',
  nws: '#f87171', migration: '#60a5fa', anomaly: '#fbbf24',
  'disaster-watch': '#c084fc', correlation: '#34d399', 'weather-realtime': '#fb923c',
};

function Ticker({ items }: { items: Array<{ type: string; title: string; stateAbbr: string | null }> }) {
  if (items.length === 0) return (
    <div style={{ padding: '2px 0', borderBottom: '1px solid #1f293718', height: 18, display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
      <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#ffffff20' }}>No recent events</span>
    </div>
  );
  return (
    <div style={{ padding: '2px 0', borderBottom: '1px solid #1f293718', overflow: 'hidden', whiteSpace: 'nowrap', height: 18, display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'inline-flex', gap: 28, paddingLeft: 12, animation: 'tick 40s linear infinite' }}>
        {[...items, ...items].map((t, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8, fontFamily: 'monospace' }}>
            <span style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: FC[t.type] || '#ffffff30', flexShrink: 0 }} />
            {t.stateAbbr && <span style={{ color: '#22d3ee80', fontWeight: 600 }}>{t.stateAbbr}</span>}
            <span style={{ color: '#ffffff55' }}>{t.title}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Solunar data parser ──

function parseSolunar(data: Record<string, unknown> | null): { phase: string; major1: string; rating: number } | null {
  if (!data) return null;
  const sol = (data as any).solunar || data;
  if (!sol) return null;
  const phase = sol.moonPhase || sol.moon_phase || sol.phase || 'Unknown';
  const major1 = sol.majorFeedingStart || sol.major1 || sol.majorTimes?.[0] || '--:-- - --:--';
  const illumination = sol.moonIllumination ?? sol.illumination ?? 50;
  // Rating: 1-5 based on illumination proximity to full/new
  const rating = illumination > 80 || illumination < 20 ? 4 : illumination > 60 || illumination < 40 ? 3 : 2;
  return { phase, major1, rating };
}

// ── Main Page ──

export default function IntelligencePage() {
  const [selectedState, setSelectedState] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('state')?.toUpperCase() || null;
  });
  const [chatOpen, setChatOpen] = useState(false);

  // Data hooks
  const { data: opsData } = useOpsData();
  const { arcs } = useStateArcs();
  const { activity } = useBrainActivity();
  const { scores } = useConvergenceScores();
  const { historyMap } = useConvergenceHistoryAll(30);
  const { items: signalFeed } = useSignalFeed();
  const { data: migrationData } = useMurmurationIndex();
  const solunarQuery = useSolunar(32.0, -90.0); // central US coords for overview
  const { alertsGeoJSON } = useNWSAlerts();
  const { report } = useScoutReport();
  const { links: patternLinks } = usePatternLinks(selectedState);
  const { eventsGeoJSON } = useWeatherEvents();
  const { watches } = useDisasterWatch();
  const { sources, summary: sourceSummary } = useDataSourceHealth();
  const { entries: journalEntries } = useBrainJournal(selectedState, 'brain', 10);
  const { totalGraded, bySource } = useTrackRecord();
  const weatherMap = useNationalWeather();
  const { messages, loading: chatLoading, streaming, sendMessage } = useChat({ species: 'all', stateAbbr: selectedState });

  // Auto-select top state on first load so the page isn't empty
  useEffect(() => {
    if (!selectedState && scores.size > 0) {
      const top = Array.from(scores.values()).sort((a, b) => b.score - a.score)[0];
      if (top) setSelectedState(top.state_abbr);
    }
  }, [scores, selectedState]);

  // Ticker items from signal feed
  const tickerItems = useMemo(() =>
    signalFeed.slice(0, 15).map(s => ({ type: s.type, title: s.title, stateAbbr: s.stateAbbr })),
    [signalFeed]
  );

  // Migration prop
  const migration = migrationData ? {
    index: migrationData.index,
    change_pct: migrationData.change_pct,
    direction: migrationData.direction,
    active_states: migrationData.active_states,
  } : null;

  // Solunar prop
  const solunar = parseSolunar(solunarQuery.data as any);

  // Spark series for right column (top 5 states, 30-day)
  const sparkSeries = useMemo(() => {
    const top5 = Array.from(scores.values()).sort((a, b) => b.score - a.score).slice(0, 5);
    const out: Record<string, number[]> = {};
    for (const s of top5) {
      const data = historyMap.get(s.state_abbr);
      if (data && data.length >= 2) out[s.state_abbr] = data;
    }
    return out;
  }, [scores, historyMap]);

  function handleSelectState(abbr: string) {
    setSelectedState(prev => prev === abbr ? null : abbr);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: 'white', overflow: 'hidden', fontFamily: 'system-ui', position: 'relative' }}>

      <IntelHeader
        opsData={opsData}
        arcs={arcs}
        embeddingsToday={activity.totalEmbeddingsToday}
        selectedState={selectedState}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(o => !o)}
      />

      <Ticker items={tickerItems} />

      {/* 3-Column Grid */}
      <div className="intel-grid" style={{ display: 'grid', gridTemplateColumns: '210px 1fr 280px', height: 'calc(100vh - 50px)' }}>
        <LeftColumn
          scores={scores}
          arcs={arcs}
          historyMap={historyMap}
          selectedState={selectedState}
          onSelectState={handleSelectState}
          migration={migration}
          solunar={solunar}
          alertsGeoJSON={alertsGeoJSON}
        />
        <CenterColumn
          selectedState={selectedState}
          scores={scores}
          arcs={arcs}
          report={report}
          patternLinks={patternLinks}
          signalFeed={signalFeed}
          weatherEventsGeoJSON={eventsGeoJSON}
          recentCrons={activity.recentCrons}
          journalEntries={journalEntries}
        />
        <RightColumn
          selectedState={selectedState}
          scores={scores}
          sparkSeries={sparkSeries}
          weatherMap={weatherMap}
          watches={watches}
          totalGraded={totalGraded}
          bySource={bySource}
          sources={sources}
          sourceSummary={sourceSummary}
        />
      </div>

      {/* Chat Overlay */}
      {chatOpen && (
        <ChatOverlay
          messages={messages}
          loading={chatLoading}
          streaming={streaming}
          onSend={sendMessage}
          onClose={() => setChatOpen(false)}
        />
      )}

      <style>{`
        @keyframes tick { 0% { transform: translateX(0) } 100% { transform: translateX(-50%) } }
        * { box-sizing: border-box; margin: 0; }
        button { font: inherit; }
        ::-webkit-scrollbar { width: 2px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 1px; }
        input::placeholder { color: #ffffff20; }

        @media (max-width: 768px) {
          .intel-grid {
            grid-template-columns: 1fr !important;
            height: auto !important;
            overflow-y: auto !important;
          }
          .intel-grid > div {
            border-right: none !important;
            border-left: none !important;
            max-height: none !important;
            overflow-y: visible !important;
          }
        }
      `}</style>
    </div>
  );
}

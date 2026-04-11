import { useState } from 'react';
import FusionWeb, { DM } from './FusionWeb';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';
import type { ScoutReport } from '@/hooks/useScoutReport';
import type { PatternLink } from '@/hooks/usePatternLinks';
import type { SignalItem } from '@/hooks/useSignalFeed';
import type { FeatureCollection } from 'geojson';

const FC: Record<string, string> = {
  'compound-risk': '#f87171', weather: '#fb923c', convergence: '#22d3ee',
  nws: '#f87171', migration: '#60a5fa', anomaly: '#fbbf24',
  'disaster-watch': '#c084fc', correlation: '#34d399', 'weather-realtime': '#fb923c',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderBold(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((p, i) => i % 2 === 1 ? <strong key={i} style={{ color: '#22d3ee' }}>{p}</strong> : <span key={i}>{p}</span>);
}

function getDomains(score: ConvergenceScore): Record<string, number> {
  return {
    weather: score.weather_component,
    migration: score.migration_component,
    birdcast: score.birdcast_component,
    solunar: score.solunar_component,
    water: score.water_component,
    pattern: score.pattern_component,
    photo: score.photoperiod_component,
    tide: score.tide_component,
  };
}

function timeDiff(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return `${d}d ${h}h`;
}

interface CenterColumnProps {
  selectedState: string | null;
  scores: Map<string, ConvergenceScore>;
  arcs: StateArc[];
  report: ScoutReport | null;
  patternLinks: PatternLink[];
  signalFeed: SignalItem[];
  weatherEventsGeoJSON: FeatureCollection | null;
  recentCrons: Array<{ function_name: string; status: string; created_at: string; summary: Record<string, any> | null }>;
  journalEntries: Array<{ title: string; content_type: string; created_at: string }>;
}

export default function CenterColumn({
  selectedState, scores, arcs, report, patternLinks, signalFeed, weatherEventsGeoJSON, recentCrons, journalEntries,
}: CenterColumnProps) {
  const [feedFilter, setFeedFilter] = useState<'all' | 'critical' | 'state'>('all');
  const stateScore = selectedState ? scores.get(selectedState) : null;
  const stateArc = selectedState ? arcs.find(a => a.state_abbr === selectedState) : null;
  const domains = stateScore ? getDomains(stateScore) : {};

  // Outcome arcs
  const outcomeArcs = arcs
    .filter(a => a.current_act === 'outcome')
    .map(a => ({ ...a, score: scores.get(a.state_abbr)?.score || 0 }))
    .sort((a, b) => b.score - a.score);

  // Filtered feed
  const filteredFeed = signalFeed.filter(item => {
    if (feedFilter === 'critical') return item.severity === 'high';
    if (feedFilter === 'state') return item.stateAbbr === selectedState;
    return true;
  });

  // METAR events from GeoJSON
  const metarEvents = (weatherEventsGeoJSON?.features || []).slice(0, 10).map(f => {
    const p = f.properties || {};
    return {
      station: p.station || '',
      st: (p.station || '').slice(1, 3), // rough state
      event: p.eventType || '',
      severity: p.severity || 'low',
      time: formatTime(p.timestamp || ''),
    };
  });

  return (
    <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

      {/* Scout brief — truncated to ~2 sentences */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #1f2937', backgroundColor: '#060b1430' }}>
        {report ? (
          <p style={{ fontSize: 9, fontFamily: "'Georgia',serif", color: '#ffffff55', lineHeight: 1.5, margin: 0 }}>
            {(() => {
              const sentences = report.brief_text.split(/(?<=[.!?])\s+/);
              const truncated = sentences.slice(0, 3).join(' ');
              return truncated.length < report.brief_text.length ? truncated + ' …' : truncated;
            })()}
          </p>
        ) : (
          <p style={{ fontSize: 9, fontFamily: 'monospace', color: '#ffffff15', margin: 0 }}>Awaiting daily brief...</p>
        )}
      </div>

      {/* Focus story */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>
        {selectedState && stateScore ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20, fontFamily: 'monospace', fontWeight: 800, color: '#22d3ee' }}>{selectedState}</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#ffffff20' }}>{stateScore.score}/120</span>
              {stateArc && (
                <>
                  <div style={{ flex: 1, display: 'flex', gap: 2 }}>
                    {(['buildup', 'recognition', 'outcome', 'grade'] as const).map((a, i) => {
                      const idx = ['buildup', 'recognition', 'outcome', 'grade'].indexOf(stateArc.current_act);
                      const cols: Record<string, string> = { buildup: '#fbbf24', recognition: '#fb923c', outcome: '#f87171', grade: '#34d399' };
                      return <div key={a} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < idx ? '#34d399' : i === idx ? cols[a] : '#ffffff06' }} />;
                    })}
                  </div>
                  {stateArc.outcome_deadline && (
                    <>
                      <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#ffffff15' }}>DEADLINE</span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#34d399' }}>{timeDiff(stateArc.outcome_deadline)}</span>
                    </>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 10 }}>
              <div style={{ backgroundColor: '#060b14', borderRadius: 6, border: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FusionWeb domains={domains} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Brain Recognition */}
                <div style={{ background: 'linear-gradient(135deg,#0c1322,#111827)', border: '1px solid #1e3a5f', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#22d3ee60', letterSpacing: 2, marginBottom: 4 }}>THE BRAIN RECOGNIZES</div>
                  {stateArc?.narrative ? (
                    <p style={{ fontSize: 10, fontFamily: "'Georgia',serif", color: '#ffffffa0', lineHeight: 1.55, margin: 0, fontStyle: 'italic' }}>
                      "{renderBold(stateArc.narrative)}"
                    </p>
                  ) : (
                    <p style={{ fontSize: 9, fontFamily: 'monospace', color: '#ffffff20', margin: 0 }}>Narrator hasn't processed this arc yet</p>
                  )}
                  {stateArc?.precedent_accuracy != null && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 60, height: 3, backgroundColor: '#ffffff06', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${stateArc.precedent_accuracy}%`, height: '100%', backgroundColor: '#34d399', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#34d399', fontWeight: 700 }}>{stateArc.precedent_accuracy}%</span>
                      <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff15' }}>accuracy on pattern</span>
                    </div>
                  )}
                </div>

                {/* Live Signals */}
                {journalEntries.slice(0, 4).map((sig, i) => {
                  const dm = DM[sig.content_type] || DM.weather;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, fontFamily: 'monospace' }}>
                      <span style={{ color: '#ffffff12', width: 26, textAlign: 'right' }}>{formatTime(sig.created_at)}</span>
                      <span style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: `${(dm?.c || '#fff')}10`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: dm?.c || '#fff', fontWeight: 700 }}>{dm?.i || '?'}</span>
                      <span style={{ color: '#ffffff55', lineHeight: 1.3 }}>{sig.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#ffffff20' }}>Select a state from the rankings</span>
          </div>
        )}
      </div>

      {/* Middle row: Patterns + Outcome Windows */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #1f2937' }}>
        {/* Patterns */}
        <div style={{ padding: '8px 12px', borderRight: '1px solid #1f2937' }}>
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#c084fc50', letterSpacing: 2, marginBottom: 5 }}>CROSS-DOMAIN CONNECTIONS</div>
          {patternLinks.length === 0 && (
            <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>
              {selectedState ? `No patterns for ${selectedState} (72h)` : 'Select a state'}
            </div>
          )}
          {patternLinks.slice(0, 4).map((p, i) => (
            <div key={i} style={{ marginBottom: 4, padding: '4px 6px', backgroundColor: '#0a0f1a', borderRadius: 4, border: '1px solid #c084fc08' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#22d3ee', fontWeight: 700 }}>{p.state_abbr}</span>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#c084fc' }}>{Math.round(p.similarity * 100)}%</span>
              </div>
              <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff35', lineHeight: 1.3 }}>
                {p.source_content_type.replace(/-/g, ' ')} &rarr; {p.matched_content_type.replace(/-/g, ' ')}
              </span>
            </div>
          ))}
        </div>
        {/* Outcome Windows */}
        <div style={{ padding: '8px 12px' }}>
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#f8717160', letterSpacing: 2, marginBottom: 5 }}>OUTCOME WINDOWS &mdash; BRAIN GRADING</div>
          {outcomeArcs.length === 0 && (
            <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>No states in outcome phase</div>
          )}
          {outcomeArcs.slice(0, 8).map((o, i) => {
            const signals = Array.isArray(o.outcome_signals) ? o.outcome_signals.length : 0;
            const needed = 2; // standard threshold
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3, fontSize: 8, fontFamily: 'monospace' }}>
                <span style={{ color: '#ffffffa0', fontWeight: 700, width: 18 }}>{o.state_abbr}</span>
                <span style={{ color: '#ffffff20', width: 16, textAlign: 'right' }}>{o.score}</span>
                <div style={{ flex: 1, height: 3, backgroundColor: '#ffffff06', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min((signals / needed) * 100, 100)}%`, height: '100%', backgroundColor: signals >= needed ? '#34d399' : '#fbbf24', borderRadius: 2 }} />
                </div>
                <span style={{ color: '#ffffff20', width: 20 }}>{signals}/{needed}</span>
                {o.outcome_deadline && (
                  <span style={{ color: '#34d399', fontWeight: 600, width: 40, textAlign: 'right' }}>{timeDiff(o.outcome_deadline)}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom row: Live Feed + METAR + Brain Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', flex: 1, minHeight: 0 }}>
        {/* Live Feed */}
        <div style={{ padding: '6px 12px', borderRight: '1px solid #1f2937', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2 }}>LIVE FEED</span>
            <div style={{ display: 'flex', gap: 2 }}>
              {(['all', 'critical', 'state'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFeedFilter(f)}
                  style={{
                    fontSize: 6, fontFamily: 'monospace', padding: '1px 4px', borderRadius: 2, cursor: 'pointer',
                    border: feedFilter === f ? '1px solid #22d3ee30' : '1px solid transparent',
                    backgroundColor: feedFilter === f ? '#22d3ee08' : 'transparent',
                    color: feedFilter === f ? '#22d3ee' : '#ffffff20',
                  }}
                >
                  {f === 'state' ? selectedState || 'STATE' : f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredFeed.map((f, i) => (
              <div key={f.id || i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2.5px 0', borderBottom: '1px solid #ffffff04', fontSize: 8, fontFamily: 'monospace' }}>
                <span style={{ color: '#ffffff12', width: 26, textAlign: 'right' }}>{formatTime(f.timestamp)}</span>
                <span style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: FC[f.type] || '#fff', flexShrink: 0 }} />
                <span style={{ color: '#22d3ee', fontWeight: 600, width: 16 }}>{f.stateAbbr || '--'}</span>
                <span style={{ color: '#ffffff50', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
              </div>
            ))}
            {filteredFeed.length === 0 && (
              <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12', padding: '8px 0' }}>No events</div>
            )}
          </div>
        </div>

        {/* METAR + Brain Activity */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* METAR */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937', flex: 1 }}>
            <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#fb923c40', letterSpacing: 2, marginBottom: 4 }}>METAR EVENTS</div>
            {metarEvents.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 7, fontFamily: 'monospace', marginBottom: 2 }}>
                <span style={{ color: '#ffffff12', width: 24, textAlign: 'right' }}>{m.time}</span>
                <span style={{ color: '#fb923c80', width: 30 }}>{m.station}</span>
                <span style={{ color: '#ffffff35', flex: 1 }}>{m.event}</span>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  backgroundColor: m.severity === 'high' ? '#f87171' : m.severity === 'medium' ? '#fbbf24' : '#ffffff15',
                }} />
              </div>
            ))}
            {metarEvents.length === 0 && (
              <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>No recent METAR events</div>
            )}
          </div>
          {/* Brain Activity */}
          <div style={{ padding: '6px 10px', flex: 1 }}>
            <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#22d3ee30', letterSpacing: 2, marginBottom: 4 }}>BRAIN ACTIVITY &mdash; CRONS</div>
            {recentCrons.slice(0, 8).map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 7, fontFamily: 'monospace', marginBottom: 2 }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: b.status === 'ok' ? '#34d399' : '#f87171' }} />
                <span style={{ color: '#ffffff40', flex: 1 }}>{b.function_name.replace('hunt-', '')}</span>
                <span style={{ color: '#22d3ee50' }}>{b.summary?.embeddings_created ?? b.summary?.items_processed ?? '--'}</span>
                <span style={{ color: '#ffffff15' }}>{formatTime(b.created_at)}</span>
              </div>
            ))}
            {recentCrons.length === 0 && (
              <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>No cron activity today</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

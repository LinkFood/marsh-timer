import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';
import type { FeatureCollection } from 'geojson';
import { DM } from './FusionWeb';

// ── Sparkline ──
const Spark = ({ data, color, w = 36, h = 10 }: { data: number[]; color: string; w?: number; h?: number }) => {
  if (!data || data.length < 2) return null;
  const mx = Math.max(...data), mn = Math.min(...data), rg = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rg) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" />
      <circle cx={w} cy={h - ((data[data.length - 1] - mn) / rg) * h} r="1.5" fill={color} />
    </svg>
  );
};

function scoreColor(sc: number): string {
  if (sc >= 75) return '#f87171';
  if (sc >= 70) return '#fbbf24';
  if (sc >= 65) return '#22d3ee';
  return '#ffffff28';
}

function getActiveDomains(entry: ConvergenceScore): string[] {
  const active: string[] = [];
  if (entry.weather_component > 0) active.push('weather');
  if (entry.migration_component > 0) active.push('migration');
  if (entry.birdcast_component > 0) active.push('birdcast');
  if (entry.solunar_component > 0) active.push('solunar');
  if (entry.water_component > 0) active.push('water');
  if (entry.pattern_component > 0) active.push('pattern');
  if (entry.photoperiod_component > 0) active.push('photo');
  if (entry.tide_component > 0) active.push('tide');
  return active;
}

// ── Extract state abbr from NWS areaDesc ──
const STATE_ABBRS_SET = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']);

function extractStateFromArea(areaDesc: string): string {
  // NWS areaDesc format: "County, ST; County, ST"
  const match = areaDesc.match(/,\s*([A-Z]{2})/);
  if (match && STATE_ABBRS_SET.has(match[1])) return match[1];
  return '??';
}

interface LeftColumnProps {
  scores: Map<string, ConvergenceScore>;
  arcs: StateArc[];
  historyMap: Map<string, number[]>;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
  migration: { index: number; change_pct: number; direction: string; active_states: number } | null;
  solunar: { phase: string; major1: string; rating: number } | null;
  alertsGeoJSON: FeatureCollection | null;
}

export default function LeftColumn({ scores, arcs, historyMap, selectedState, onSelectState, migration, solunar, alertsGeoJSON }: LeftColumnProps) {
  // Sort all states by score desc
  const ranked = Array.from(scores.values()).sort((a, b) => b.score - a.score);

  // NWS alerts — extract 3 most recent
  const nwsAlerts = (alertsGeoJSON?.features || []).slice(0, 3).map(f => {
    const p = f.properties || {};
    const st = extractStateFromArea(p.areaDesc || '');
    const counties = (p.areaDesc || '').split(';').length;
    return { st, ev: p.event || '', co: counties };
  });

  return (
    <div style={{ borderRight: '1px solid #1f2937', overflowY: 'auto', backgroundColor: '#04080f', display: 'flex', flexDirection: 'column', fontSize: 0 }}>

      {/* Migration + Solunar row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #1f2937' }}>
        <div style={{ padding: '6px 8px', borderRight: '1px solid #1f293780' }}>
          <div style={{ fontSize: 6, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2, marginBottom: 2 }}>MIGRATION</div>
          {migration ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 800, color: '#60a5fa' }}>{migration.index.toFixed(1)}</span>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: migration.change_pct >= 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
                  {migration.change_pct >= 0 ? '+' : ''}{migration.change_pct.toFixed(1)}%
                </span>
              </div>
              <div style={{ fontSize: 6, fontFamily: 'monospace', color: '#60a5fa50' }}>{migration.active_states} states &middot; {migration.direction}</div>
            </>
          ) : (
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#ffffff15' }}>--</div>
          )}
        </div>
        <div style={{ padding: '6px 8px' }}>
          <div style={{ fontSize: 6, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2, marginBottom: 2 }}>SOLUNAR</div>
          {solunar ? (
            <>
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#fbbf24', fontWeight: 600 }}>{solunar.phase}</div>
              <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#fbbf2460' }}>Major {solunar.major1}</div>
              <div style={{ display: 'flex', gap: 1, marginTop: 2 }}>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} style={{ width: 3, height: 8, borderRadius: 1, backgroundColor: i <= solunar.rating ? '#fbbf24' : '#ffffff06' }} />
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#ffffff15' }}>--</div>
          )}
        </div>
      </div>

      {/* Rankings header */}
      <div style={{ padding: '5px 8px', borderBottom: '1px solid #1f293730', display: 'flex', justifyContent: 'space-between', position: 'sticky', top: 0, backgroundColor: '#04080f', zIndex: 5 }}>
        <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2 }}>CONVERGENCE</span>
        <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#22d3ee40' }}>{arcs.length}</span>
      </div>

      {/* State list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {ranked.map((s, idx) => {
          const isSel = selectedState === s.state_abbr;
          const sc = scoreColor(s.score);
          const domains = getActiveDomains(s);
          const sparkData = historyMap.get(s.state_abbr);

          return (
            <button
              key={s.state_abbr}
              onClick={() => onSelectState(s.state_abbr)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 3,
                padding: '3px 8px', border: 'none', cursor: 'pointer',
                backgroundColor: isSel ? '#22d3ee06' : 'transparent',
                borderLeft: isSel ? '2px solid #22d3ee' : '2px solid transparent',
                height: 22, fontFamily: 'inherit',
              }}
            >
              <span style={{ width: 10, fontSize: 7, fontFamily: 'monospace', color: '#ffffff10', textAlign: 'right' }}>{idx + 1}</span>
              <span style={{ width: 18, fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: isSel ? '#22d3ee' : '#ffffff90' }}>{s.state_abbr}</span>
              <div style={{ display: 'flex', gap: 1, flex: 1 }}>
                {Object.keys(DM).map(d => (
                  <div
                    key={d}
                    style={{
                      width: 8, height: 3.5, borderRadius: 1,
                      backgroundColor: domains.includes(d) ? DM[d].c : '#ffffff04',
                      opacity: domains.includes(d) ? 0.65 : 1,
                    }}
                  />
                ))}
              </div>
              {sparkData && sparkData.length >= 2 && <Spark data={sparkData} color={sc} />}
              <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: sc, width: 20, textAlign: 'right' }}>{s.score}</span>
            </button>
          );
        })}
      </div>

      {/* NWS Alerts */}
      <div style={{ borderTop: '1px solid #1f2937', padding: '5px 8px' }}>
        <div style={{ fontSize: 6, fontFamily: 'monospace', color: '#f8717150', letterSpacing: 2, marginBottom: 3 }}>NWS ALERTS</div>
        {nwsAlerts.length === 0 && (
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>No active severe alerts</div>
        )}
        {nwsAlerts.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, fontSize: 7, fontFamily: 'monospace', marginBottom: 1 }}>
            <span style={{ color: '#f87171', fontWeight: 700, width: 14 }}>{a.st}</span>
            <span style={{ color: '#ffffff40', flex: 1 }}>{a.ev}</span>
            <span style={{ color: '#ffffff12' }}>{a.co}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

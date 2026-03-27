import { DM } from './FusionWeb';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { DisasterWatch } from '@/hooks/useDisasterWatch';
import type { DataSourceStatus } from '@/hooks/useDataSourceHealth';
import type { StateWeather } from '@/hooks/useNationalWeather';

// ── MultiSpark ──
const MultiSpark = ({ series, w = 240, h = 50 }: { series: Record<string, number[]>; w?: number; h?: number }) => {
  const allVals = Object.values(series).flat();
  if (allVals.length === 0) return null;
  const mx = Math.max(...allVals), mn = Math.min(...allVals), rg = mx - mn || 1;
  const COLORS: Record<string, string> = {};
  const keys = Object.keys(series);
  const palette = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#c084fc'];
  keys.forEach((k, i) => { COLORS[k] = palette[i % palette.length]; });

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      {keys.map(key => {
        const data = series[key];
        if (!data || data.length < 2) return null;
        const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rg) * h}`).join(' ');
        return <polyline key={key} points={pts} fill="none" stroke={COLORS[key]} strokeWidth="1" opacity="0.7" />;
      })}
    </svg>
  );
};

function getDomainEntries(score: ConvergenceScore): Array<{ key: string; value: number }> {
  return [
    { key: 'weather', value: score.weather_component },
    { key: 'migration', value: score.migration_component },
    { key: 'birdcast', value: score.birdcast_component },
    { key: 'solunar', value: score.solunar_component },
    { key: 'water', value: score.water_component },
    { key: 'pattern', value: score.pattern_component },
    { key: 'photo', value: score.photoperiod_component },
    { key: 'tide', value: score.tide_component },
  ].filter(d => d.value > 0);
}

interface RightColumnProps {
  selectedState: string | null;
  scores: Map<string, ConvergenceScore>;
  sparkSeries: Record<string, number[]>;
  weatherMap: Map<string, StateWeather>;
  watches: DisasterWatch[];
  totalGraded: number;
  bySource: Array<{ source: string; total: number; accuracy: number }>;
  sources: DataSourceStatus[];
  sourceSummary: { total: number; online: number; error: number };
}

export default function RightColumn({
  selectedState, scores, sparkSeries, weatherMap, watches, totalGraded, bySource, sources, sourceSummary,
}: RightColumnProps) {
  const stateScore = selectedState ? scores.get(selectedState) : null;
  const domainEntries = stateScore ? getDomainEntries(stateScore) : [];

  // Top 4 states for weather
  const topStates = Array.from(scores.values()).sort((a, b) => b.score - a.score).slice(0, 4);
  const topWeather = topStates.map(s => ({ st: s.state_abbr, wx: weatherMap.get(s.state_abbr) })).filter(w => w.wx);

  return (
    <div style={{ borderLeft: '1px solid #1f2937', overflowY: 'auto', backgroundColor: '#060b14' }}>

      {/* Components */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2937' }}>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2, marginBottom: 5 }}>
          {selectedState || '--'} &mdash; COMPONENTS
        </div>
        {domainEntries.length === 0 && (
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>Select a state</div>
        )}
        {domainEntries.map(({ key, value }) => {
          const dm = DM[key];
          if (!dm) return null;
          const pct = value / dm.m;
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2.5, fontSize: 7, fontFamily: 'monospace' }}>
              <span style={{ width: 44, color: '#ffffff30', textAlign: 'right' }}>{dm.l}</span>
              <div style={{ flex: 1, height: 3, backgroundColor: '#ffffff05', borderRadius: 1.5, overflow: 'hidden' }}>
                <div style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: dm.c, borderRadius: 1.5 }} />
              </div>
              <span style={{ width: 26, textAlign: 'right', color: pct >= 0.8 ? '#34d399' : '#ffffff30', fontWeight: pct >= 0.8 ? 700 : 400 }}>
                {value}/{dm.m}
              </span>
            </div>
          );
        })}
      </div>

      {/* 30-day multi-state chart */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2937' }}>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2, marginBottom: 5 }}>30-DAY CONVERGENCE &mdash; TOP 5</div>
        {Object.keys(sparkSeries).length > 0 ? (
          <div style={{ backgroundColor: '#0a0f1a', borderRadius: 5, border: '1px solid #1f2937', padding: '6px 8px' }}>
            <MultiSpark series={sparkSeries} w={240} h={50} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 6, fontFamily: 'monospace', color: '#ffffff12' }}>
              <span>30d ago</span><span>15d</span><span>Today</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {Object.keys(sparkSeries).map((k, i) => {
                const palette = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#c084fc'];
                const c = palette[i % palette.length];
                return (
                  <span key={k} style={{ fontSize: 7, fontFamily: 'monospace', color: c, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ width: 6, height: 2, backgroundColor: c, borderRadius: 1 }} />{k}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>Loading...</div>
        )}
      </div>

      {/* Weather */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2937' }}>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2, marginBottom: 5 }}>CONDITIONS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
          {topWeather.map(({ st, wx }) => {
            if (!wx) return null;
            const trendSymbol = wx.pressureTrend === 'falling' ? '\u2193' : wx.pressureTrend === 'rising' ? '\u2191' : '\u2014';
            const trendColor = wx.pressureTrend === 'falling' ? '#f87171' : wx.pressureTrend === 'rising' ? '#34d399' : '#ffffff15';
            return (
              <div key={st} style={{ backgroundColor: '#0a0f1a', borderRadius: 3, padding: '4px 6px', border: st === selectedState ? '1px solid #22d3ee20' : '1px solid #ffffff04' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: '#ffffff90' }}>{st}</span>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: wx.temp > 50 ? '#fbbf24' : '#38bdf8' }}>{Math.round(wx.temp)}&deg;</span>
                </div>
                <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff20', display: 'flex', gap: 4 }}>
                  <span>{Math.round(wx.wind)}mph</span>
                  <span>{Math.round(wx.pressure)}</span>
                  <span style={{ color: trendColor }}>{trendSymbol}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Disaster Watch */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2937' }}>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#c084fc40', letterSpacing: 2, marginBottom: 5 }}>DISASTER WATCH</div>
        {watches.length === 0 && (
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>No active watches</div>
        )}
        {watches.slice(0, 3).map((d, i) => {
          const conf = d.metadata?.confidence ?? 0;
          const type = d.metadata?.disaster_type || d.title;
          return (
            <div key={i} style={{ backgroundColor: '#0a0f1a', borderRadius: 4, border: '1px solid #c084fc08', padding: '5px 8px', marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#c084fc', fontWeight: 600 }}>{type}</span>
                <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff12' }}>{conf}%</span>
              </div>
              {d.metadata?.lead_time && (
                <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff25' }}>{d.state_abbr || 'Multi'} &middot; {d.metadata.lead_time}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Track Record */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2937' }}>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2, marginBottom: 5 }}>TRACK RECORD</div>
        {totalGraded < 10 ? (
          <div style={{ backgroundColor: '#0a0f1a', borderRadius: 4, border: '1px solid #1f2937', padding: 6, textAlign: 'center' }}>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#fbbf24', fontStyle: 'italic' }}>Learning...</span>
            <div style={{ width: '100%', height: 2, backgroundColor: '#ffffff05', borderRadius: 1, marginTop: 3 }}>
              <div style={{ width: `${(totalGraded / 10) * 100}%`, height: '100%', backgroundColor: '#fbbf24' }} />
            </div>
            <span style={{ fontSize: 6, fontFamily: 'monospace', color: '#ffffff0d', display: 'block', marginTop: 2 }}>{totalGraded}/10 grades needed</span>
          </div>
        ) : (
          <div>
            {bySource.slice(0, 4).map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2, fontSize: 7, fontFamily: 'monospace' }}>
                <span style={{ width: 60, color: '#ffffff30', textAlign: 'right' }}>{s.source.replace('hunt-', '').replace(/-/g, ' ')}</span>
                <div style={{ flex: 1, height: 3, backgroundColor: '#ffffff05', borderRadius: 1.5, overflow: 'hidden' }}>
                  <div style={{ width: `${s.accuracy}%`, height: '100%', backgroundColor: s.accuracy >= 60 ? '#34d399' : '#fbbf24', borderRadius: 1.5 }} />
                </div>
                <span style={{ width: 22, textAlign: 'right', color: s.accuracy >= 60 ? '#34d399' : '#fbbf24', fontWeight: 700 }}>{s.accuracy}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Data Sources */}
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: '#ffffff18', letterSpacing: 2, marginBottom: 5 }}>
          SOURCES &mdash; {sourceSummary.online}/{sourceSummary.total}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {sources.map(d => {
            const ok = d.status === 'online' || d.status === 'static';
            return (
              <span
                key={d.name}
                style={{
                  fontSize: 6, fontFamily: 'monospace', padding: '1.5px 3px', borderRadius: 1.5,
                  backgroundColor: ok ? '#34d39906' : '#f8717106',
                  border: `1px solid ${ok ? '#34d39912' : '#f8717112'}`,
                  color: ok ? '#34d39960' : '#f8717160',
                  display: 'flex', alignItems: 'center', gap: 2,
                }}
              >
                <span style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: ok ? '#34d399' : '#f87171' }} />
                {d.name}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

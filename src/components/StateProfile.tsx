import { useMemo } from 'react';
import type { Species } from '@/data/types';
import { getSeasonsByState } from '@/data/seasons';
import { ArrowLeft, Wind, Droplets, Thermometer, TrendingUp, Calendar, AlertTriangle, Shield } from 'lucide-react';
import Sparkline from '@/components/charts/Sparkline';
import StackedArea from '@/components/charts/StackedArea';
import { useConvergenceHistory } from '@/hooks/useConvergenceHistory';
import { useStateWeather } from '@/hooks/useStateWeather';
import { useStateForecast } from '@/hooks/useStateForecast';

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

function weatherEmoji(code: number): string {
  if (code <= 1) return '\u2600\uFE0F';
  if (code <= 3) return '\u26C5';
  if (code >= 45 && code <= 48) return '\uD83C\uDF2B\uFE0F';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '\uD83C\uDF27\uFE0F';
  if (code >= 71 && code <= 77) return '\uD83C\uDF28\uFE0F';
  if (code >= 95 && code <= 99) return '\u26C8\uFE0F';
  return '\u2600\uFE0F';
}

function seasonStatus(dates: Array<{ open: string; close: string }>): { label: string; color: string } {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  for (const d of dates) {
    if (today >= d.open && today <= d.close) return { label: 'OPEN', color: 'text-green-400' };
  }

  // Find next opening
  const upcoming = dates
    .filter(d => d.open > today)
    .sort((a, b) => a.open.localeCompare(b.open));

  if (upcoming.length > 0) {
    const daysUntil = Math.ceil((new Date(upcoming[0].open).getTime() - now.getTime()) / 86400000);
    if (daysUntil <= 30) return { label: `OPENS IN ${daysUntil}d`, color: 'text-amber-400' };
    return { label: `OPENS ${new Date(upcoming[0].open).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, color: 'text-white/40' };
  }

  return { label: 'CLOSED', color: 'text-red-400' };
}

interface DisasterWatch {
  id: string;
  title: string;
  content: string;
  metadata: { confidence?: number; pattern_type?: string; [key: string]: any } | null;
  created_at: string;
}

interface StateProfileProps {
  stateAbbr: string;
  species: Species;
  convergenceScore: {
    score: number;
    weather_component: number;
    solunar_component: number;
    migration_component: number;
    pattern_component: number;
    national_rank: number;
    reasoning: string;
    birdcast_component?: number;
    water_component?: number;
    photoperiod_component?: number;
    tide_component?: number;
  } | null;
  convergenceAlerts: Array<{
    state_abbr: string;
    alert_type: string;
    reasoning: string;
    previous_score: number;
    score: number;
    created_at: string;
  }>;
  disasterWatches?: DisasterWatch[];
  onBack: () => void;
  isMobile: boolean;
}

// ─── Weather History Chart ───────────────────────────────────
function WeatherHistoryChart({ stateAbbr }: { stateAbbr: string }) {
  const { data, loading } = useStateWeather(stateAbbr);

  if (loading) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Thermometer size={14} className="text-orange-400" />
          <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">30-DAY WEATHER</span>
        </div>
        <div className="animate-pulse h-[160px] bg-white/[0.04] rounded" />
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Thermometer size={14} className="text-orange-400" />
          <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">30-DAY WEATHER</span>
        </div>
        <p className="text-[11px] text-white/20 text-center py-8">No weather history available</p>
      </div>
    );
  }

  const width = 600;
  const height = 180;
  const padL = 36;
  const padR = 8;
  const padT = 12;
  const padB = 24;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Ranges
  const allTemps = data.flatMap(d => [d.temp_high_f, d.temp_low_f]);
  const tempMin = Math.min(...allTemps);
  const tempMax = Math.max(...allTemps);
  const tempRange = tempMax - tempMin || 1;

  const winds = data.map(d => d.wind_speed_avg_mph);
  const windMax = Math.max(...winds, 1);

  const pressures = data.map(d => d.pressure_avg_msl);
  const pressMin = Math.min(...pressures);
  const pressMax = Math.max(...pressures);
  const pressRange = pressMax - pressMin || 1;

  function xPos(i: number): number {
    return padL + (i / (data.length - 1)) * chartW;
  }

  function tempY(v: number): number {
    return padT + (1 - (v - tempMin) / tempRange) * chartH;
  }

  function windY(v: number): number {
    return padT + (1 - v / windMax) * chartH;
  }

  function pressY(v: number): number {
    return padT + (1 - (v - pressMin) / pressRange) * chartH;
  }

  // Temperature area (shaded between high and low)
  const tempAreaPath = data.map((d, i) => `${xPos(i)},${tempY(d.temp_high_f)}`).join(' L ')
    + ' L ' + [...data].reverse().map((d, i) => `${xPos(data.length - 1 - i)},${tempY(d.temp_low_f)}`).join(' L ');

  const windLine = data.map((d, i) => `${xPos(i)},${windY(d.wind_speed_avg_mph)}`).join(' ');
  const pressLine = data.map((d, i) => `${xPos(i)},${pressY(d.pressure_avg_msl)}`).join(' ');

  // X labels
  const xLabels: Array<{ i: number; label: string }> = [];
  if (data.length > 0) {
    xLabels.push({ i: 0, label: new Date(data[0].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
    if (data.length > 2) {
      const mid = Math.floor(data.length / 2);
      xLabels.push({ i: mid, label: new Date(data[mid].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
    }
    xLabels.push({ i: data.length - 1, label: new Date(data[data.length - 1].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
  }

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Thermometer size={14} className="text-orange-400" />
        <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">30-DAY WEATHER</span>
      </div>

      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* Grid lines */}
        {[0, 0.5, 1].map(frac => (
          <line key={frac} x1={padL} x2={width - padR} y1={padT + frac * chartH} y2={padT + frac * chartH} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
        ))}

        {/* Temp area */}
        <path d={`M ${tempAreaPath} Z`} fill="#f97316" opacity={0.15} />

        {/* Temp high line */}
        <polyline points={data.map((d, i) => `${xPos(i)},${tempY(d.temp_high_f)}`).join(' ')} fill="none" stroke="#f97316" strokeWidth={1.5} strokeLinecap="round" />

        {/* Temp low line */}
        <polyline points={data.map((d, i) => `${xPos(i)},${tempY(d.temp_low_f)}`).join(' ')} fill="none" stroke="#f97316" strokeWidth={1} strokeDasharray="3,2" strokeLinecap="round" opacity={0.6} />

        {/* Wind line */}
        <polyline points={windLine} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeLinecap="round" />

        {/* Pressure line */}
        <polyline points={pressLine} fill="none" stroke="#a855f7" strokeWidth={1.5} strokeLinecap="round" />

        {/* Y axis labels - temp */}
        <text x={padL - 4} y={padT + 4} textAnchor="end" fill="#f97316" fontSize={8} fontFamily="monospace">{Math.round(tempMax)}&deg;</text>
        <text x={padL - 4} y={padT + chartH + 4} textAnchor="end" fill="#f97316" fontSize={8} fontFamily="monospace">{Math.round(tempMin)}&deg;</text>

        {/* X axis labels */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={xPos(i)} y={height - 4} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fill="rgba(255,255,255,0.3)" fontSize={9} fontFamily="monospace">{label}</text>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-orange-500" />
          <span className="text-[9px] font-mono text-white/40">Temp (Hi/Lo)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-cyan-400" />
          <span className="text-[9px] font-mono text-white/40">Wind</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-purple-500" />
          <span className="text-[9px] font-mono text-white/40">Pressure</span>
        </div>
      </div>
    </div>
  );
}

// ─── Forecast Strip ──────────────────────────────────────────
function ForecastStrip({ stateAbbr }: { stateAbbr: string }) {
  const { data, loading } = useStateForecast(stateAbbr);

  if (loading) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={14} className="text-cyan-400" />
          <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">16-DAY FORECAST</span>
        </div>
        <div className="animate-pulse h-[80px] bg-white/[0.04] rounded" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={14} className="text-cyan-400" />
          <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">16-DAY FORECAST</span>
        </div>
        <p className="text-[11px] text-white/20 text-center py-4">No forecast data</p>
      </div>
    );
  }

  // Temp range across all days for bar scaling
  const allTemps = data.flatMap(d => [d.temp_high_f, d.temp_low_f]);
  const tempMin = Math.min(...allTemps);
  const tempMax = Math.max(...allTemps);
  const tempRange = tempMax - tempMin || 1;

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar size={14} className="text-cyan-400" />
        <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">16-DAY FORECAST</span>
      </div>

      <div className="flex gap-0.5 overflow-x-auto scrollbar-hide">
        {data.map((day, i) => {
          const d = new Date(day.date + 'T00:00:00');
          const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
          const dateLabel = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
          const barBottom = ((day.temp_low_f - tempMin) / tempRange) * 40;
          const barHeight = Math.max(4, ((day.temp_high_f - day.temp_low_f) / tempRange) * 40);

          return (
            <div key={i} className="flex flex-col items-center min-w-[38px] px-0.5">
              <span className="text-[8px] font-mono text-white/30">{dayLabel}</span>
              <span className="text-[8px] font-mono text-white/20">{dateLabel}</span>
              <span className="text-sm mt-1">{weatherEmoji(day.weather_code)}</span>

              {/* Temp bar */}
              <div className="relative h-[48px] w-2 mt-1 mb-1">
                <div
                  className="absolute w-full rounded-sm bg-orange-500/60"
                  style={{
                    bottom: `${barBottom}px`,
                    height: `${barHeight}px`,
                  }}
                />
              </div>

              <span className="text-[8px] font-mono text-orange-400">{Math.round(day.temp_high_f)}</span>
              <span className="text-[8px] font-mono text-orange-400/50">{Math.round(day.temp_low_f)}</span>

              {/* Wind */}
              {day.wind_speed_max_mph > 0 && (
                <div className="flex items-center gap-0.5 mt-0.5">
                  <Wind size={8} className="text-cyan-400/60" />
                  <span className="text-[7px] font-mono text-cyan-400/60">{Math.round(day.wind_speed_max_mph)}</span>
                </div>
              )}

              {/* Precip dot */}
              {day.precipitation_mm > 0 && (
                <div className="mt-0.5">
                  <Droplets size={8} className={day.precipitation_mm > 5 ? 'text-blue-400' : 'text-blue-400/40'} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Component Bars ──────────────────────────────────────────
function ComponentBars({ score }: { score: NonNullable<StateProfileProps['convergenceScore']> }) {
  const components = [
    { key: 'weather', label: 'Weather', value: score.weather_component, color: '#f97316', max: 30 },
    { key: 'migration', label: 'Migration', value: score.migration_component, color: '#22c55e', max: 25 },
    { key: 'solunar', label: 'Solunar', value: score.solunar_component, color: '#3b82f6', max: 15 },
    { key: 'pattern', label: 'Pattern', value: score.pattern_component, color: '#a855f7', max: 15 },
    { key: 'birdcast', label: 'BirdCast', value: score.birdcast_component ?? 0, color: '#eab308', max: 10 },
    { key: 'water', label: 'Water', value: score.water_component ?? 0, color: '#06b6d4', max: 10 },
    { key: 'photoperiod', label: 'Photoperiod', value: score.photoperiod_component ?? 0, color: '#f59e0b', max: 5 },
    { key: 'tide', label: 'Tide', value: score.tide_component ?? 0, color: '#0ea5e9', max: 5 },
  ];

  return (
    <div className="space-y-1.5">
      {components.map(c => (
        <div key={c.key} className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-white/40 w-16 text-right">{c.label}</span>
          <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (c.value / c.max) * 100)}%`,
                backgroundColor: c.color,
              }}
            />
          </div>
          <span className="text-[9px] font-mono text-white/50 w-6 text-right">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main StateProfile ───────────────────────────────────────
export default function StateProfile({
  stateAbbr,
  species,
  convergenceScore,
  convergenceAlerts,
  disasterWatches = [],
  onBack,
  isMobile,
}: StateProfileProps) {
  const { history } = useConvergenceHistory(stateAbbr);

  // StackedArea data from convergence history
  const chartData = useMemo(() => {
    return history.map(h => ({
      label: new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      values: {
        weather: h.weather_component,
        migration: h.migration_component,
        solunar: h.solunar_component,
        pattern: h.pattern_component,
        birdcast: h.birdcast_component,
        water: h.water_component,
      },
    }));
  }, [history]);

  const sparkData = useMemo(() => history.map(h => h.score), [history]);

  const stateAlerts = useMemo(() =>
    convergenceAlerts.filter(a => a.state_abbr === stateAbbr),
    [convergenceAlerts, stateAbbr]
  );

  const seasons = useMemo(() => getSeasonsByState(species, stateAbbr), [species, stateAbbr]);

  const keys = ['weather', 'migration', 'solunar', 'pattern', 'birdcast', 'water'];
  const colors: Record<string, string> = {
    weather: '#f97316',
    migration: '#22c55e',
    solunar: '#3b82f6',
    pattern: '#a855f7',
    birdcast: '#eab308',
    water: '#06b6d4',
  };

  const scoreColor = convergenceScore
    ? convergenceScore.score >= 80 ? 'text-cyan-400' : convergenceScore.score >= 60 ? 'text-orange-400' : convergenceScore.score >= 40 ? 'text-amber-400' : 'text-white/40'
    : 'text-white/40';

  return (
    <div
      className="relative h-full w-full overflow-y-auto scrollbar-hide p-4 glass-panel"
    >
      <div className="max-w-4xl mx-auto space-y-3">
        {/* Header */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              <ArrowLeft size={16} className="text-white/50" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-display text-white/90 truncate">
                  {STATE_NAMES[stateAbbr] || stateAbbr}
                </h1>
                <span className="text-[10px] font-mono text-white/30 bg-white/[0.06] px-1.5 py-0.5 rounded">
                  {stateAbbr}
                </span>
              </div>
              {convergenceScore && (
                <p className="text-[10px] font-body text-white/30 mt-0.5 truncate">
                  {convergenceScore.reasoning}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {sparkData.length > 1 && (
                <Sparkline
                  data={sparkData}
                  width={72}
                  height={28}
                  color={convergenceScore && convergenceScore.score >= 60 ? '#22d3ee' : '#fb923c'}
                  fillColor={convergenceScore && convergenceScore.score >= 60 ? '#22d3ee' : '#fb923c'}
                />
              )}

              {convergenceScore && (
                <div className="text-right">
                  <div className={`text-3xl font-mono ${scoreColor}`}>
                    {convergenceScore.score}
                  </div>
                  <div className="text-[9px] font-mono text-white/30">
                    #{convergenceScore.national_rank} nationally
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Disaster Watch (only if entries exist) */}
        {disasterWatches.length > 0 && (
          <div className="rounded-xl bg-red-500/[0.06] border border-red-500/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={14} className="text-red-400" />
              <span className="text-[10px] font-display tracking-widest text-red-400/80 uppercase">
                DISASTER WATCH ({disasterWatches.length})
              </span>
            </div>
            <div className="space-y-2">
              {disasterWatches.map((dw) => {
                const confidence = dw.metadata?.confidence ?? 0;
                const confColor = confidence >= 70 ? 'text-red-400' : confidence >= 40 ? 'text-amber-400' : 'text-white/40';
                return (
                  <div key={dw.id} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-red-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-white/70">{dw.title}</span>
                        <span className={`text-[9px] font-mono ${confColor}`}>{confidence}%</span>
                      </div>
                      <p className="text-[10px] font-body text-white/30 mt-0.5 line-clamp-2">{dw.content?.slice(0, 200)}</p>
                    </div>
                    <span className="text-[9px] font-mono text-white/20 shrink-0">
                      {new Date(dw.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 1: Convergence Trend */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-cyan-400" />
            <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">
              CONVERGENCE TREND
            </span>
          </div>

          <StackedArea
            data={chartData}
            keys={keys}
            colors={colors}
            width={600}
            height={140}
            className="w-full"
          />

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 mb-4">
            {keys.map(k => (
              <div key={k} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors[k] }} />
                <span className="text-[9px] font-mono text-white/40 capitalize">{k}</span>
              </div>
            ))}
          </div>

          {/* Component bars */}
          {convergenceScore && <ComponentBars score={convergenceScore} />}
        </div>

        {/* Section 2: Weather History */}
        <WeatherHistoryChart stateAbbr={stateAbbr} />

        {/* Section 3: 16-Day Forecast */}
        <ForecastStrip stateAbbr={stateAbbr} />

        {/* Section 4: Recent Signals */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">
              RECENT SIGNALS ({stateAlerts.length})
            </span>
          </div>
          {stateAlerts.length === 0 ? (
            <p className="text-[11px] text-white/20 text-center py-4">No recent signals for this state</p>
          ) : (
            <div className="space-y-1.5">
              {stateAlerts.slice(0, 10).map((alert, i) => {
                const delta = alert.score - alert.previous_score;
                const dotColor = delta >= 15 ? 'bg-red-500' : delta >= 8 ? 'bg-amber-500' : 'bg-cyan-500';
                return (
                  <div key={i} className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                    <div className="min-w-0 flex-1">
                      <span className="text-[11px] font-mono text-white/70">
                        {delta > 0 ? '\u25B2' : '\u25BC'} {Math.abs(delta)} &rarr; {alert.score}
                      </span>
                      <span className="text-[10px] text-white/30 ml-2">
                        {alert.alert_type}
                      </span>
                      <p className="text-[10px] font-body text-white/25 mt-0.5 truncate">{alert.reasoning}</p>
                    </div>
                    <span className="text-[9px] font-mono text-white/20 shrink-0">
                      {new Date(alert.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 5: Season Info */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-green-400" />
            <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">
              SEASONS
            </span>
          </div>
          {seasons.length === 0 ? (
            <p className="text-[11px] text-white/20 text-center py-4">No season data for {species} in {stateAbbr}</p>
          ) : (
            <div className="space-y-2">
              {seasons.map((s, i) => {
                const status = seasonStatus(s.dates);
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${status.color} bg-white/[0.04]`}>
                      {status.label}
                    </span>
                    <span className="font-mono text-white/60 capitalize">
                      {s.seasonType.replace(/-/g, ' ')}
                    </span>
                    <span className="text-white/30">&middot;</span>
                    <span className="font-body text-white/40">{s.zone}</span>
                    <span className="text-white/30">&middot;</span>
                    <span className="font-mono text-white/40">Limit: {s.harvestLimit}</span>
                    <div className="flex-1" />
                    <span className="font-mono text-white/25 text-[9px]">
                      {s.dates.map(d =>
                        `${new Date(d.open + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(d.close + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                      ).join(', ')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

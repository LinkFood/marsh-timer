import { useState, useMemo } from 'react';
import {
  MapPin, ChevronDown, Thermometer, Wind, Droplets, Eye, Moon,
  Activity, Clock, AlertTriangle, Brain, CheckCircle, XCircle, Timer,
  Cloud, Gauge, ChevronRight,
} from 'lucide-react';
import { useTodayBriefing } from '@/hooks/useTodayBriefing';
import type {
  TodayBriefingData, ConvergenceComponent, ThisDayEntry, ClaimGrade, Anomaly,
} from '@/hooks/useTodayBriefing';
import { useUserLocation, US_STATES, getStateName } from '@/hooks/useUserLocation';
import { getDomainColor } from '@/hooks/useBrainPulse';

// --- Helpers ---

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatDate(): string {
  const d = new Date();
  return `${FULL_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const DOMAIN_COLORS: Record<string, string> = {
  weather: 'bg-orange-400',
  migration: 'bg-cyan-400',
  birdcast: 'bg-cyan-300',
  solunar: 'bg-yellow-300',
  water: 'bg-blue-400',
  pattern: 'bg-violet-400',
  photoperiod: 'bg-yellow-500',
  tide: 'bg-teal-400',
};

const DOMAIN_TEXT_COLORS: Record<string, string> = {
  weather: 'text-orange-400',
  migration: 'text-cyan-400',
  birdcast: 'text-cyan-300',
  solunar: 'text-yellow-300',
  water: 'text-blue-400',
  pattern: 'text-violet-400',
  photoperiod: 'text-yellow-500',
  tide: 'text-teal-400',
};

function contentTypeIcon(ct: string): string {
  if (ct.includes('storm')) return '⚡';
  if (ct.includes('earthquake')) return '🌋';
  if (ct.includes('drought')) return '🏜';
  if (ct.includes('climate')) return '🌡';
  if (ct.includes('fire') || ct.includes('wildfire')) return '🔥';
  if (ct.includes('flood') || ct.includes('water') || ct.includes('river')) return '💧';
  if (ct.includes('migration') || ct.includes('bird')) return '🐦';
  if (ct.includes('ocean') || ct.includes('tide')) return '🌊';
  if (ct.includes('snow') || ct.includes('ice')) return '❄️';
  if (ct.includes('crop')) return '🌾';
  if (ct.includes('soil')) return '🪨';
  if (ct.includes('space') || ct.includes('geomagnetic')) return '☀️';
  if (ct.includes('astronomical')) return '🌙';
  if (ct.includes('air')) return '💨';
  if (ct.includes('ghcn')) return '📊';
  if (ct.includes('nasa')) return '🛰';
  if (ct.includes('snotel')) return '🏔';
  return '📄';
}

// --- Skeleton Components ---

function WeatherSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-end gap-3 mb-3">
        <div className="h-16 w-24 bg-white/[0.04] rounded-lg" />
        <div className="h-4 w-32 bg-white/[0.03] rounded mb-2" />
      </div>
      <div className="flex gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-3 w-16 bg-white/[0.03] rounded" />
        ))}
      </div>
    </div>
  );
}

function SolunarSkeleton() {
  return (
    <div className="animate-pulse flex items-center gap-4 py-2">
      <div className="h-3 w-20 bg-white/[0.03] rounded" />
      <div className="h-3 w-32 bg-white/[0.03] rounded" />
      <div className="h-3 w-32 bg-white/[0.03] rounded" />
    </div>
  );
}

function ConvergenceSkeleton() {
  return (
    <div className="animate-pulse flex gap-1.5">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <div key={i} className="flex-1 h-8 bg-white/[0.03] rounded" />
      ))}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="flex gap-3 items-center">
          <div className="h-3 w-10 bg-white/[0.03] rounded" />
          <div className="h-3 w-full bg-white/[0.03] rounded" />
        </div>
      ))}
    </div>
  );
}

// --- Section Components ---

function LocationBar({
  stateName,
  stateAbbr,
  onToggleDropdown,
  showDropdown,
}: {
  stateName: string;
  stateAbbr: string;
  onToggleDropdown: () => void;
  showDropdown: boolean;
}) {
  return (
    <button
      onClick={onToggleDropdown}
      className="flex items-center gap-1.5 text-left group"
    >
      <MapPin size={12} className="text-cyan-400/60" />
      <span className="text-xs font-mono text-white/50">
        {stateName}
      </span>
      <span className="text-[10px] text-white/20">·</span>
      <span className="text-xs font-mono text-white/30">{formatDate()}</span>
      <ChevronDown
        size={10}
        className={`text-white/20 group-hover:text-white/40 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
      />
    </button>
  );
}

function StateDropdown({
  current,
  onSelect,
}: {
  current: string;
  onSelect: (abbr: string) => void;
}) {
  return (
    <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-white/10 rounded-lg shadow-xl max-h-64 overflow-y-auto w-56">
      {US_STATES.map(s => (
        <button
          key={s.abbr}
          onClick={() => onSelect(s.abbr)}
          className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/[0.06] transition-colors ${
            s.abbr === current ? 'text-cyan-400 bg-cyan-400/[0.06]' : 'text-white/50'
          }`}
        >
          <span className="font-bold mr-2">{s.abbr}</span>
          <span className="text-white/30">{s.name}</span>
        </button>
      ))}
    </div>
  );
}

function WeatherHero({ weather }: { weather: TodayBriefingData['current_weather'] }) {
  if (!weather) return null;

  return (
    <div>
      <div className="flex items-end gap-3 mb-2">
        <span className="text-5xl sm:text-6xl font-display font-bold text-white/90 leading-none tabular-nums">
          {Math.round(weather.temperature_f)}°
        </span>
        <span className="text-sm font-body text-white/40 mb-1.5">
          {weather.conditions}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1 text-[11px] font-mono text-white/30">
          <Wind size={10} className="text-white/20" />
          {weather.wind_mph}mph {weather.wind_direction}
        </span>
        <span className="flex items-center gap-1 text-[11px] font-mono text-white/30">
          <Gauge size={10} className="text-white/20" />
          {weather.pressure_mb}mb
        </span>
        <span className="flex items-center gap-1 text-[11px] font-mono text-white/30">
          <Droplets size={10} className="text-white/20" />
          {weather.humidity_pct}%
        </span>
        <span className="flex items-center gap-1 text-[11px] font-mono text-white/30">
          <Eye size={10} className="text-white/20" />
          {weather.visibility_mi}mi
        </span>
        <span className="flex items-center gap-1 text-[11px] font-mono text-white/30">
          <Cloud size={10} className="text-white/20" />
          {weather.cloud_cover_pct}%
        </span>
      </div>
    </div>
  );
}

function SolunarStrip({ solunar }: { solunar: TodayBriefingData['solunar'] }) {
  if (!solunar) return null;

  return (
    <div className="flex items-center gap-3 sm:gap-4 flex-wrap font-mono text-[11px]">
      <span className="flex items-center gap-1.5 text-yellow-300/60">
        <Moon size={11} />
        {solunar.moon_phase}
        <span className="text-white/20">{solunar.moon_illumination}%</span>
      </span>
      <span className="text-white/10">|</span>
      <span className="text-white/30">
        Major <span className="text-cyan-400/60">{solunar.next_major}</span>
      </span>
      <span className="text-white/30">
        Minor <span className="text-cyan-400/40">{solunar.next_minor}</span>
      </span>
      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
        solunar.rating === 'excellent' ? 'bg-emerald-400/10 text-emerald-400/60' :
        solunar.rating === 'good' ? 'bg-cyan-400/10 text-cyan-400/60' :
        'bg-white/[0.04] text-white/30'
      }`}>
        {solunar.rating?.toUpperCase()}
      </span>
    </div>
  );
}

function ConvergencePulse({ convergence }: { convergence: TodayBriefingData['convergence'] }) {
  if (!convergence) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-mono text-white/20 tracking-wider">CONVERGENCE</span>
        <span className="text-[10px] font-mono text-cyan-400/50">
          {convergence.total_score}<span className="text-white/15">/135</span>
        </span>
      </div>
      <div className="flex gap-1.5">
        {convergence.components.map((c) => {
          const pct = c.max_score > 0 ? (c.score / c.max_score) * 100 : 0;
          const bg = DOMAIN_COLORS[c.domain] || 'bg-white/30';
          const textColor = DOMAIN_TEXT_COLORS[c.domain] || 'text-white/30';
          return (
            <div key={c.domain} className="flex-1 min-w-0" title={`${c.label}: ${c.score}/${c.max_score}`}>
              <div className="h-8 bg-white/[0.03] rounded relative overflow-hidden">
                <div
                  className={`absolute bottom-0 left-0 right-0 ${bg} opacity-40 rounded transition-all duration-500`}
                  style={{ height: `${Math.max(4, pct)}%` }}
                />
              </div>
              <p className={`text-[7px] font-mono ${textColor} text-center mt-1 truncate`}>
                {c.domain.slice(0, 4).toUpperCase()}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThisDayTimeline({ entries }: { entries: ThisDayEntry[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!entries || entries.length === 0) return null;

  return (
    <div>
      <p className="text-[9px] font-mono text-white/20 tracking-wider mb-2">
        THIS DAY · {FULL_MONTHS[new Date().getMonth()].toUpperCase()} {new Date().getDate()}
      </p>
      <div className="relative pl-4 border-l border-white/[0.06]">
        {entries.map((entry, i) => {
          const isExpanded = expanded === i;
          return (
            <button
              key={`${entry.year}-${entry.content_type}-${i}`}
              onClick={() => setExpanded(isExpanded ? null : i)}
              className="block w-full text-left mb-2 last:mb-0 group relative"
            >
              {/* Dot on timeline */}
              <span className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-gray-800 border border-white/10 group-hover:border-cyan-400/30 transition-colors" />

              <div className="flex items-start gap-2">
                <span className="text-[11px] font-mono text-cyan-400/50 shrink-0 w-10 tabular-nums">
                  {entry.year}
                </span>
                <span className="text-[10px] shrink-0" title={entry.content_type}>
                  {contentTypeIcon(entry.content_type)}
                </span>
                <span className={`text-[11px] font-body leading-tight ${
                  isExpanded ? 'text-white/60' : 'text-white/40 line-clamp-1'
                }`}>
                  {entry.summary}
                </span>
                {entry.state_abbr && (
                  <span className="text-[8px] font-mono text-white/15 shrink-0 ml-auto">
                    {entry.state_abbr}
                  </span>
                )}
              </div>
              {isExpanded && entry.metadata && (
                <div className="mt-1 ml-12 text-[9px] font-mono text-white/20 space-y-0.5">
                  {Object.entries(entry.metadata).slice(0, 6).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-white/15">{k}:</span>{' '}
                      <span className="text-white/30">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActiveClaims({ claims }: { claims: ClaimGrade[] }) {
  if (!claims || claims.length === 0) return null;

  return (
    <div>
      <p className="text-[9px] font-mono text-white/20 tracking-wider mb-2">ACTIVE CLAIMS</p>
      <div className="space-y-2">
        {claims.map((c) => {
          const isGraded = c.status !== 'watching';
          const isConfirmed = c.status === 'confirmed' || c.status === 'partially_confirmed';
          return (
            <div
              key={c.id}
              className={`rounded-lg px-3 py-2.5 border ${
                isGraded
                  ? isConfirmed
                    ? 'bg-emerald-400/[0.04] border-emerald-400/10'
                    : 'bg-red-400/[0.04] border-red-400/10'
                  : 'bg-white/[0.02] border-white/[0.06]'
              }`}
            >
              <div className="flex items-start gap-2">
                {isGraded ? (
                  isConfirmed ? (
                    <CheckCircle size={12} className="text-emerald-400/60 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={12} className="text-red-400/60 mt-0.5 shrink-0" />
                  )
                ) : (
                  <Timer size={12} className="text-yellow-400/60 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-[11px] font-body text-white/50 leading-tight">
                    {isGraded ? (
                      <>
                        <span className="font-mono text-[9px] text-white/20">GRADED</span>{' '}
                        {c.claim_text}
                        {c.accuracy_pct != null && (
                          <span className={`ml-1.5 font-mono text-[10px] ${
                            isConfirmed ? 'text-emerald-400/60' : 'text-red-400/60'
                          }`}>
                            {c.status.toUpperCase()}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-[9px] text-white/20">CLAIMED</span>{' '}
                        {c.claim_text}
                      </>
                    )}
                  </p>
                  {!isGraded && c.deadline && (
                    <p className="text-[9px] font-mono text-yellow-400/30 mt-0.5">
                      Deadline: {new Date(c.deadline).toLocaleDateString()}
                    </p>
                  )}
                  {isGraded && c.grade_reason && (
                    <p className="text-[9px] font-mono text-white/20 mt-0.5 line-clamp-1">
                      {c.grade_reason}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnomaliesStrip({ anomalies }: { anomalies: Anomaly[] }) {
  if (!anomalies || anomalies.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {anomalies.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400/[0.04] border border-amber-400/10"
        >
          <AlertTriangle size={12} className="text-amber-400/60 shrink-0" />
          <span className="text-[11px] font-body text-amber-200/50 flex-1 min-w-0 line-clamp-1">
            {a.description}
          </span>
          {a.domains.length > 0 && (
            <span className="text-[8px] font-mono text-amber-400/30 shrink-0">
              [{a.domains.join(' x ').toUpperCase()}]
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Main Component ---

export default function TodayBriefing() {
  const { state, stateName, detecting, setUserState } = useUserLocation();
  const [showDropdown, setShowDropdown] = useState(false);
  const { data, loading, error } = useTodayBriefing(state);

  // Skeleton vs. data
  const showSkeleton = loading && !data;

  return (
    <div className="w-full">
      {/* Location Bar */}
      <div className="relative mb-4">
        <LocationBar
          stateName={detecting ? 'Detecting...' : stateName}
          stateAbbr={state}
          onToggleDropdown={() => setShowDropdown(!showDropdown)}
          showDropdown={showDropdown}
        />
        {showDropdown && (
          <StateDropdown
            current={state}
            onSelect={(abbr) => {
              setUserState(abbr);
              setShowDropdown(false);
            }}
          />
        )}
      </div>

      {/* Error state */}
      {error && !data && (
        <div className="text-center py-6">
          <p className="text-xs font-mono text-red-400/40">Briefing unavailable</p>
          <p className="text-[9px] font-mono text-white/15 mt-1">The edge function may still be deploying</p>
        </div>
      )}

      {/* Weather Hero */}
      <section className="mb-5">
        {showSkeleton ? <WeatherSkeleton /> : <WeatherHero weather={data?.current_weather ?? null} />}
      </section>

      {/* Solunar Strip */}
      <section className="mb-5 py-2 border-y border-white/[0.04]">
        {showSkeleton ? <SolunarSkeleton /> : <SolunarStrip solunar={data?.solunar ?? null} />}
      </section>

      {/* Convergence Pulse */}
      <section className="mb-5">
        {showSkeleton ? <ConvergenceSkeleton /> : <ConvergencePulse convergence={data?.convergence ?? null} />}
      </section>

      {/* Anomalies — above timeline if something weird is happening */}
      {data?.anomalies && data.anomalies.length > 0 && (
        <section className="mb-5">
          <AnomaliesStrip anomalies={data.anomalies} />
        </section>
      )}

      {/* This Day Timeline */}
      <section className="mb-5">
        {showSkeleton ? <TimelineSkeleton /> : <ThisDayTimeline entries={data?.this_day_history ?? []} />}
      </section>

      {/* Active Claims */}
      {data?.claims_grades && data.claims_grades.length > 0 && (
        <section className="mb-5">
          <ActiveClaims claims={data.claims_grades} />
        </section>
      )}

      {/* Brain Stats Footer */}
      {data?.brain_stats && (
        <div className="flex items-center justify-center gap-3 py-3 border-t border-white/[0.04]">
          <Brain size={10} className="text-cyan-400/30" />
          <span className="text-[9px] font-mono text-white/20">
            {data.brain_stats.total_entries.toLocaleString()} entries
          </span>
          <span className="text-white/10">·</span>
          <span className="text-[9px] font-mono text-white/20">
            {data.brain_stats.content_types} types
          </span>
          <span className="text-white/10">·</span>
          <span className="text-[9px] font-mono text-emerald-400/30">
            +{data.brain_stats.entries_today.toLocaleString()} today
          </span>
        </div>
      )}

      {/* Separator before existing content */}
      <div className="flex items-center gap-3 mt-6 mb-2">
        <div className="flex-1 h-px bg-white/[0.06]" />
        <span className="text-[8px] font-mono text-white/15 tracking-widest">DIG DEEPER</span>
        <div className="flex-1 h-px bg-white/[0.06]" />
      </div>
    </div>
  );
}

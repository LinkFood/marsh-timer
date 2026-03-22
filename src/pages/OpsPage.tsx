import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, RefreshCw, ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { useOpsData } from '@/hooks/useOpsData';

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return '<1m';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

const STATUS_DOT: Record<string, string> = {
  healthy: 'bg-emerald-400',
  error: 'bg-red-400',
  late: 'bg-amber-400',
  never_run: 'bg-white/20',
};

const ALERT_COLORS: Record<string, string> = {
  confirmed: '#10B981',
  partial: '#F59E0B',
  missed: '#EF4444',
  false_alarm: '#6B7280',
  pending: '#3B82F6',
};

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 rounded-lg border border-gray-800 p-4 ${className}`}>
      <h3 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function MetricPill({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1 min-w-0">
      <span className={`text-sm sm:text-base font-mono font-bold ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
      <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider whitespace-nowrap">{label}</span>
    </div>
  );
}

function CronRow({ cron }: { cron: any }) {
  const [expanded, setExpanded] = useState(false);
  const recentRuns = Array.isArray(cron.recent_runs) ? cron.recent_runs.slice(0, 5) : [];

  return (
    <div className="border-b border-gray-800/50">
      <button
        onClick={() => recentRuns.length > 0 && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors ${
          cron.health === 'error' ? 'bg-red-400/[0.04]' : ''
        }`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[cron.health] || 'bg-white/20'}`} />
        <span className="text-[11px] font-mono text-white/80 flex-1 min-w-0 truncate">{cron.name}</span>
        <span className="text-[10px] font-mono text-white/30 hidden sm:block w-16 text-right">{cron.schedule}</span>
        <span className="text-[10px] font-mono text-white/40 w-12 text-right">{timeAgo(cron.last_run)}</span>
        {cron.duration_ms != null && (
          <span className="text-[10px] font-mono text-white/30 w-14 text-right hidden sm:block">{(cron.duration_ms / 1000).toFixed(1)}s</span>
        )}
        {recentRuns.length > 0 && (
          expanded ? <ChevronDown size={12} className="text-white/30 shrink-0" /> : <ChevronRight size={12} className="text-white/30 shrink-0" />
        )}
      </button>
      {expanded && recentRuns.length > 0 && (
        <div className="pl-7 pr-3 pb-2 space-y-1">
          {recentRuns.map((run: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-white/30">
              <span className={`w-1.5 h-1.5 rounded-full ${run.status === 'success' ? 'bg-emerald-400' : run.status === 'error' ? 'bg-red-400' : 'bg-white/20'}`} />
              <span>{run.status}</span>
              <span className="ml-auto">{timeAgo(run.created_at)}</span>
              {run.duration_ms != null && <span>{(run.duration_ms / 1000).toFixed(1)}s</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsPage() {
  const { data, loading, error, refetch } = useOpsData();

  const totalCrons = Array.isArray(data.crons.crons) ? data.crons.crons.length : 0;
  const lastEmbed = data.brain.content_types.length > 0
    ? data.brain.content_types.reduce((latest, ct) => (!latest || ct.latest > latest ? ct.latest : latest), '')
    : null;

  const sortedCrons = Array.isArray(data.crons.crons)
    ? [...data.crons.crons].sort((a, b) => {
        const order: Record<string, number> = { error: 0, late: 1, never_run: 2, healthy: 3 };
        return (order[a.health] ?? 4) - (order[b.health] ?? 4);
      })
    : [];

  // Bar chart data: top 15 content types by count
  const barData = [...data.brain.content_types]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map(ct => ({ name: ct.type.replace(/^hunt[-_]?/, ''), count: ct.count }));

  // Freshness table
  const freshnessData = [...data.brain.content_types]
    .sort((a, b) => b.count - a.count)
    .map(ct => {
      const ageMs = ct.latest ? Date.now() - new Date(ct.latest).getTime() : Infinity;
      const stale = ageMs > 48 * 60 * 60 * 1000;
      return { ...ct, stale };
    });

  // Alert pie data
  const alertPieData = [
    { name: 'Confirmed', value: data.alerts.confirmed, color: ALERT_COLORS.confirmed },
    { name: 'Partial', value: data.alerts.partial, color: ALERT_COLORS.partial },
    { name: 'Missed', value: data.alerts.missed, color: ALERT_COLORS.missed },
    { name: 'False Alarm', value: data.alerts.false_alarm, color: ALERT_COLORS.false_alarm },
    { name: 'Pending', value: data.alerts.pending, color: ALERT_COLORS.pending },
  ].filter(d => d.value > 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-white/30 text-sm font-mono tracking-widest uppercase">Loading ops data...</div>
      </div>
    );
  }

  if (error && data.brain.total === 0) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
        <div className="text-red-400 text-sm font-mono">{error}</div>
        <button onClick={refetch} className="text-xs font-mono text-white/50 hover:text-white/80 flex items-center gap-1">
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* System Pulse bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link to="/" className="p-1.5 rounded hover:bg-white/[0.05] transition-colors" aria-label="Back to dashboard">
              <ArrowLeft size={16} className="text-white/50" />
            </Link>
            <Activity size={16} className="text-cyan-400" />
            <div className="hidden sm:flex flex-col">
              <span className="text-xs font-display font-bold tracking-widest text-white/90">DUCK COUNTDOWN</span>
              <span className="text-[7px] tracking-[0.2em] text-white/40 -mt-0.5">OPS DASHBOARD</span>
            </div>
            <span className="text-xs font-display font-bold tracking-widest text-white/90 sm:hidden">OPS</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-hide">
            <MetricPill label="Brain" value={data.brain.total} color="text-cyan-400" />
            <MetricPill
              label="Today"
              value={data.brain.growth_today > 0 ? `+${data.brain.growth_today.toLocaleString()}` : '0'}
              color={data.brain.growth_today > 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <MetricPill label="Types" value={data.brain.content_types.length} />
            <MetricPill
              label="Crons OK"
              value={`${data.crons.healthy_count}/${totalCrons}`}
              color={data.crons.error_count > 0 ? 'text-amber-400' : 'text-emerald-400'}
            />
            <MetricPill
              label="Errors 48h"
              value={data.crons.error_count}
              color={data.crons.error_count > 0 ? 'text-red-400' : 'text-emerald-400'}
            />
            <MetricPill label="Last Embed" value={timeAgo(lastEmbed)} />
          </div>
          <button onClick={refetch} className="p-1.5 rounded hover:bg-white/[0.05] transition-colors shrink-0 ml-2" aria-label="Refresh">
            <RefreshCw size={14} className="text-white/40" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Cron Health */}
          <Card title="Cron Health">
            <div className="flex items-center gap-3 mb-3 text-[10px] font-mono">
              <span className="text-emerald-400">{data.crons.healthy_count} healthy</span>
              <span className={data.crons.error_count > 0 ? 'text-red-400' : 'text-white/30'}>{data.crons.error_count} error</span>
              <span className={data.crons.late_count > 0 ? 'text-amber-400' : 'text-white/30'}>{data.crons.late_count} late</span>
              <span className="text-white/30">{data.crons.unknown_count} unknown</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto -mx-4 -mb-4">
              {sortedCrons.map(cron => (
                <CronRow key={cron.name} cron={cron} />
              ))}
              {sortedCrons.length === 0 && (
                <div className="flex items-center justify-center h-20 text-white/20 text-[10px]">No cron data</div>
              )}
            </div>
          </Card>

          {/* Data Pipeline */}
          <Card title="Data Pipeline">
            <div className="flex items-center gap-4 mb-4 text-[10px] font-mono">
              <div className="flex flex-col items-center">
                <span className="text-lg font-bold text-amber-400">{data.discoveries.pending}</span>
                <span className="text-white/40">Pending</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-lg font-bold text-emerald-400">{data.discoveries.embedded}</span>
                <span className="text-white/40">Embedded</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-lg font-bold text-white/30">{data.discoveries.skipped}</span>
                <span className="text-white/40">Skipped</span>
              </div>
            </div>
            {data.scans.length > 0 && (
              <>
                <h4 className="text-[10px] font-mono text-white/40 uppercase mb-2">Recent Scans</h4>
                <div className="max-h-[250px] overflow-y-auto -mx-4 -mb-4">
                  {data.scans.map((scan: any, i: number) => {
                    const summary = typeof scan.summary === 'object' && scan.summary ? scan.summary : {};
                    return (
                      <div key={i} className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-800/30">
                        <span className={`w-1.5 h-1.5 rounded-full ${summary.alert ? 'bg-red-400' : 'bg-emerald-400'}`} />
                        <span className="text-[11px] font-mono text-white/70">{summary.state || '?'}</span>
                        <span className="text-[10px] font-mono text-white/30">{summary.domains || 0} domains</span>
                        {summary.alert && (
                          <span className="text-[8px] font-mono text-red-400 bg-red-400/10 px-1 rounded">ALERT</span>
                        )}
                        {scan.duration_ms != null && (
                          <span className="text-[9px] font-mono text-white/20 hidden sm:block">{(scan.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                        <span className="text-[9px] font-mono text-white/20 ml-auto">{timeAgo(scan.created_at)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {data.scans.length === 0 && (
              <div className="flex items-center justify-center h-16 text-white/20 text-[10px]">No recent scans</div>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Brain Growth */}
          <Card title="Brain Growth">
            {data.brain.growth_by_day.length > 0 && (
              <div className="mb-4">
                <h4 className="text-[10px] font-mono text-white/40 mb-2">Entries per Day (30d)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={data.brain.growth_by_day}>
                    <XAxis
                      dataKey="day"
                      tick={{ fill: '#9CA3AF', fontSize: 11 }}
                      tickFormatter={(v: string) => v.slice(5)}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#9CA3AF' }}
                      itemStyle={{ color: '#10B981' }}
                    />
                    <Line type="monotone" dataKey="count" stroke="#10B981" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {barData.length > 0 && (
              <div className="mb-4">
                <h4 className="text-[10px] font-mono text-white/40 mb-2">Entries by Content Type (Top 15)</h4>
                <ResponsiveContainer width="100%" height={Math.max(200, barData.length * 24)}>
                  <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 10 }}>
                    <XAxis type="number" tick={{ fill: '#9CA3AF', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 10 }} width={130} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: '#9CA3AF' }}
                    />
                    <Bar dataKey="count" fill="#06B6D4" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {freshnessData.length > 0 && (
              <div>
                <h4 className="text-[10px] font-mono text-white/40 mb-2">Data Freshness</h4>
                <div className="max-h-[250px] overflow-y-auto -mx-4 -mb-4">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="sticky top-0 bg-gray-900">
                      <tr className="text-white/40 text-left">
                        <th className="px-4 py-1">Type</th>
                        <th className="px-2 py-1 text-right">Count</th>
                        <th className="px-2 py-1 text-right">Newest</th>
                        <th className="px-4 py-1 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {freshnessData.map(ct => (
                        <tr key={ct.type} className="border-t border-gray-800/30">
                          <td className="px-4 py-1 text-white/60 truncate max-w-[160px]">{ct.type}</td>
                          <td className="px-2 py-1 text-right text-white/40">{ct.count.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right text-white/40">{timeAgo(ct.latest)}</td>
                          <td className="px-4 py-1 text-right">
                            {ct.stale ? (
                              <span className="text-amber-400">STALE</span>
                            ) : (
                              <span className="text-emerald-400">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          {/* Alert Performance */}
          <Card title="Alert Performance">
            <div className="flex flex-col sm:flex-row items-start gap-6">
              {/* Scorecard */}
              <div className="flex-1 w-full">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-mono font-bold text-white">{data.alerts.total_30d}</div>
                    <div className="text-[9px] font-mono text-white/40">Total (30d)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-mono font-bold text-emerald-400">{data.alerts.accuracy}%</div>
                    <div className="text-[9px] font-mono text-white/40">Accuracy</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-mono font-bold text-emerald-400">{data.alerts.confirmed}</div>
                    <div className="text-[9px] font-mono text-white/40">Confirmed</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="text-sm font-mono font-bold text-amber-400">{data.alerts.partial}</div>
                    <div className="text-[8px] font-mono text-white/30">Partial</div>
                  </div>
                  <div>
                    <div className="text-sm font-mono font-bold text-red-400">{data.alerts.missed}</div>
                    <div className="text-[8px] font-mono text-white/30">Missed</div>
                  </div>
                  <div>
                    <div className="text-sm font-mono font-bold text-gray-400">{data.alerts.false_alarm}</div>
                    <div className="text-[8px] font-mono text-white/30">False Alarm</div>
                  </div>
                  <div>
                    <div className="text-sm font-mono font-bold text-blue-400">{data.alerts.pending}</div>
                    <div className="text-[8px] font-mono text-white/30">Pending</div>
                  </div>
                </div>
              </div>

              {/* Pie chart */}
              {alertPieData.length > 0 && (
                <div className="w-full sm:w-48 flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={alertPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={65}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {alertPieData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[9px] font-mono">
                    {alertPieData.map(d => (
                      <span key={d.name} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-white/50">{d.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

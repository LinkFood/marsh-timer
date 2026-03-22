import { useState } from 'react';
import { XCircle } from 'lucide-react';
import { useAdminData } from '@/hooks/useAdminData';
import PanelTabs from '@/components/PanelTabs';
import type { PanelComponentProps } from './PanelTypes';

function timeAgo(iso: string | null): string {
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

const DECISION_STYLE: Record<string, { bg: string; text: string }> = {
  embed: { bg: 'bg-emerald-400/10', text: 'text-emerald-400' },
  skip: { bg: 'bg-white/[0.06]', text: 'text-white/40' },
  flag: { bg: 'bg-amber-400/10', text: 'text-amber-400' },
};

export default function AdminConsolePanel({ isFullscreen }: PanelComponentProps) {
  const { crons, discoveries, failures, scans, riskAlerts, brainCount, loading } = useAdminData();
  const [activeTab, setActiveTab] = useState('crons');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/20 text-[10px]">
        Loading system status...
      </div>
    );
  }

  const healthyCrons = crons.filter(c => c.health === 'healthy').length;
  const errorCrons = crons.filter(c => c.health === 'error').length;
  const pendingDiscoveries = discoveries.filter(d => !d.curator_decision).length;

  return (
    <div className="h-full flex flex-col">
      {/* Summary bar */}
      <div className="shrink-0 flex items-center gap-3 px-2.5 py-1.5 border-b border-white/[0.06] text-[9px] font-mono">
        <span className="text-emerald-400">{healthyCrons}/{crons.length} crons</span>
        <span className={errorCrons > 0 ? 'text-red-400' : 'text-white/30'}>{errorCrons} errors</span>
        <span className="text-cyan-400">{brainCount.toLocaleString()} brain entries</span>
        <span className="text-white/30">{pendingDiscoveries} pending</span>
      </div>

      <PanelTabs
        tabs={[
          { id: 'crons', label: 'CRONS', count: crons.length },
          { id: 'discoveries', label: 'DISCOVERIES', count: discoveries.length + riskAlerts.length },
          { id: 'failures', label: 'FAILURES', count: failures.length },
          { id: 'scans', label: 'SCANS', count: scans.length },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'crons' && (
          <div>
            {[...crons]
              .sort((a, b) => {
                const order: Record<string, number> = { error: 0, late: 1, never_run: 2, healthy: 3 };
                return (order[a.health] ?? 4) - (order[b.health] ?? 4);
              })
              .map(cron => (
                <div
                  key={cron.name}
                  className={`flex items-center gap-2 px-2.5 py-1.5 border-b border-white/[0.03] ${
                    cron.health === 'error' ? 'bg-red-400/[0.04]' : ''
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[cron.health] || 'bg-white/20'}`} />
                  <span className="text-[10px] font-mono text-white/70 w-40 truncate">{cron.name}</span>
                  <span className="text-[9px] font-mono text-white/30 w-16">{cron.schedule}</span>
                  <span className="text-[9px] font-mono text-white/40 ml-auto">{timeAgo(cron.last_run)}</span>
                </div>
              ))}
          </div>
        )}

        {activeTab === 'discoveries' && (
          <div>
            {/* Compound risk alerts */}
            {riskAlerts.map(r => (
              <div key={r.id} className="px-2.5 py-2 border-b border-white/[0.03] bg-red-400/[0.04]">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-red-400/10 text-red-400">RISK</span>
                  {r.state_abbr && <span className="text-[9px] font-mono text-white/50">{r.state_abbr}</span>}
                  <span className="text-[9px] font-mono text-white/20 ml-auto">{timeAgo(r.created_at)}</span>
                </div>
                <p className="text-[10px] text-white/50 truncate">{r.title}</p>
              </div>
            ))}
            {/* Web discoveries */}
            {discoveries.length === 0 && riskAlerts.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-white/20 text-[10px]">
                No web discoveries yet
              </div>
            ) : (
              discoveries.map(d => {
                const style = d.curator_decision ? DECISION_STYLE[d.curator_decision] : { bg: 'bg-white/[0.04]', text: 'text-white/30' };
                return (
                  <div key={d.id} className="px-2.5 py-2 border-b border-white/[0.03]">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${style.bg} ${style.text}`}>
                        {d.curator_decision?.toUpperCase() || 'PENDING'}
                      </span>
                      {d.quality_score != null && (
                        <span className="text-[8px] font-mono text-white/30">{(d.quality_score * 100).toFixed(0)}%</span>
                      )}
                      <span className="text-[9px] font-mono text-white/20 ml-auto">{timeAgo(d.created_at)}</span>
                    </div>
                    <p className="text-[10px] text-white/50 truncate">{d.query}</p>
                    {d.source_url && (
                      <p className="text-[9px] text-white/20 truncate">{d.source_url}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'failures' && (
          <div>
            {failures.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-emerald-400/40 text-[10px]">
                No failures in the last 48 hours
              </div>
            ) : (
              failures.map((f, i) => (
                <div key={i} className="px-2.5 py-2 border-b border-white/[0.03] bg-red-400/[0.02]">
                  <div className="flex items-center gap-1.5">
                    <XCircle size={10} className="text-red-400 shrink-0" />
                    <span className="text-[10px] font-mono text-red-400">{f.function_name}</span>
                    <span className="text-[9px] font-mono text-white/20 ml-auto">{timeAgo(f.created_at)}</span>
                  </div>
                  <p className="text-[9px] text-white/40 mt-0.5 line-clamp-2">
                    {typeof f.summary === 'string' ? f.summary : JSON.stringify(f.summary)}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'scans' && (
          <div>
            {scans.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-white/20 text-[10px]">
                No convergence scans recorded
              </div>
            ) : (
              scans.map((s, i) => {
                const summary = typeof s.summary === 'object' && s.summary ? s.summary : {};
                return (
                  <div key={i} className="px-2.5 py-1.5 border-b border-white/[0.03]">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${summary.alert ? 'bg-red-400' : 'bg-emerald-400'}`} />
                      <span className="text-[10px] font-mono text-white/70">{summary.state || '?'}</span>
                      <span className="text-[9px] font-mono text-white/30">{summary.domains || 0} domains</span>
                      {summary.alert && <span className="text-[8px] font-mono text-red-400 bg-red-400/10 px-1 rounded">ALERT</span>}
                      <span className="text-[9px] font-mono text-white/20 ml-auto">{timeAgo(s.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

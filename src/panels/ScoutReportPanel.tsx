import { useScoutReport } from '@/hooks/useScoutReport';
import { Clock } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ScoutReportPanel({}: PanelComponentProps) {
  const { report, loading } = useScoutReport();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading scout report...
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No scout report available
      </div>
    );
  }

  const paragraphs = report.brief_text.split('\n').filter(l => l.trim());

  return (
    <div className="flex flex-col h-full p-3 overflow-y-auto gap-3">
      {/* Timestamp header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-white/[0.02] border border-white/[0.06]">
        <Clock size={12} className="text-cyan-400 shrink-0" />
        <span className="text-xs font-mono text-white/70">{timeAgo(report.created_at)}</span>
      </div>

      {/* Report body with quote border */}
      <div className="border-l-2 border-cyan-400/30 pl-3 flex flex-col gap-2.5">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-xs text-white/80 leading-relaxed font-body">{p}</p>
        ))}
      </div>
    </div>
  );
}

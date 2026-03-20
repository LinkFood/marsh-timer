import { useScoutReport } from '@/hooks/useScoutReport';
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
    <div className="flex flex-col h-full p-2 overflow-y-auto">
      <div className="text-[10px] text-white/30 mb-2">
        {timeAgo(report.created_at)}
      </div>
      <div className="flex flex-col gap-2">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-xs text-white/80 leading-relaxed">{p}</p>
        ))}
      </div>
    </div>
  );
}

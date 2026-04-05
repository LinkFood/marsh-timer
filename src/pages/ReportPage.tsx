import { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Brain, ChevronLeft, Share2, Loader2 } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import UserMenu from '@/components/UserMenu';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

// Parse the AI response to extract grade and domain scores
function parseReport(content: string): { grade: string; domains: Array<{ name: string; score: string; detail: string }>; fact: string } | null {
  if (!content) return null;

  // Extract overall grade
  const gradeMatch = content.match(/(?:Grade|Overall|Score)[:\s]*\*?\*?([A-F][+-]?)\*?\*?/i)
    || content.match(/\*\*([A-F][+-]?)\*\*/);
  const grade = gradeMatch?.[1] || '?';

  // Extract domain scores
  const domains: Array<{ name: string; score: string; detail: string }> = [];
  const domainPatterns = [
    /(?:Weather|Temperature)[^:]*:\s*\*?\*?([A-F][+-]?)\*?\*?[^\n]*/gi,
    /(?:Storm|Severe)[^:]*:\s*\*?\*?([A-F][+-]?)\*?\*?[^\n]*/gi,
    /(?:Climate|Index|Indices)[^:]*:\s*\*?\*?([A-F][+-]?)\*?\*?[^\n]*/gi,
    /(?:Migration|Bird)[^:]*:\s*\*?\*?([A-F][+-]?)\*?\*?[^\n]*/gi,
    /(?:Water|River|Tide)[^:]*:\s*\*?\*?([A-F][+-]?)\*?\*?[^\n]*/gi,
    /(?:Moon|Solunar|Lunar)[^:]*:\s*\*?\*?([A-F][+-]?)\*?\*?[^\n]*/gi,
    /(?:Drought|Soil)[^:]*:\s*\*?\*?([A-F][+-]?)\*?\*?[^\n]*/gi,
    /(?:Earthquake|Seismic)[^:]*:\s*\*?\*?([A-F][+-]?)\*?\*?[^\n]*/gi,
  ];

  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/[-*]\s*\*?\*?([^:*]+)\*?\*?:\s*\*?\*?([A-F][+-]?)\*?\*?\s*[—–-]\s*(.*)/);
    if (match) {
      domains.push({ name: match[1].trim(), score: match[2], detail: match[3].trim() });
    }
  }

  // Extract surprising fact
  const factMatch = content.match(/(?:Surprising|Fun|Notable|Interesting)[^:]*:\s*(.*)/i)
    || content.match(/(?:Did you know|One thing)[^:]*:\s*(.*)/i);
  const fact = factMatch?.[1]?.trim() || '';

  return { grade, domains, fact };
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-emerald-400';
  if (grade.startsWith('B')) return 'text-cyan-400';
  if (grade.startsWith('C')) return 'text-yellow-400';
  if (grade.startsWith('D')) return 'text-amber-400';
  if (grade.startsWith('F')) return 'text-red-400';
  return 'text-white/50';
}

function gradeBg(grade: string): string {
  if (grade.startsWith('A')) return 'from-emerald-400/10 to-emerald-400/[0.02]';
  if (grade.startsWith('B')) return 'from-cyan-400/10 to-cyan-400/[0.02]';
  if (grade.startsWith('C')) return 'from-yellow-400/10 to-yellow-400/[0.02]';
  if (grade.startsWith('D')) return 'from-amber-400/10 to-amber-400/[0.02]';
  if (grade.startsWith('F')) return 'from-red-400/10 to-red-400/[0.02]';
  return 'from-white/5 to-white/[0.02]';
}

export default function ReportPage() {
  const { dateStr } = useParams<{ dateStr: string }>();
  const autoFiredRef = useRef(false);
  const [copied, setCopied] = useState(false);

  const { messages, loading, streaming, sendMessage } = useChat({
    species: 'all',
    stateAbbr: null,
    onMapAction: () => {},
  });

  const formatted = dateStr ? formatDate(dateStr) : 'Unknown Date';

  useEffect(() => {
    if (autoFiredRef.current || !dateStr) return;
    autoFiredRef.current = true;
    sendMessage(`Grade ${formatted} as an environmental day. Give it an overall letter grade A+ through F based on how unusual, extreme, or interesting the environmental conditions were across all domains. Then grade each domain individually: Weather, Storms, Climate Indices, Migration, Water/Tides, Moon Phase, Drought/Soil, Seismic. Format each domain as: - **Domain**: **Grade** — one sentence explanation. End with one surprising fact about this date. Be specific and use data.`);
  }, [dateStr, formatted, sendMessage]);

  useEffect(() => {
    document.title = `${formatted} — Environmental Report Card | Duck Countdown`;
  }, [formatted]);

  // Embed
  const embeddedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content && msg.content.length > 50 && !embeddedRef.current.has(msg.id)) {
        if (loading || streaming) continue;
        embeddedRef.current.add(msg.id);
        fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          body: JSON.stringify({
            content: `Birthday report for ${dateStr} — graded.`,
            content_type: 'query-signal',
            title: `Report Card: ${dateStr}`,
            metadata: { date: dateStr, page: 'report', timestamp: new Date().toISOString() },
          }),
        }).catch(() => {});
      }
    }
  }, [messages, loading, streaming, dateStr]);

  const assistantMsg = messages.find(m => m.role === 'assistant' && m.content);
  const report = assistantMsg ? parseReport(assistantMsg.content) : null;

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#0a0f1a] flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 h-12 border-b border-white/[0.06]">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80">
          <ChevronLeft size={14} className="text-white/40" />
          <span className="text-sm font-bold text-white tracking-wider">DUCK COUNTDOWN</span>
        </Link>
        <UserMenu />
      </header>

      <main className="flex-1 overflow-y-auto flex items-center justify-center p-4">
        {(loading || streaming) && !report && (
          <div className="text-center">
            <Loader2 size={24} className="text-cyan-400/60 animate-spin mx-auto mb-3" />
            <p className="text-xs font-mono text-cyan-400/40">Grading {formatted}...</p>
          </div>
        )}

        {report && (
          <div className="w-full max-w-md">
            {/* Report Card */}
            <div className={`rounded-2xl bg-gradient-to-b ${gradeBg(report.grade)} border border-white/[0.08] p-6 sm:p-8`}>
              {/* Header */}
              <div className="text-center mb-6">
                <p className="text-[9px] font-mono text-white/30 tracking-widest mb-2">ENVIRONMENTAL REPORT CARD</p>
                <h1 className="text-lg sm:text-xl font-bold text-white/90 mb-1">{formatted}</h1>
                <p className="text-[10px] font-mono text-white/20">duckcountdown.com</p>
              </div>

              {/* Big Grade */}
              <div className="text-center mb-6">
                <span className={`text-7xl sm:text-8xl font-display font-bold ${gradeColor(report.grade)}`}>
                  {report.grade}
                </span>
              </div>

              {/* Domain Scores */}
              {report.domains.length > 0 && (
                <div className="space-y-2 mb-6">
                  {report.domains.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02]">
                      <span className={`text-sm font-bold font-mono ${gradeColor(d.score)} w-6`}>{d.score}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-semibold text-white/60">{d.name}</span>
                        <p className="text-[9px] text-white/30 truncate">{d.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Surprising Fact */}
              {report.fact && (
                <div className="px-3 py-2.5 rounded-lg bg-purple-400/[0.04] border border-purple-400/10 mb-4">
                  <p className="text-[9px] font-mono text-purple-400/50 mb-1">DID YOU KNOW?</p>
                  <p className="text-[10px] text-white/50 leading-relaxed">{report.fact}</p>
                </div>
              )}

              {/* Brain badge */}
              <div className="flex items-center justify-center gap-1.5">
                <Brain size={10} className="text-cyan-400/30" />
                <span className="text-[8px] font-mono text-white/15">Powered by 4.5M+ cross-domain records</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="px-4 py-2 rounded-lg border border-white/[0.08] hover:bg-white/[0.04] transition-colors inline-flex items-center gap-2"
              >
                <Share2 size={14} className="text-white/40" />
                <span className="text-xs font-body text-white/40">{copied ? 'Copied!' : 'Share'}</span>
              </button>
              <Link
                to={`/date/${dateStr}`}
                className="px-4 py-2 rounded-lg border border-cyan-400/20 hover:bg-cyan-400/[0.04] transition-colors text-xs font-body text-cyan-400/60"
              >
                Full Analysis →
              </Link>
            </div>
          </div>
        )}

        {/* Fallback: show raw response if parsing failed */}
        {assistantMsg && !report && !loading && !streaming && (
          <div className="max-w-3xl w-full">
            <div className="rounded-xl bg-white/[0.015] border border-white/[0.05] p-5">
              <div className="flex items-center gap-2 mb-3">
                <Brain size={14} className="text-cyan-400/50" />
                <span className="text-[9px] font-mono text-white/30">BRAIN</span>
              </div>
              <p className="text-xs text-white/60 whitespace-pre-wrap">{assistantMsg.content}</p>
            </div>
          </div>
        )}
      </main>

      <div className="grain-overlay" />
    </div>
  );
}

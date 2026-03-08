import { useState } from 'react';
import { Binoculars, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useFeedback } from '../hooks/useFeedback';

interface ScoutReportProps {
  briefText: string | null;
  loading: boolean;
}

const SECTION_PATTERN = /^([A-Z][A-Z\s]+)$/;

interface Section {
  title: string;
  content: string;
}

function deduplicateLines(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const prevTrimmed = result.length > 0 ? result[result.length - 1].trim() : '';
    if (trimmed === prevTrimmed) continue;
    // Skip lines that are >80% similar to previous
    if (trimmed.length > 0 && prevTrimmed.length > 0) {
      const shorter = Math.min(trimmed.length, prevTrimmed.length);
      const longer = Math.max(trimmed.length, prevTrimmed.length);
      if (shorter / longer > 0.8) {
        let matches = 0;
        for (let i = 0; i < shorter; i++) {
          if (trimmed[i] === prevTrimmed[i]) matches++;
        }
        if (matches / longer > 0.8) continue;
      }
    }
    result.push(line);
  }
  return result;
}

function truncateLine(line: string, max = 200): string {
  return line.length > max ? line.slice(0, max) + '...' : line;
}

function normalizeSectionTitle(title: string): string {
  return title.replace(/[^A-Z]/g, '');
}

function parseSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let currentTitle = 'Overview';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (SECTION_PATTERN.test(line.trim())) {
      if (currentLines.length > 0) {
        const deduped = deduplicateLines(currentLines);
        const content = deduped.map((l) => truncateLine(l)).join('\n').trim();
        sections.push({ title: currentTitle, content });
      }
      currentTitle = line.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    const deduped = deduplicateLines(currentLines);
    const content = deduped.map((l) => truncateLine(l)).join('\n').trim();
    sections.push({ title: currentTitle, content });
  }

  // Deduplicate sections with similar titles — keep first occurrence
  const seen = new Set<string>();
  const unique = sections.filter((s) => {
    const key = normalizeSectionTitle(s.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.filter((s) => s.content.length > 0);
}

function SectionBlock({ section, defaultOpen }: { section: Section; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full text-left mb-1"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-white/30" />
        ) : (
          <ChevronRight className="w-3 h-3 text-white/30" />
        )}
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-body font-semibold">
          {section.title}
        </span>
      </button>
      {open && (
        <div className="text-xs text-white/70 font-body whitespace-pre-line pl-4 mb-3">
          {section.content}
        </div>
      )}
    </div>
  );
}

function FeedbackRow() {
  const { submitFeedback, getFeedback, isLoading, isAuthenticated } = useFeedback();
  const today = new Date().toISOString().split('T')[0];
  const current = getFeedback('scout_report', today);
  const loading = isLoading('scout_report', today);

  if (!isAuthenticated) return null;

  return (
    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
      <span className="text-[10px] text-white/30 font-body">Was this helpful?</span>
      <button
        onClick={() => submitFeedback('scout_report', today, true)}
        disabled={loading}
        className="p-0.5 transition-colors"
      >
        <ThumbsUp
          className={`w-3.5 h-3.5 ${current === true ? 'text-green-400' : 'text-white/40 hover:text-white/60'}`}
        />
      </button>
      <button
        onClick={() => submitFeedback('scout_report', today, false)}
        disabled={loading}
        className="p-0.5 transition-colors"
      >
        <ThumbsDown
          className={`w-3.5 h-3.5 ${current === false ? 'text-red-400' : 'text-white/40 hover:text-white/60'}`}
        />
      </button>
    </div>
  );
}

export default function ScoutReport({ briefText, loading }: ScoutReportProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 space-y-2">
        <div className="h-3 w-3/4 bg-white/[0.06] rounded animate-pulse" />
        <div className="h-3 w-1/2 bg-white/[0.06] rounded animate-pulse" />
      </div>
    );
  }

  if (!briefText) return null;

  const sections = parseSections(briefText);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="flex items-center gap-2 mb-3">
        <Binoculars className="w-4 h-4 text-white/40" />
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-body font-semibold">
          Daily Scout Report
        </span>
      </div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {sections.map((section, i) => (
          <SectionBlock key={i} section={section} defaultOpen={i === 0} />
        ))}
      </div>
      <FeedbackRow />
    </div>
  );
}

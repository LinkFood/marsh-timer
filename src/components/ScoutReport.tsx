import { useState } from 'react';
import { Binoculars, ChevronDown, ChevronRight } from 'lucide-react';

interface ScoutReportProps {
  briefText: string | null;
  loading: boolean;
}

const SECTION_PATTERN = /^([A-Z][A-Z\s]+)$/;

interface Section {
  title: string;
  content: string;
}

function parseSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let currentTitle = 'Overview';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (SECTION_PATTERN.test(line.trim())) {
      if (currentLines.length > 0) {
        sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
      }
      currentTitle = line.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
  }

  return sections.filter((s) => s.content.length > 0);
}

function SectionBlock({ section }: { section: Section }) {
  const [open, setOpen] = useState(true);

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
      <div className="space-y-1">
        {sections.map((section, i) => (
          <SectionBlock key={i} section={section} />
        ))}
      </div>
    </div>
  );
}

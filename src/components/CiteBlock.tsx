import { useState } from 'react';
import { Quote, ChevronDown, Copy, Check } from 'lucide-react';

/**
 * Collapsed "Cite this ..." row that expands into a copyable citation block.
 * The page builds the citation string; this renders + copies it.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Today, long-form, for the "Retrieved {today}" clause. */
export function retrievedToday(): string {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function CiteBlock({ label, citation }: { label: string; citation: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="border border-white/[0.07] rounded-lg bg-gray-900/40">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <Quote size={12} className="text-cyan-400/60 shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 flex-1">{label}</span>
        <ChevronDown size={12} className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          <p className="text-xs font-body text-white/60 leading-relaxed border-l-2 border-cyan-400/30 pl-3 select-all">
            {citation}
          </p>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-white/10 hover:border-cyan-400/30 transition-colors text-[10px] font-mono text-cyan-400/80"
          >
            {copied ? <Check size={11} className="text-teal-400" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy citation'}
          </button>
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Calendar } from 'lucide-react';

interface WhenDropdownProps {
  value: { from: string | null; to: string | null };
  onChange: (range: { from: string | null; to: string | null }) => void;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function yearsAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().split('T')[0];
}

const PRESETS: { label: string; from: string | null; to: string | null }[] = [
  { label: 'Any Time', from: null, to: null },
  { label: 'Last 7 Days', from: daysAgo(7), to: null },
  { label: 'Last 30 Days', from: daysAgo(30), to: null },
  { label: 'Last Year', from: yearsAgo(1), to: null },
  { label: 'Since 2020', from: '2020-01-01', to: null },
  { label: 'Since 1990', from: '1990-01-01', to: null },
];

function getLabel(value: { from: string | null; to: string | null }): string {
  if (!value.from && !value.to) return 'Any Time';
  const match = PRESETS.find(p => p.from === value.from && p.to === value.to);
  if (match) return match.label;
  return value.from ? `Since ${value.from}` : 'Any Time';
}

export default function WhenDropdown({ value, onChange }: WhenDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const label = getLabel(value);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0d1117] border border-white/10 hover:border-white/20 transition-colors text-left"
      >
        <Calendar className="w-4 h-4 shrink-0 text-cyan-400" />
        <span className="font-body text-sm text-white/90 truncate">{label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-white/40 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#0d1117] border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
          {PRESETS.map(preset => {
            const isActive = value.from === preset.from && value.to === preset.to;
            return (
              <button
                key={preset.label}
                onClick={() => { onChange({ from: preset.from, to: preset.to }); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors text-left ${
                  isActive ? 'bg-white/[0.06]' : ''
                }`}
              >
                <span className="font-body text-sm text-white/90">{preset.label}</span>
                {preset.from && (
                  <span className="ml-auto font-mono text-xs text-white/30">{preset.from}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

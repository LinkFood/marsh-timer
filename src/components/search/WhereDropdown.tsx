import { useState, useRef, useEffect } from 'react';
import { ChevronDown, MapPin, Search } from 'lucide-react';

interface WhereDropdownProps {
  value: string | null;
  onChange: (stateAbbr: string | null) => void;
}

const STATES = [
  { abbr: 'AL', name: 'Alabama' }, { abbr: 'AK', name: 'Alaska' },
  { abbr: 'AZ', name: 'Arizona' }, { abbr: 'AR', name: 'Arkansas' },
  { abbr: 'CA', name: 'California' }, { abbr: 'CO', name: 'Colorado' },
  { abbr: 'CT', name: 'Connecticut' }, { abbr: 'DE', name: 'Delaware' },
  { abbr: 'FL', name: 'Florida' }, { abbr: 'GA', name: 'Georgia' },
  { abbr: 'HI', name: 'Hawaii' }, { abbr: 'ID', name: 'Idaho' },
  { abbr: 'IL', name: 'Illinois' }, { abbr: 'IN', name: 'Indiana' },
  { abbr: 'IA', name: 'Iowa' }, { abbr: 'KS', name: 'Kansas' },
  { abbr: 'KY', name: 'Kentucky' }, { abbr: 'LA', name: 'Louisiana' },
  { abbr: 'ME', name: 'Maine' }, { abbr: 'MD', name: 'Maryland' },
  { abbr: 'MA', name: 'Massachusetts' }, { abbr: 'MI', name: 'Michigan' },
  { abbr: 'MN', name: 'Minnesota' }, { abbr: 'MS', name: 'Mississippi' },
  { abbr: 'MO', name: 'Missouri' }, { abbr: 'MT', name: 'Montana' },
  { abbr: 'NE', name: 'Nebraska' }, { abbr: 'NV', name: 'Nevada' },
  { abbr: 'NH', name: 'New Hampshire' }, { abbr: 'NJ', name: 'New Jersey' },
  { abbr: 'NM', name: 'New Mexico' }, { abbr: 'NY', name: 'New York' },
  { abbr: 'NC', name: 'North Carolina' }, { abbr: 'ND', name: 'North Dakota' },
  { abbr: 'OH', name: 'Ohio' }, { abbr: 'OK', name: 'Oklahoma' },
  { abbr: 'OR', name: 'Oregon' }, { abbr: 'PA', name: 'Pennsylvania' },
  { abbr: 'RI', name: 'Rhode Island' }, { abbr: 'SC', name: 'South Carolina' },
  { abbr: 'SD', name: 'South Dakota' }, { abbr: 'TN', name: 'Tennessee' },
  { abbr: 'TX', name: 'Texas' }, { abbr: 'UT', name: 'Utah' },
  { abbr: 'VT', name: 'Vermont' }, { abbr: 'VA', name: 'Virginia' },
  { abbr: 'WA', name: 'Washington' }, { abbr: 'WV', name: 'West Virginia' },
  { abbr: 'WI', name: 'Wisconsin' }, { abbr: 'WY', name: 'Wyoming' },
];

export default function WhereDropdown({ value, onChange }: WhereDropdownProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (open && filterRef.current) filterRef.current.focus();
  }, [open]);

  const filtered = filter
    ? STATES.filter(s =>
        s.name.toLowerCase().includes(filter.toLowerCase()) ||
        s.abbr.toLowerCase().includes(filter.toLowerCase())
      )
    : STATES;

  const selectedName = value
    ? STATES.find(s => s.abbr === value)?.name || value
    : 'Anywhere';

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0d1117] border border-white/10 hover:border-white/20 transition-colors text-left"
      >
        <MapPin className="w-4 h-4 shrink-0 text-cyan-400" />
        <span className="font-body text-sm text-white/90 truncate">{selectedName}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-white/40 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#0d1117] border border-white/10 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto scrollbar-hide">
          {/* Filter input */}
          <div className="sticky top-0 bg-[#0d1117] p-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08]">
              <Search className="w-3.5 h-3.5 text-white/30" />
              <input
                ref={filterRef}
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter states..."
                className="flex-1 bg-transparent text-xs font-body text-white/90 placeholder:text-white/30 outline-none"
              />
            </div>
          </div>

          {/* Anywhere option */}
          <button
            onClick={() => { onChange(null); setOpen(false); setFilter(''); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors text-left ${
              !value ? 'bg-white/[0.06]' : ''
            }`}
          >
            <MapPin className="w-4 h-4 shrink-0 text-white/50" />
            <span className="font-body text-sm text-white/90">Anywhere</span>
          </button>

          <div className="border-t border-white/[0.06]" />

          {filtered.map(state => (
            <button
              key={state.abbr}
              onClick={() => { onChange(state.abbr); setOpen(false); setFilter(''); }}
              className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[0.04] transition-colors text-left ${
                value === state.abbr ? 'bg-white/[0.06]' : ''
              }`}
            >
              <span className="font-mono text-xs text-cyan-400/70 w-6">{state.abbr}</span>
              <span className="font-body text-sm text-white/80">{state.name}</span>
            </button>
          ))}

          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-white/30 font-body">No states match</div>
          )}
        </div>
      )}
    </div>
  );
}

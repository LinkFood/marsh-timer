import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { HuntLogInput } from '@/hooks/useHuntLogs';

const STATES: Array<{ abbr: string; name: string }> = [
  { abbr: 'AL', name: 'Alabama' }, { abbr: 'AK', name: 'Alaska' }, { abbr: 'AZ', name: 'Arizona' },
  { abbr: 'AR', name: 'Arkansas' }, { abbr: 'CA', name: 'California' }, { abbr: 'CO', name: 'Colorado' },
  { abbr: 'CT', name: 'Connecticut' }, { abbr: 'DE', name: 'Delaware' }, { abbr: 'FL', name: 'Florida' },
  { abbr: 'GA', name: 'Georgia' }, { abbr: 'HI', name: 'Hawaii' }, { abbr: 'ID', name: 'Idaho' },
  { abbr: 'IL', name: 'Illinois' }, { abbr: 'IN', name: 'Indiana' }, { abbr: 'IA', name: 'Iowa' },
  { abbr: 'KS', name: 'Kansas' }, { abbr: 'KY', name: 'Kentucky' }, { abbr: 'LA', name: 'Louisiana' },
  { abbr: 'ME', name: 'Maine' }, { abbr: 'MD', name: 'Maryland' }, { abbr: 'MA', name: 'Massachusetts' },
  { abbr: 'MI', name: 'Michigan' }, { abbr: 'MN', name: 'Minnesota' }, { abbr: 'MS', name: 'Mississippi' },
  { abbr: 'MO', name: 'Missouri' }, { abbr: 'MT', name: 'Montana' }, { abbr: 'NE', name: 'Nebraska' },
  { abbr: 'NV', name: 'Nevada' }, { abbr: 'NH', name: 'New Hampshire' }, { abbr: 'NJ', name: 'New Jersey' },
  { abbr: 'NM', name: 'New Mexico' }, { abbr: 'NY', name: 'New York' }, { abbr: 'NC', name: 'North Carolina' },
  { abbr: 'ND', name: 'North Dakota' }, { abbr: 'OH', name: 'Ohio' }, { abbr: 'OK', name: 'Oklahoma' },
  { abbr: 'OR', name: 'Oregon' }, { abbr: 'PA', name: 'Pennsylvania' }, { abbr: 'RI', name: 'Rhode Island' },
  { abbr: 'SC', name: 'South Carolina' }, { abbr: 'SD', name: 'South Dakota' }, { abbr: 'TN', name: 'Tennessee' },
  { abbr: 'TX', name: 'Texas' }, { abbr: 'UT', name: 'Utah' }, { abbr: 'VT', name: 'Vermont' },
  { abbr: 'VA', name: 'Virginia' }, { abbr: 'WA', name: 'Washington' }, { abbr: 'WV', name: 'West Virginia' },
  { abbr: 'WI', name: 'Wisconsin' }, { abbr: 'WY', name: 'Wyoming' },
];

const SPECIES = [
  { value: 'duck', label: 'Duck' },
  { value: 'goose', label: 'Goose' },
  { value: 'deer', label: 'Deer' },
  { value: 'turkey', label: 'Turkey' },
  { value: 'dove', label: 'Dove' },
];

function todayStr(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

interface HuntLogFormProps {
  onSubmit: (input: HuntLogInput) => Promise<unknown>;
}

export default function HuntLogForm({ onSubmit }: HuntLogFormProps) {
  const [date, setDate] = useState(todayStr());
  const [stateAbbr, setStateAbbr] = useState('');
  const [species, setSpecies] = useState('duck');
  const [harvestCount, setHarvestCount] = useState(0);
  const [county, setCounty] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stateAbbr || submitting) return;

    setSubmitting(true);
    setSuccess(false);

    const input: HuntLogInput = {
      date,
      state_abbr: stateAbbr,
      species,
      harvest_count: harvestCount,
    };
    if (county.trim()) input.county = county.trim();
    if (notes.trim()) input.notes = notes.trim();

    const result = await onSubmit(input);
    setSubmitting(false);

    if (result) {
      setSuccess(true);
      setDate(todayStr());
      setStateAbbr('');
      setSpecies('duck');
      setHarvestCount(0);
      setCounty('');
      setNotes('');
      setTimeout(() => setSuccess(false), 2000);
    }
  };

  const inputClass = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-body text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-cyan-400/20 focus:border-cyan-400/30';
  const labelClass = 'text-[10px] uppercase tracking-wider text-white/40 font-body font-semibold mb-1 block';

  return (
    <form onSubmit={handleSubmit} className="glass-panel rounded-xl p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-white/40 font-body font-semibold">
        Log a Hunt
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className={inputClass}
            required
          />
        </div>
        <div>
          <label className={labelClass}>State</label>
          <select
            value={stateAbbr}
            onChange={e => setStateAbbr(e.target.value)}
            className={inputClass}
            required
          >
            <option value="">Select...</option>
            {STATES.map(s => (
              <option key={s.abbr} value={s.abbr}>{s.abbr} - {s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Species</label>
          <select
            value={species}
            onChange={e => setSpecies(e.target.value)}
            className={inputClass}
            required
          >
            {SPECIES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Harvest</label>
          <input
            type="number"
            min={0}
            value={harvestCount}
            onChange={e => setHarvestCount(parseInt(e.target.value) || 0)}
            className={inputClass}
            required
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>County (optional)</label>
        <input
          type="text"
          value={county}
          onChange={e => setCounty(e.target.value)}
          placeholder="e.g. Stuttgart"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="How was the hunt?"
          rows={2}
          className={`${inputClass} resize-none`}
        />
      </div>

      <button
        type="submit"
        disabled={!stateAbbr || submitting}
        className="w-full py-2 rounded-lg text-xs font-body font-semibold uppercase tracking-wider transition-colors bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-400/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {submitting ? (
          <Loader2 size={14} className="animate-spin" />
        ) : success ? (
          <>
            <Check size={14} />
            Logged
          </>
        ) : (
          'Log Hunt'
        )}
      </button>
    </form>
  );
}

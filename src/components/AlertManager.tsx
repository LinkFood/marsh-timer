import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Pause, Play } from 'lucide-react';
import { useUserAlerts, type UserAlert } from '@/hooks/useUserAlerts';

interface AlertManagerProps {
  open: boolean;
  onClose: () => void;
}

type TriggerType = UserAlert['trigger_type'];

const TRIGGER_LABELS: Record<TriggerType, string> = {
  score_spike: 'Score Spike',
  weather_event: 'Weather Event',
  threshold: 'Threshold',
  new_data: 'New Data',
};

const TRIGGER_COLORS: Record<TriggerType, string> = {
  score_spike: 'bg-cyan-400/20 text-cyan-400',
  weather_event: 'bg-amber-400/20 text-amber-400',
  threshold: 'bg-purple-400/20 text-purple-400',
  new_data: 'bg-emerald-400/20 text-emerald-400',
};

const WEATHER_EVENT_TYPES = ['cold_front', 'pressure_drop', 'wind_shift', 'temperature_drop'] as const;

const INITIAL_FORM = {
  name: '',
  trigger_type: 'score_spike' as TriggerType,
  states: '',
  species: 'duck',
  // score_spike
  min_change: 15,
  min_score: 60,
  // weather_event
  event_types: [] as string[],
  // threshold
  field: 'score',
  operator: '>=' as string,
  value: 70,
  // new_data
  content_type: '',
};

export default function AlertManager({ open, onClose }: AlertManagerProps) {
  const { alerts, createAlert, deleteAlert, toggleAlert } = useUserAlerts();
  const [form, setForm] = useState(INITIAL_FORM);
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  function buildConfig(): Record<string, any> {
    switch (form.trigger_type) {
      case 'score_spike':
        return { min_change: form.min_change, min_score: form.min_score };
      case 'weather_event':
        return { event_types: form.event_types };
      case 'threshold':
        return { field: form.field, operator: form.operator, value: form.value };
      case 'new_data':
        return { content_type: form.content_type };
      default:
        return {};
    }
  }

  async function handleCreate() {
    if (!form.name.trim()) return;
    setCreating(true);
    const states = form.states.trim()
      ? form.states.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : null;
    await createAlert({
      name: form.name.trim(),
      trigger_type: form.trigger_type,
      config: buildConfig(),
      states,
      species: form.species,
      enabled: true,
      check_interval: '15 minutes',
    });
    setForm(INITIAL_FORM);
    setCreating(false);
  }

  function toggleEventType(et: string) {
    setForm(prev => ({
      ...prev,
      event_types: prev.event_types.includes(et)
        ? prev.event_types.filter(t => t !== et)
        : [...prev.event_types, et],
    }));
  }

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-[480px] max-h-[80vh] overflow-y-auto bg-[#0a0f1a]/95 backdrop-blur-sm border border-white/[0.06] rounded-lg shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#0a0f1a]/95 backdrop-blur-sm">
          <h2 className="text-sm font-display uppercase tracking-widest text-white/80">Alert Manager</h2>
          <button
            onClick={onClose}
            className="p-1 text-white/30 hover:text-white/70 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Active Alerts */}
          <section>
            <h3 className="text-[9px] font-display uppercase tracking-widest text-white/30 mb-2">
              Active Alerts ({alerts.length})
            </h3>
            {alerts.length === 0 ? (
              <p className="text-[11px] font-body text-white/30 py-3 text-center">No alerts configured</p>
            ) : (
              <div className="space-y-1.5">
                {alerts.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 px-3 py-2 rounded bg-white/[0.02] border border-white/[0.04]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-body text-white/80 truncate">{a.name}</span>
                        <span className={`text-[8px] font-display uppercase tracking-widest px-1.5 py-0.5 rounded ${TRIGGER_COLORS[a.trigger_type]}`}>
                          {TRIGGER_LABELS[a.trigger_type]}
                        </span>
                      </div>
                      {a.states && (
                        <span className="text-[9px] font-body text-white/25 mt-0.5 block">
                          {a.states.join(', ')}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => toggleAlert(a.id, !a.enabled)}
                      className={`p-1.5 rounded transition-colors ${a.enabled ? 'text-cyan-400 hover:text-cyan-300' : 'text-white/20 hover:text-white/40'}`}
                      aria-label={a.enabled ? 'Pause alert' : 'Resume alert'}
                    >
                      {a.enabled ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => deleteAlert(a.id)}
                      className="p-1.5 text-white/20 hover:text-red-400 transition-colors"
                      aria-label="Delete alert"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Divider */}
          <div className="border-t border-white/[0.06]" />

          {/* Create New Alert */}
          <section>
            <h3 className="text-[9px] font-display uppercase tracking-widest text-white/30 mb-3">
              Create New Alert
            </h3>
            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Arkansas Cold Front Alert"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-[11px] font-body text-white/80 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                />
              </div>

              {/* Trigger Type */}
              <div>
                <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Trigger Type</label>
                <select
                  value={form.trigger_type}
                  onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value as TriggerType }))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-[11px] font-body text-white/70 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 cursor-pointer"
                >
                  {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map(t => (
                    <option key={t} value={t} className="bg-[#0a0f1a] text-white">{TRIGGER_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              {/* Trigger-specific config */}
              {form.trigger_type === 'score_spike' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Min Change</label>
                    <input
                      type="number"
                      value={form.min_change}
                      onChange={e => setForm(f => ({ ...f, min_change: Number(e.target.value) }))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-[11px] font-body text-white/70 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Min Score</label>
                    <input
                      type="number"
                      value={form.min_score}
                      onChange={e => setForm(f => ({ ...f, min_score: Number(e.target.value) }))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-[11px] font-body text-white/70 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                    />
                  </div>
                </div>
              )}

              {form.trigger_type === 'weather_event' && (
                <div>
                  <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Event Types</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEATHER_EVENT_TYPES.map(et => (
                      <button
                        key={et}
                        type="button"
                        onClick={() => toggleEventType(et)}
                        className={`px-2 py-1 rounded text-[10px] font-body border transition-colors ${
                          form.event_types.includes(et)
                            ? 'bg-amber-400/20 text-amber-400 border-amber-400/30'
                            : 'bg-white/[0.02] text-white/40 border-white/[0.06] hover:border-white/[0.12]'
                        }`}
                      >
                        {et.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.trigger_type === 'threshold' && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Field</label>
                    <select
                      value={form.field}
                      onChange={e => setForm(f => ({ ...f, field: e.target.value }))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-[11px] font-body text-white/70 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 cursor-pointer"
                    >
                      <option value="score" className="bg-[#0a0f1a] text-white">Score</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Operator</label>
                    <select
                      value={form.operator}
                      onChange={e => setForm(f => ({ ...f, operator: e.target.value }))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-[11px] font-body text-white/70 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 cursor-pointer"
                    >
                      {['>=', '<=', '>', '<'].map(op => (
                        <option key={op} value={op} className="bg-[#0a0f1a] text-white">{op}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Value</label>
                    <input
                      type="number"
                      value={form.value}
                      onChange={e => setForm(f => ({ ...f, value: Number(e.target.value) }))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-[11px] font-body text-white/70 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                    />
                  </div>
                </div>
              )}

              {form.trigger_type === 'new_data' && (
                <div>
                  <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Content Type</label>
                  <input
                    type="text"
                    value={form.content_type}
                    onChange={e => setForm(f => ({ ...f, content_type: e.target.value }))}
                    placeholder="e.g. weather-event, migration-spike"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-[11px] font-body text-white/70 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                  />
                </div>
              )}

              {/* States filter */}
              <div>
                <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">States (comma-separated, or leave blank for all)</label>
                <input
                  type="text"
                  value={form.states}
                  onChange={e => setForm(f => ({ ...f, states: e.target.value }))}
                  placeholder="AR, TX, LA"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-[11px] font-body text-white/70 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
                />
              </div>

              {/* Species */}
              <div>
                <label className="text-[9px] font-display uppercase tracking-widest text-white/25 block mb-1">Species</label>
                <select
                  value={form.species}
                  onChange={e => setForm(f => ({ ...f, species: e.target.value }))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-3 py-1.5 text-[11px] font-body text-white/70 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 cursor-pointer"
                >
                  {['duck', 'goose', 'deer', 'turkey', 'dove'].map(s => (
                    <option key={s} value={s} className="bg-[#0a0f1a] text-white">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>

              {/* Submit */}
              <button
                onClick={handleCreate}
                disabled={!form.name.trim() || creating}
                className="w-full py-2 rounded bg-cyan-400/10 text-cyan-400 text-[11px] font-display uppercase tracking-widest hover:bg-cyan-400/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creating...' : 'Create Alert'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

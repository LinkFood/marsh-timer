interface RecallEntry {
  id: string;
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  effective_date: string;
}

interface RecallYear {
  year: number;
  entries: RecallEntry[];
}

interface RecallCardProps {
  recalls: RecallYear[];
  loading: boolean;
}

export default function RecallCard({ recalls, loading }: RecallCardProps) {
  if (loading) return null;
  if (recalls.length === 0) return null;

  const today = new Date();
  const monthDay = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <div className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        <span className="text-[10px] font-semibold text-amber-300/70 uppercase tracking-wider">
          This Day in History — {monthDay}
        </span>
      </div>
      <div className="space-y-2">
        {recalls.map((yearData) => (
          <div key={yearData.year}>
            <p className="text-[10px] font-semibold text-white/40 mb-1">{yearData.year}</p>
            {yearData.entries.slice(0, 3).map((entry) => (
              <div key={entry.id} className="text-[11px] text-white/60 pl-2 border-l border-amber-400/20 mb-1">
                <span className="text-amber-300/50">[{entry.content_type}]</span>{' '}
                {entry.title}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

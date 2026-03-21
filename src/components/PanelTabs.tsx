interface Tab<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface PanelTabsProps<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (tab: T) => void;
}

export default function PanelTabs<T extends string>({ tabs, active, onChange }: PanelTabsProps<T>) {
  return (
    <div className="flex gap-0.5 px-1.5 py-1 border-b border-white/[0.06] overflow-x-auto scrollbar-none shrink-0">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-2 py-0.5 text-[10px] font-mono rounded whitespace-nowrap transition-colors ${
            active === tab.id
              ? 'bg-cyan-500/20 text-cyan-400'
              : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`ml-1 ${active === tab.id ? 'text-cyan-400/60' : 'text-white/20'}`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

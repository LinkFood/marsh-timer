import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Database } from 'lucide-react';
import { CONTENT_TYPE_GROUPS, ALL_DOMAINS_GROUP, type ContentTypeGroup } from '@/data/contentTypeGroups';

interface WhatDropdownProps {
  value: string | null;
  onChange: (group: string | null) => void;
}

export default function WhatDropdown({ value, onChange }: WhatDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected: ContentTypeGroup =
    CONTENT_TYPE_GROUPS.find(g => g.key === value) || ALL_DOMAINS_GROUP;

  const Icon = selected.icon;

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0d1117] border border-white/10 hover:border-white/20 transition-colors text-left"
      >
        <Icon className={`w-4 h-4 shrink-0 ${selected.color.split(' ')[0]}`} />
        <span className="font-body text-sm text-white/90 truncate">{selected.label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-white/40 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#0d1117] border border-white/10 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto scrollbar-hide">
          {/* All Domains option */}
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors text-left ${
              !value ? 'bg-white/[0.06]' : ''
            }`}
          >
            <Database className="w-4 h-4 shrink-0 text-white/50" />
            <div className="min-w-0">
              <div className="font-body text-sm text-white/90">All Domains</div>
              <div className="font-body text-xs text-white/40">Search everything</div>
            </div>
          </button>

          <div className="border-t border-white/[0.06]" />

          {CONTENT_TYPE_GROUPS.map(group => {
            const GIcon = group.icon;
            return (
              <button
                key={group.key}
                onClick={() => { onChange(group.key); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors text-left ${
                  value === group.key ? 'bg-white/[0.06]' : ''
                }`}
              >
                <GIcon className={`w-4 h-4 shrink-0 ${group.color.split(' ')[0]}`} />
                <div className="min-w-0">
                  <div className="font-body text-sm text-white/90">{group.label}</div>
                  <div className="font-body text-xs text-white/40 truncate">{group.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

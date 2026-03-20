import { useState, type ReactNode } from 'react';
import { GripVertical, Minus, X } from 'lucide-react';

interface PanelWrapperProps {
  panelId: string;
  instanceId: string;
  label: string;
  children: ReactNode;
  onClose: () => void;
}

export default function PanelWrapper({ panelId, instanceId, label, children, onClose }: PanelWrapperProps) {
  const [minimized, setMinimized] = useState(false);

  return (
    <div className="h-full flex flex-col glass-panel border border-white/[0.06] rounded overflow-hidden">
      {/* Title bar */}
      <div className="shrink-0 h-6 flex items-center gap-1 px-1.5 border-b border-white/[0.06] bg-white/[0.02]">
        {/* Drag handle */}
        <div className="panel-drag-handle cursor-grab active:cursor-grabbing flex items-center">
          <GripVertical className="w-3 h-3 text-white/20" />
        </div>

        {/* Label */}
        <span className="flex-1 text-[10px] font-display text-white/60 truncate uppercase tracking-wider">
          {label}
        </span>

        {/* Minimize */}
        <button
          onClick={() => setMinimized((m) => !m)}
          className="flex items-center justify-center w-4 h-4 rounded-sm text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
          title={minimized ? 'Expand' : 'Minimize'}
        >
          <Minus className="w-2.5 h-2.5" />
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex items-center justify-center w-4 h-4 rounded-sm text-white/30 hover:text-red-400/80 hover:bg-red-400/10 transition-colors"
          title="Close panel"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Content */}
      {!minimized && (
        <div className="flex-1 min-h-0 overflow-auto p-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

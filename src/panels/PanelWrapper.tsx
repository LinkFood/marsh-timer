import { useState, useEffect, useRef, useCallback, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Minus, X, Maximize2, Minimize2, Share2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDeck } from '@/contexts/DeckContext';
import { generateShareUrl, copyToClipboard } from '@/lib/panelShare';

interface PanelWrapperProps {
  panelId: string;
  instanceId: string;
  label: string;
  children: ReactNode;
  onClose: () => void;
  onResize?: (dw: number, dh: number) => void;
}

export default function PanelWrapper({ panelId, instanceId, label, children, onClose, onResize }: PanelWrapperProps) {
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isMobile = useIsMobile();
  const { allMinimized } = useDeck();
  const shareRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const resizeStart = useRef({ x: 0, y: 0 });

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeStart.current = { x: e.clientX, y: e.clientY };
    document.body.style.cursor = 'se-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!onResize) return;

    const colWidth = Math.floor((window.innerWidth - 32) / 12);
    const rowHeight = 60;

    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const dx = e.clientX - resizeStart.current.x;
      const dy = e.clientY - resizeStart.current.y;

      const dCols = Math.round(dx / colWidth);
      const dRows = Math.round(dy / rowHeight);

      if (dCols !== 0 || dRows !== 0) {
        onResize(dCols, dRows);
        resizeStart.current = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onResize]);

  // ESC key handler for fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  // Close share dropdown on outside click
  useEffect(() => {
    if (!shareOpen) return;
    const handler = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [shareOpen]);

  const handleCopy = async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    setShareOpen(false);
  };

  const enhancedChildren = isValidElement(children)
    ? cloneElement(children as ReactElement<{ isFullscreen?: boolean }>, { isFullscreen: fullscreen })
    : children;

  const btnClass = 'flex items-center justify-center w-4 h-4 rounded-sm text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors';

  const titleBar = (
    <div className="shrink-0 h-6 flex items-center gap-1 px-1.5 border-b border-white/[0.06] bg-white/[0.02]">
      {/* Drag handle (desktop, non-fullscreen only) */}
      {!isMobile && !fullscreen && (
        <div className="panel-drag-handle cursor-grab active:cursor-grabbing flex items-center">
          <GripVertical className="w-3 h-3 text-white/20" />
        </div>
      )}

      {/* Label */}
      <span className="flex-1 text-[10px] font-display text-white/60 truncate uppercase tracking-wider">
        {label}
      </span>

      {/* ESC hint in fullscreen */}
      {fullscreen && (
        <span className="text-[9px] text-white/25 mr-1 hidden sm:inline">ESC to exit</span>
      )}

      {/* Minimize (not in fullscreen) */}
      {!fullscreen && (
        <button
          onClick={() => setMinimized((m) => !m)}
          className={btnClass}
          title={minimized ? 'Expand' : 'Minimize'}
        >
          <Minus className="w-2.5 h-2.5" />
        </button>
      )}

      {/* Fullscreen toggle */}
      <button
        onClick={() => setFullscreen((f) => !f)}
        className={btnClass}
        title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {fullscreen
          ? <Minimize2 className="w-2.5 h-2.5" />
          : <Maximize2 className="w-2.5 h-2.5" />
        }
      </button>

      {/* Share */}
      <div className="relative" ref={shareRef}>
        <button
          onClick={() => setShareOpen((s) => !s)}
          className={btnClass}
          title="Share"
        >
          <Share2 className="w-2.5 h-2.5" />
        </button>

        {shareOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] bg-[#141a2a] border border-white/10 rounded shadow-lg py-1">
            <button
              onClick={() => handleCopy(generateShareUrl(panelId))}
              className="w-full text-left text-[10px] text-white/60 hover:text-white/80 hover:bg-white/[0.06] px-3 py-1.5 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              onClick={() => handleCopy(`[Panel: ${label}] ${window.location.href}`)}
              className="w-full text-left text-[10px] text-white/60 hover:text-white/80 hover:bg-white/[0.06] px-3 py-1.5 transition-colors"
            >
              Copy as Text
            </button>
          </div>
        )}
      </div>

      {/* Close */}
      <button
        onClick={fullscreen ? () => setFullscreen(false) : onClose}
        className="flex items-center justify-center w-4 h-4 rounded-sm text-white/30 hover:text-red-400/80 hover:bg-red-400/10 transition-colors"
        title={fullscreen ? 'Exit fullscreen' : 'Close panel'}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );

  // Fullscreen portal
  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-50 bg-[#0a0f1a] flex flex-col transition-all duration-200">
        {titleBar}
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {enhancedChildren}
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className="relative h-full flex flex-col glass-panel border border-white/[0.06] rounded overflow-hidden">
      {titleBar}
      {!minimized && !allMinimized && (
        <div className="flex-1 min-h-0 overflow-auto p-1.5">
          {enhancedChildren}
        </div>
      )}
      {!isMobile && !fullscreen && !minimized && !allMinimized && onResize && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10 group/resize"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute right-1 bottom-1 w-2.5 h-2.5 border-r-2 border-b-2 border-white/10 group-hover/resize:border-cyan-400/40 transition-colors" />
        </div>
      )}
    </div>
  );
}

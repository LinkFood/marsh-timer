import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { GripHorizontal } from 'lucide-react';

const STORAGE_KEY = 'dc-map-height';
const MIN_HEIGHT = 200;
const DEFAULT_RATIO = 0.5;

function getMaxHeight() {
  // Account for header (48px), heartbeat (~28px), bottom bar (40px), min panel space (100px)
  return Math.round(window.innerHeight - 48 - 28 - 40 - 100);
}

function loadHeight(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const h = Number(stored);
      if (h >= MIN_HEIGHT && h <= getMaxHeight()) return h;
    }
  } catch { /* ignore */ }
  // Default to 45% of available space (viewport minus header/heartbeat/bottombar)
  return Math.round((window.innerHeight - 48 - 28 - 40) * 0.45);
}

interface MapRegionProps {
  children: ReactNode;
}

export default function MapRegion({ children }: MapRegionProps) {
  const [height, setHeight] = useState(loadHeight);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [height]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientY - startY.current;
      const next = Math.min(getMaxHeight(), Math.max(MIN_HEIGHT, startHeight.current + delta));
      setHeight(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Save on release
      try { localStorage.setItem(STORAGE_KEY, String(height)); } catch { /* ignore */ }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [height]);

  // Touch support for mobile
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragging.current = true;
    startY.current = e.touches[0].clientY;
    startHeight.current = height;
  }, [height]);

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      const delta = e.touches[0].clientY - startY.current;
      const next = Math.min(getMaxHeight(), Math.max(MIN_HEIGHT, startHeight.current + delta));
      setHeight(next);
    };

    const onTouchEnd = () => {
      if (!dragging.current) return;
      dragging.current = false;
      try { localStorage.setItem(STORAGE_KEY, String(height)); } catch { /* ignore */ }
    };

    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [height]);

  return (
    <div className="shrink-0 relative" style={{ height }}>
      {/* Map content */}
      <div className="absolute inset-0">{children}</div>

      {/* Drag divider */}
      <div
        className="absolute bottom-0 left-0 right-0 h-3 flex items-center justify-center cursor-row-resize z-20 group"
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        <div className="w-full h-px bg-white/[0.06] group-hover:bg-cyan-400/30 transition-colors" />
        <div className="absolute flex items-center justify-center w-8 h-4 rounded-sm bg-white/[0.04] group-hover:bg-cyan-400/10 transition-colors">
          <GripHorizontal className="w-3 h-3 text-white/20 group-hover:text-cyan-400/50" />
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { GripHorizontal } from 'lucide-react';
import { useDeck } from '@/contexts/DeckContext';

const MIN_HEIGHT = 150;

function getMaxHeight() {
  return Math.round(window.innerHeight - 48 - 28 - 40 - 250);
}

interface MapRegionProps {
  children: ReactNode;
}

export default function MapRegion({ children }: MapRegionProps) {
  const { mapHeight, setMapHeight } = useDeck();
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startHeight.current = mapHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [mapHeight]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientY - startY.current;
      const next = Math.min(getMaxHeight(), Math.max(MIN_HEIGHT, startHeight.current + delta));
      setMapHeight(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [setMapHeight]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragging.current = true;
    startY.current = e.touches[0].clientY;
    startHeight.current = mapHeight;
  }, [mapHeight]);

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      const delta = e.touches[0].clientY - startY.current;
      const next = Math.min(getMaxHeight(), Math.max(MIN_HEIGHT, startHeight.current + delta));
      setMapHeight(next);
    };

    const onTouchEnd = () => {
      if (!dragging.current) return;
      dragging.current = false;
    };

    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [setMapHeight]);

  return (
    <div className="relative h-full">
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

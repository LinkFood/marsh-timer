import React, { useState, useRef, useCallback, useEffect } from "react";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoints?: [number, number, number];
}

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  snapPoints = [0.08, 0.45, 0.92],
}: BottomSheetProps) {
  const [currentSnap, setCurrentSnap] = useState(1);
  const [translateY, setTranslateY] = useState<number | null>(null);
  const startY = useRef(0);
  const startTranslate = useRef(0);
  const dragging = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const getSnapY = useCallback(
    (snapIndex: number) => {
      return (1 - snapPoints[snapIndex]) * 100;
    },
    [snapPoints]
  );

  // Reset to half snap when opened
  useEffect(() => {
    if (isOpen) {
      setCurrentSnap(1);
      setTranslateY(null);
    }
  }, [isOpen]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      dragging.current = true;
      startY.current = e.touches[0].clientY;
      startTranslate.current = translateY ?? getSnapY(currentSnap);
    },
    [translateY, currentSnap, getSnapY]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!dragging.current) return;
      const deltaY = e.touches[0].clientY - startY.current;
      const dvhDelta = (deltaY / window.innerHeight) * 100;
      const newTranslate = Math.max(0, startTranslate.current + dvhDelta);
      setTranslateY(newTranslate);
    },
    []
  );

  const handleTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;

    const currentY = translateY ?? getSnapY(currentSnap);
    const closeThreshold = (1 - snapPoints[0]) * 100 + 5;

    // If dragged below peek, close
    if (currentY > closeThreshold) {
      setTranslateY(100);
      setTimeout(onClose, 300);
      return;
    }

    // Find nearest snap point
    let nearestSnap = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < snapPoints.length; i++) {
      const snapY = getSnapY(i);
      const dist = Math.abs(currentY - snapY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestSnap = i;
      }
    }

    setCurrentSnap(nearestSnap);
    setTranslateY(null);
  }, [translateY, currentSnap, snapPoints, getSnapY, onClose]);

  if (!isOpen) return null;

  const activeTranslateY = translateY ?? getSnapY(currentSnap);
  const showBackdrop = activeTranslateY < getSnapY(0);
  const backdropOpacity = showBackdrop
    ? Math.min(0.5, ((getSnapY(0) - activeTranslateY) / getSnapY(0)) * 0.5)
    : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black"
        style={{ opacity: backdropOpacity, pointerEvents: backdropOpacity > 0 ? "auto" : "none" }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 w-full rounded-t-2xl map-overlay-panel"
        style={{
          height: "100dvh",
          transform: `translateY(${activeTranslateY}dvh)`,
          transition: dragging.current ? "none" : "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
          willChange: "transform",
        }}
      >
        {/* Handle */}
        <div
          className="bottom-sheet-handle"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-gray-400 mx-auto my-3" />
        </div>

        {/* Content */}
        <div
          className="overflow-y-auto scrollbar-hide px-4 pb-8"
          style={{ height: `calc(${snapPoints[2] * 100}dvh - 2rem)` }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

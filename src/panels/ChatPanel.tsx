import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import HuntChat from '@/components/HuntChat';
import { useDeck } from '@/contexts/DeckContext';
import { useIsMobile } from '@/hooks/useIsMobile';

export default function ChatPanel() {
  const { chatOpen, setChatOpen, species, selectedState } = useDeck();
  const isMobile = useIsMobile();

  return (
    <AnimatePresence>
      {chatOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`fixed top-12 bottom-11 right-0 z-40 ${isMobile ? 'left-0' : 'w-[400px]'} glass-panel border-l border-white/[0.06] flex flex-col`}
        >
          {/* Header */}
          <div className="shrink-0 h-10 px-3 flex items-center justify-between border-b border-white/[0.06]">
            <span className="text-[10px] font-display uppercase tracking-widest text-white/50">Brain Chat</span>
            <button
              onClick={() => setChatOpen(false)}
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          {/* Chat body */}
          <div className="flex-1 min-h-0">
            <HuntChat species={species} stateAbbr={selectedState} isMobile={isMobile} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

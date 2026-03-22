import BrainChat from '@/components/BrainChat';
import { useDeck } from '@/contexts/DeckContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { PanelComponentProps } from './PanelTypes';

export default function ChatPanelInline({}: PanelComponentProps) {
  const { species, selectedState } = useDeck();
  const isMobile = useIsMobile();

  return (
    <div className="h-full">
      <BrainChat species={species} stateAbbr={selectedState} isMobile={isMobile} />
    </div>
  );
}

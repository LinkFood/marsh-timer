import HuntChat from '@/components/HuntChat';
import { useDeck } from '@/contexts/DeckContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { PanelComponentProps } from './PanelTypes';

export default function ChatPanelInline({}: PanelComponentProps) {
  const { species, selectedState } = useDeck();
  const isMobile = useIsMobile();

  return (
    <div className="h-full">
      <HuntChat species={species} stateAbbr={selectedState} isMobile={isMobile} />
    </div>
  );
}

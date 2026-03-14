import type { ChatMessage as ChatMessageType, ChatCard } from '@/hooks/useChat';
import { useMapAction } from '@/contexts/MapActionContext';
import WeatherCard from './cards/WeatherCard';
import SeasonCard from './cards/SeasonCard';
import SolunarCard from './cards/SolunarCard';
import AlertCard from './cards/AlertCard';
import ConvergenceCard from './cards/ConvergenceCard';
import { MapPin } from 'lucide-react';

interface ChatMessageProps {
  message: ChatMessageType;
}

function formatMarkdown(text: string): string {
  return text
    // Strip URLs (no external links)
    .replace(/https?:\/\/[^\s)]+/g, '')
    // Headings: ## Header or ### Header
    .replace(/^###\s+(.+)$/gm, '<span class="block text-[11px] font-semibold text-white/70 mt-2 mb-0.5">$1</span>')
    .replace(/^##\s+(.+)$/gm, '<span class="block text-xs font-semibold text-white/80 mt-2 mb-0.5">$1</span>')
    // Bold: **text**
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white/90 font-semibold">$1</strong>')
    // Italic: *text*
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    // Horizontal rules: ---
    .replace(/^---$/gm, '<hr class="border-white/10 my-1.5" />')
    // Unordered lists: - item
    .replace(/^[-•]\s+(.+)$/gm, '<span class="block pl-2 before:content-[\'•\'] before:mr-1.5 before:text-white/30">$1</span>')
    // Numbered lists: 1. item
    .replace(/^\d+\.\s+(.+)$/gm, '<span class="block pl-2">$1</span>')
    // Line breaks
    .replace(/\n/g, '<br />');
}

function renderCard(card: ChatCard, index: number) {
  switch (card.type) {
    case 'weather':
      return <WeatherCard key={index} data={card.data} />;
    case 'season':
      return <SeasonCard key={index} data={card.data} />;
    case 'solunar':
      return <SolunarCard key={index} data={card.data} />;
    case 'alert':
      return <AlertCard key={index} data={card.data} />;
    case 'convergence':
      return <ConvergenceCard key={index} {...(card.data as any)} />;
    default:
      return null;
  }
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const { flyTo } = useMapAction();
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs font-body ${
          isUser
            ? 'bg-cyan-400/10 text-white/90'
            : 'bg-white/[0.03] text-white/80 border border-white/[0.06]'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="chat-markdown leading-relaxed" dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }} />
        )}
        {message.mapAction && (
          <button
            onClick={() => flyTo(message.mapAction!.target)}
            className="flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full text-xs font-medium bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 transition-colors"
          >
            <MapPin className="w-3 h-3" />
            View {message.mapAction.target} on map
          </button>
        )}
        {message.cards && message.cards.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.cards.map((card, i) => renderCard(card, i))}
          </div>
        )}
        <p className="text-[10px] text-white/20 mt-1">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

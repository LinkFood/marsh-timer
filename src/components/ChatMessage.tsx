import type { ChatMessage as ChatMessageType, ChatCard } from '@/hooks/useChat';
import WeatherCard from './cards/WeatherCard';
import SeasonCard from './cards/SeasonCard';
import SolunarCard from './cards/SolunarCard';
import AlertCard from './cards/AlertCard';

interface ChatMessageProps {
  message: ChatMessageType;
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
    default:
      return null;
  }
}

export default function ChatMessage({ message }: ChatMessageProps) {
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
        <p className="whitespace-pre-wrap">{message.content}</p>
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

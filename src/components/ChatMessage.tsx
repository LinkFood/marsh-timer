import type { ReactNode, ReactElement } from 'react';
import type { ChatMessage as ChatMessageType, ChatCard } from '@/hooks/useChat';
import WeatherCard from './cards/WeatherCard';
import SeasonCard from './cards/SeasonCard';
import SolunarCard from './cards/SolunarCard';
import AlertCard from './cards/AlertCard';
import ConvergenceCard from './cards/ConvergenceCard';
import PatternCard from './cards/PatternCard';
import SourceCard from './cards/SourceCard';
import PatternLinksCard from './cards/PatternLinksCard';
import { MapPin } from 'lucide-react';

interface ChatMessageProps {
  message: ChatMessageType;
}

function processInline(text: string): (string | ReactElement)[] {
  const result: (string | ReactElement)[] = [];
  // Strip URLs
  const cleaned = text.replace(/https?:\/\/[^\s)]+/g, '');
  // Process bold and italic
  const parts = cleaned.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('**') && part.endsWith('**')) {
      result.push(<strong key={i} className="text-white/90 font-semibold">{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      result.push(<em key={i}>{part.slice(1, -1)}</em>);
    } else if (part) {
      result.push(part);
    }
  }
  return result;
}

function parseMarkdown(text: string): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^###\s+(.+)$/)) {
      const content = line.replace(/^###\s+/, '');
      nodes.push(<span key={i} className="block text-[11px] font-semibold text-white/70 mt-2 mb-0.5">{processInline(content)}</span>);
    } else if (line.match(/^##\s+(.+)$/)) {
      const content = line.replace(/^##\s+/, '');
      nodes.push(<span key={i} className="block text-xs font-semibold text-white/80 mt-2 mb-0.5">{processInline(content)}</span>);
    } else if (line.match(/^---$/)) {
      nodes.push(<hr key={i} className="border-white/10 my-1.5" />);
    } else if (line.match(/^[-•]\s+(.+)$/)) {
      const content = line.replace(/^[-•]\s+/, '');
      nodes.push(
        <span key={i} className="block pl-2">
          <span className="mr-1.5 text-white/30">•</span>
          {processInline(content)}
        </span>
      );
    } else if (line.match(/^\d+\.\s+(.+)$/)) {
      const content = line.replace(/^\d+\.\s+/, '');
      nodes.push(<span key={i} className="block pl-2">{processInline(content)}</span>);
    } else if (line.trim() === '') {
      nodes.push(<br key={i} />);
    } else {
      nodes.push(<span key={i} className="block">{processInline(line)}</span>);
    }
  }

  return nodes;
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
    case 'pattern':
      return <PatternCard key={index} data={card.data} />;
    case 'source':
      return <SourceCard key={index} data={card.data} />;
    case 'pattern-links':
      return <PatternLinksCard key={index} data={card.data as any} />;
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
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="chat-markdown leading-relaxed">{parseMarkdown(message.content)}</div>
        )}
        {message.mapAction && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-cyan-400/50">
            <MapPin className="w-3 h-3" />
            <span>Viewing {message.mapAction.target} on map</span>
          </div>
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

import { useMemo, type ReactNode, type ReactElement } from 'react';
import type { ChatMessage as ChatMessageType, ChatCard } from '@/hooks/useChat';
import WeatherCard from './cards/WeatherCard';
import SeasonCard from './cards/SeasonCard';
import SolunarCard from './cards/SolunarCard';
import AlertCard from './cards/AlertCard';
import ConvergenceCard from './cards/ConvergenceCard';
import PatternCard from './cards/PatternCard';
import SourceCard from './cards/SourceCard';
import PatternLinksCard from './cards/PatternLinksCard';
import { MapPin, Compass, Database } from 'lucide-react';

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
      nodes.push(
        <span key={i} className="block text-[11px] font-semibold text-white/80 mt-2.5 mb-1 pl-2 border-l-2 border-cyan-400/30">
          {processInline(content)}
        </span>
      );
    } else if (line.match(/^##\s+(.+)$/)) {
      const content = line.replace(/^##\s+/, '');
      nodes.push(
        <span key={i} className="block text-xs font-semibold text-white/90 mt-3 mb-1 pl-2 border-l-2 border-cyan-400/40">
          {processInline(content)}
        </span>
      );
    } else if (line.match(/^---$/)) {
      nodes.push(<hr key={i} className="border-white/[0.06] my-2" />);
    } else if (line.match(/^[-•]\s+(.+)$/)) {
      const content = line.replace(/^[-•]\s+/, '');
      nodes.push(
        <span key={i} className="block pl-3 py-0.5">
          <span className="mr-1.5 text-cyan-400/50">•</span>
          {processInline(content)}
        </span>
      );
    } else if (line.match(/^\d+\.\s+(.+)$/)) {
      const match = line.match(/^(\d+)\.\s+(.+)$/);
      if (match) {
        nodes.push(
          <span key={i} className="block pl-3 py-0.5">
            <span className="mr-1.5 text-cyan-400/50 font-medium">{match[1]}.</span>
            {processInline(match[2])}
          </span>
        );
      }
    } else if (line.trim() === '') {
      nodes.push(<div key={i} className="h-1.5" />);
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
    case 'activity': {
      const d = card.data || {};
      return (
        <div key={index} className="space-y-1.5 py-1">
          <div className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">Brain Activity — Last 24h</div>
          <div className="grid grid-cols-2 gap-1">
            <div className="text-[11px] text-white/80">
              <span className="text-lg font-bold text-white">{d.total_24h || 0}</span>
              <span className="text-white/40 ml-1">entries</span>
            </div>
            <div className="text-[11px] text-white/80">
              <span className="text-lg font-bold text-cyan-400">{d.high_signal_count || 0}</span>
              <span className="text-white/40 ml-1">high-signal</span>
            </div>
          </div>
          {Array.isArray(d.top_states) && d.top_states.length > 0 && (
            <div className="text-[10px] text-white/50">
              Most active: {d.top_states.map(([st, ct]: [string, number]) => `${st} (${ct})`).join(', ')}
            </div>
          )}
          {d.by_type && Object.keys(d.by_type).length > 0 && (
            <div className="text-[9px] text-white/30 mt-1">
              {Object.entries(d.by_type as Record<string, number>)
                .sort((a, b) => (b[1] as number) - (a[1] as number))
                .slice(0, 5)
                .map(([type, count]) => `${type}: ${count}`)
                .join(' \u00b7 ')}
            </div>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const parsedContent = useMemo(() => parseMarkdown(message.content), [message.content]);
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs font-body bg-cyan-400/10 text-white/90 border border-cyan-400/10">
          <p className="whitespace-pre-wrap">{message.content}</p>
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
          <p className="text-[9px] text-white/15 mt-1.5 text-right">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    );
  }

  const cards = Array.isArray(message.cards) ? message.cards : [];
  const BRAIN_CARD_TYPES = ['pattern', 'source', 'convergence', 'weather', 'activity', 'pattern-links', 'alert'];
  const brainCards = cards.filter(c => BRAIN_CARD_TYPES.includes(c.type));
  const aiCards = cards.filter(c => !BRAIN_CARD_TYPES.includes(c.type));

  return (
    <div className="flex items-start gap-2 mb-3 animate-in fade-in duration-300">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-400/10 flex items-center justify-center mt-0.5">
        <Compass className="w-3.5 h-3.5 text-cyan-400/60" />
      </div>
      <div className="max-w-[85%] space-y-2">
        {/* Brain section — always shown for assistant messages */}
        <div className="rounded-xl px-3.5 py-2.5 text-xs font-body bg-white/[0.04] border border-cyan-400/30">
          <div className="flex items-center gap-1.5 mb-2">
            <Database size={10} className="text-cyan-400/60" />
            <span className="text-[10px] font-semibold text-cyan-400/70 uppercase tracking-wider">From the Brain</span>
          </div>
          {brainCards.length > 0 ? (
            <div className="space-y-2">
              {brainCards.map((card, i) => renderCard(card, i))}
            </div>
          ) : (
            <p className="text-[10px] text-white/40">Brain searched — no matching data found</p>
          )}
        </div>

        {/* AI interpretation section */}
        <div className="rounded-xl px-3.5 py-2.5 text-xs font-body bg-white/[0.04] text-white/80 border border-white/[0.08]">
          <div className="flex items-center gap-1.5 mb-2">
            <Compass size={10} className="text-white/30" />
            <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">AI Interpretation</span>
          </div>
          <div className="chat-markdown leading-relaxed">{parsedContent}</div>
          {message.mapAction && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-cyan-400/50">
              <MapPin className="w-3 h-3" />
              <span>Viewing {message.mapAction.target} on map</span>
            </div>
          )}
          {aiCards.length > 0 && (
            <div className="mt-2 space-y-2">
              {aiCards.map((card, i) => renderCard(card, i))}
            </div>
          )}
          <p className="text-[9px] text-white/15 mt-1.5">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
}

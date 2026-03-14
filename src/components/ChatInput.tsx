import { useState, useRef, useEffect } from 'react';
import { Send, LogIn } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  loading?: boolean;
  stateAbbr?: string | null;
}

export default function ChatInput({ onSend, disabled, loading, stateAbbr }: ChatInputProps) {
  const { user, signIn } = useAuth();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [value]);

  const handleSubmit = () => {
    if (!value.trim() || disabled || loading) return;
    onSend(value.trim());
    setValue('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const placeholder = !user
    ? "Sign in for unlimited chat..."
    : stateAbbr
      ? `Ask about ${stateAbbr}...`
      : "Ask the brain anything...";

  return (
    <div className="px-3 py-2 border-t border-white/[0.06]">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 resize-none rounded-xl bg-white/[0.04] border border-white/[0.08] focus:border-cyan-400/30 focus:ring-1 focus:ring-cyan-400/20 focus:outline-none px-3 py-2 text-xs font-body text-white/90 placeholder:text-white/30 scrollbar-hide"
          disabled={disabled || loading}
        />
        {!user ? (
          <button
            onClick={signIn}
            className="shrink-0 bg-cyan-400/20 hover:bg-cyan-400/30 text-cyan-400 rounded-lg p-1.5 transition-colors"
            title="Sign in"
          >
            <LogIn size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled || loading}
            className="shrink-0 bg-cyan-400/20 hover:bg-cyan-400/30 text-cyan-400 rounded-lg p-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5 px-1">
        {!user ? (
          <p className="text-[9px] text-white/40 font-body">
            3 free queries per day. <button onClick={signIn} className="underline hover:text-white/80">Sign in</button> for more.
          </p>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400/60 animate-pulse" />
            <span className="text-[9px] text-white/30 font-body">Brain active</span>
          </div>
        )}
      </div>
    </div>
  );
}

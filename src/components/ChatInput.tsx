import { useState, useRef, useEffect } from 'react';
import { Send, LogIn } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

export default function ChatInput({ onSend, disabled, loading }: ChatInputProps) {
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

  return (
    <div className="border-t border-white/[0.06] p-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={user ? "Ask about seasons, weather, solunar..." : "Sign in for unlimited chat..."}
          rows={1}
          className="flex-1 resize-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-body text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-cyan-400/20 focus:border-cyan-400/30 scrollbar-hide"
          disabled={disabled || loading}
        />
        {!user ? (
          <button
            onClick={signIn}
            className="shrink-0 p-2 rounded-lg bg-white/5 text-cyan-400 hover:text-cyan-300 transition-colors"
            title="Sign in"
          >
            <LogIn size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled || loading}
            className="shrink-0 p-2 rounded-lg bg-white/5 text-cyan-400 hover:text-cyan-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        )}
      </div>
      {!user && (
        <p className="text-[9px] text-white/40 mt-1 px-1 font-body">
          3 free queries per day. <button onClick={signIn} className="underline hover:text-white/80">Sign in</button> for more.
        </p>
      )}
    </div>
  );
}

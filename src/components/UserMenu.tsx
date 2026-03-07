import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { User, LogOut } from 'lucide-react';

export default function UserMenu() {
  const { user, profile, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!user) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); signIn(); }}
        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-body font-semibold text-muted-foreground hover:text-foreground transition-colors border border-border/50 hover:border-border"
      >
        <User size={14} />
        <span className="hidden sm:inline">Sign In</span>
      </button>
    );
  }

  const avatarUrl = profile?.avatar_url;
  const displayName = profile?.display_name || user.email?.split('@')[0] || 'Hunter';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full hover:ring-2 hover:ring-primary/30 transition-all"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
            <User size={14} className="text-primary" />
          </div>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-lg shadow-xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-xs font-body font-semibold text-foreground truncate">{displayName}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
          </div>
          <button
            onClick={() => { signOut(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <LogOut size={12} />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

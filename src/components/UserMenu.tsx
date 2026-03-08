import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { User, LogOut } from 'lucide-react';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, 3);
  return `${visible}***@${domain}`;
}

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
        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-body font-semibold text-white/50 hover:text-white/80 transition-colors border border-white/10 hover:border-white/20"
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
        <div className="absolute right-0 top-full mt-2 w-48 glass-panel border border-white/[0.06] rounded-lg shadow-xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <p className="text-xs font-body font-semibold text-white/90 truncate">{displayName}</p>
            <p className="text-[10px] text-white/40 truncate">{maskEmail(user.email || '')}</p>
          </div>
          <button
            onClick={() => { signOut(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-white/40 hover:text-white/90 hover:bg-white/[0.05] transition-colors"
          >
            <LogOut size={12} />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

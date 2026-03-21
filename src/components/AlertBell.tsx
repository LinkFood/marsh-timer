import { useState, useRef, useEffect } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useUserAlerts } from '@/hooks/useUserAlerts';
import AlertManager from './AlertManager';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function AlertBell() {
  const { history, unreadCount, markRead, markAllRead } = useUserAlerts();
  const [open, setOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <>
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="relative p-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Alerts"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute top-full right-0 mt-2 w-72 bg-[#0a0f1a]/90 backdrop-blur-sm border border-white/[0.06] rounded-lg shadow-xl z-50 max-h-80 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-display uppercase tracking-widest text-white/30">Alerts</span>
                {unreadCount > 0 && (
                  <span className="text-[9px] font-body text-cyan-400">{unreadCount} new</span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead()}
                  className="flex items-center gap-1 text-[10px] font-body text-white/40 hover:text-white/70 transition-colors"
                >
                  <CheckCheck className="w-3 h-3" />
                  Mark All Read
                </button>
              )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <Bell className="w-5 h-5 text-white/10 mx-auto mb-2" />
                  <p className="text-[11px] font-body text-white/30">No alerts yet</p>
                </div>
              ) : (
                history.slice(0, 20).map(item => (
                  <button
                    key={item.id}
                    onClick={() => { if (!item.read) markRead(item.id); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] transition-colors flex items-start gap-2 border-b border-white/[0.03] last:border-0"
                  >
                    {/* Unread dot */}
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${item.read ? 'bg-transparent' : 'bg-cyan-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-body truncate ${item.read ? 'text-white/50' : 'text-white/90'}`}>
                          {item.title}
                        </span>
                        <span className="text-[9px] font-body text-white/25 flex-shrink-0">
                          {timeAgo(item.created_at)}
                        </span>
                      </div>
                      {item.body && (
                        <p className="text-[10px] font-body text-white/30 truncate mt-0.5">{item.body}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-white/[0.06] px-3 py-2">
              <button
                onClick={() => { setManagerOpen(true); setOpen(false); }}
                className="w-full text-center text-[10px] font-body text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                + Create Alert
              </button>
            </div>
          </div>
        )}
      </div>

      <AlertManager open={managerOpen} onClose={() => setManagerOpen(false)} />
    </>
  );
}

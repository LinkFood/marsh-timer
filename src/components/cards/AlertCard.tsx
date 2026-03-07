import { AlertTriangle } from 'lucide-react';

interface AlertCardProps {
  data: Record<string, unknown>;
}

export default function AlertCard({ data }: AlertCardProps) {
  const title = data.title as string | undefined;
  const message = data.message as string | undefined;
  const severity = (data.severity as string) || 'info';
  const countdown = data.countdown as string | undefined;

  const colors: Record<string, string> = {
    info: 'bg-blue-950/30 border-blue-500/20 text-blue-300',
    warning: 'bg-yellow-950/30 border-yellow-500/20 text-yellow-300',
    urgent: 'bg-red-950/30 border-red-500/20 text-red-300',
    success: 'bg-green-950/30 border-green-500/20 text-green-300',
  };

  return (
    <div className={`rounded-lg border p-2.5 ${colors[severity] || colors.info}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <AlertTriangle size={12} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{title || 'Alert'}</span>
      </div>
      {message && <p className="text-[10px] text-foreground">{message}</p>}
      {countdown && (
        <p className="text-[10px] font-bold mt-1">{countdown}</p>
      )}
    </div>
  );
}

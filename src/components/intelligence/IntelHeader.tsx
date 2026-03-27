import { Link } from 'react-router-dom';
import type { OpsData } from '@/hooks/useOpsData';
import type { StateArc } from '@/hooks/useStateArcs';

interface IntelHeaderProps {
  opsData: OpsData;
  arcs: StateArc[];
  embeddingsToday: number;
  selectedState: string | null;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export default function IntelHeader({ opsData, arcs, embeddingsToday, selectedState, chatOpen, onToggleChat }: IntelHeaderProps) {
  const totalGraded = opsData.alerts.confirmed + opsData.alerts.partial + opsData.alerts.missed + opsData.alerts.false_alarm;
  const cronTotal = opsData.crons.healthy_count + opsData.crons.error_count + opsData.crons.late_count + opsData.crons.unknown_count;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', borderBottom: '1px solid #1f2937', backgroundColor: '#060b14', height: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: '#22d3ee', letterSpacing: 2 }}>DCD</span>
        <div style={{ width: 1, height: 12, backgroundColor: '#1f2937' }} />
        <div style={{ display: 'flex', gap: 10, fontSize: 9, fontFamily: 'monospace' }}>
          <span><span style={{ color: '#ffffff28' }}>BRAIN</span> <span style={{ color: '#22d3ee', fontWeight: 700 }}>{opsData.brain.total.toLocaleString()}</span></span>
          <span><span style={{ color: '#ffffff28' }}>CRONS</span> <span style={{ color: '#34d399' }}>{opsData.crons.healthy_count}</span><span style={{ color: '#ffffff12' }}>/{cronTotal}</span></span>
          <span><span style={{ color: '#ffffff28' }}>ARCS</span> <span style={{ color: '#fbbf24' }}>{arcs.length}</span></span>
          <span><span style={{ color: '#ffffff28' }}>EMB</span> <span style={{ color: '#34d399' }}>{embeddingsToday}</span></span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onToggleChat}
          style={{ fontSize: 8, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3, border: '1px solid #22d3ee30', backgroundColor: chatOpen ? '#22d3ee12' : 'transparent', color: '#22d3ee', cursor: 'pointer' }}
        >
          {chatOpen ? '✕ CHAT' : 'ASK BRAIN'}
        </button>
        <Link
          to={selectedState ? `/?state=${selectedState}` : '/'}
          style={{ fontSize: 8, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3, border: '1px solid #ffffff12', color: '#ffffff40', textDecoration: 'none' }}
        >
          MAP &rarr;
        </Link>
        {totalGraded < 10 ? (
          <span style={{ fontSize: 9, fontFamily: 'monospace' }}>
            <span style={{ color: '#fbbf24', fontStyle: 'italic' }}>learning</span>{' '}
            <span style={{ color: '#ffffff12' }}>{totalGraded}/10</span>
          </span>
        ) : (
          <span style={{ fontSize: 9, fontFamily: 'monospace' }}>
            <span style={{ color: opsData.alerts.accuracy >= 60 ? '#34d399' : '#fbbf24', fontWeight: 700 }}>{opsData.alerts.accuracy}%</span>
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#34d399' }} />
          <span style={{ color: '#34d399', fontWeight: 700, fontSize: 8, letterSpacing: 2 }}>LIVE</span>
        </div>
      </div>
    </div>
  );
}

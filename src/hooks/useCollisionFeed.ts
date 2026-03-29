import { useMemo } from 'react';
import type { JournalEntry } from '@/hooks/useBrainJournal';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';

export type CollisionType = 'compound-risk' | 'correlation' | 'anomaly' | 'score-spike' | 'grade-reasoning' | 'convergence' | 'arc-fingerprint';

export interface CollisionEntry {
  id: string;
  type: CollisionType;
  stateAbbr: string | null;
  timestamp: string;
  title: string;
  detail: string | null;
  severity: 'high' | 'medium' | 'low';
  domains?: string[];
  convergingCount?: number;
  similarity?: number;
  seedType?: string;
  matchType?: string;
  zScore?: number;
  direction?: string;
  seedTitle?: string;
  matchTitle?: string;
  crossDomainMatches?: number;
}

export type CollisionFilter = 'all' | 'connections' | 'alerts' | 'grades';

const TYPE_MAP: Record<string, CollisionType> = {
  'compound-risk-alert': 'compound-risk',
  'correlation-discovery': 'correlation',
  'anomaly-alert': 'anomaly',
  'arc-grade-reasoning': 'grade-reasoning',
  'convergence-score': 'convergence',
  'arc-fingerprint': 'arc-fingerprint',
};

const EXCLUDED_TYPES = new Set(['state-brief', 'convergence-score']);

function journalToCollision(entry: JournalEntry): CollisionEntry | null {
  if (EXCLUDED_TYPES.has(entry.content_type)) return null;
  const type = TYPE_MAP[entry.content_type];
  if (!type) return null;

  let title = '';
  let severity: 'high' | 'medium' | 'low' = 'medium';
  const meta = entry.metadata as Record<string, unknown> | null;
  const domains = Array.isArray(meta?.domain_types) ? (meta.domain_types as string[]) : undefined;
  const convergingCount = typeof meta?.converging_domains === 'number' ? meta.converging_domains as number : domains?.length;

  switch (type) {
    case 'compound-risk':
      title = `${entry.state_abbr || '??'} — ${convergingCount || '?'} domains converging`;
      severity = 'high';
      break;
    case 'correlation': {
      const seedType = (meta?.seed_type as string || '').replace(/-/g, ' ');
      const matchType = (meta?.match_type as string || '').replace(/-/g, ' ');
      const sim = typeof meta?.similarity === 'number' ? `${Math.round((meta.similarity as number) * 100)}%` : '';
      title = sim
        ? `${entry.state_abbr || ''} — ${seedType} linked to ${matchType} (${sim} similar)`
        : `${entry.state_abbr || ''} — cross-domain connection found`;
      severity = 'medium';
      break;
    }
    case 'anomaly': {
      const zScore = typeof meta?.z_score === 'number' ? Math.abs(meta.z_score as number).toFixed(1) : null;
      const dir = meta?.direction === 'above' ? 'above' : 'below';
      const checkName = (meta?.check_name as string || 'Statistical outlier').replace(/-/g, ' ');
      title = zScore
        ? `${entry.state_abbr || '??'} — ${checkName}: ${zScore}σ ${dir} normal`
        : `${entry.state_abbr || '??'} — ${checkName}`;
      severity = 'medium';
      break;
    }
    case 'grade-reasoning':
      title = `${entry.state_abbr || ''} — Grade post-mortem`;
      severity = 'low';
      break;
    case 'convergence':
      title = `${entry.state_abbr || '??'} scored ${typeof meta?.score === 'number' ? meta.score : '?'}/100`;
      severity = 'low';
      break;
    case 'arc-fingerprint':
      title = `${entry.state_abbr || ''} — Arc pattern recorded`;
      severity = 'low';
      break;
  }

  return {
    id: `brain-${entry.id}`,
    type,
    stateAbbr: entry.state_abbr,
    timestamp: entry.created_at,
    title,
    detail: entry.content?.slice(0, 400) || null,
    severity,
    domains,
    convergingCount,
    similarity: typeof meta?.similarity === 'number' ? meta.similarity as number : undefined,
    seedType: typeof meta?.seed_type === 'string' ? (meta.seed_type as string).replace(/-/g, ' ') : undefined,
    matchType: typeof meta?.match_type === 'string' ? (meta.match_type as string).replace(/-/g, ' ') : undefined,
    zScore: typeof meta?.z_score === 'number' ? meta.z_score as number : undefined,
    direction: typeof meta?.direction === 'string' ? meta.direction as string : undefined,
    seedTitle: typeof meta?.seed_title === 'string' ? meta.seed_title as string : undefined,
    matchTitle: typeof meta?.match_title === 'string' ? meta.match_title as string : undefined,
    crossDomainMatches: typeof meta?.cross_domain_matches === 'number' ? meta.cross_domain_matches as number : undefined,
  };
}

function alertToCollision(alert: ConvergenceAlert): CollisionEntry {
  const delta = alert.score - alert.previous_score;
  return {
    id: `alert-${alert.state_abbr}-${alert.created_at}`,
    type: 'score-spike',
    stateAbbr: alert.state_abbr,
    timestamp: alert.created_at,
    title: `${alert.state_abbr} score jumped ${delta > 0 ? '+' : ''}${delta} pts (${alert.previous_score} → ${alert.score})`,
    detail: alert.reasoning?.slice(0, 400) || null,
    severity: Math.abs(delta) >= 15 ? 'high' : Math.abs(delta) >= 8 ? 'medium' : 'low',
  };
}

const FILTER_MAP: Record<CollisionFilter, CollisionType[]> = {
  all: ['compound-risk', 'correlation', 'anomaly', 'score-spike', 'grade-reasoning'],
  connections: ['compound-risk', 'correlation'],
  alerts: ['anomaly', 'score-spike'],
  grades: ['grade-reasoning', 'arc-fingerprint'],
};

export function useCollisionFeed(
  journalEntries: JournalEntry[],
  convergenceAlerts: ConvergenceAlert[],
  stateFilter: string | null = null,
) {
  const entries = useMemo(() => {
    const collisions: CollisionEntry[] = [];

    for (const entry of journalEntries) {
      const collision = journalToCollision(entry);
      if (collision) collisions.push(collision);
    }

    for (const alert of convergenceAlerts) {
      collisions.push(alertToCollision(alert));
    }

    // Sort chronologically, dedup by title (anomaly detector can produce duplicate entries)
    const sorted = collisions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const seen = new Set<string>();
    let deduped = sorted.filter(e => {
      if (seen.has(e.title)) return false;
      seen.add(e.title);
      return true;
    });

    if (stateFilter) {
      deduped = deduped.filter(e => e.stateAbbr === stateFilter);
    }

    return deduped;
  }, [journalEntries, convergenceAlerts, stateFilter]);

  const filterEntries = useMemo(() => {
    return (category: CollisionFilter) => {
      if (category === 'all') return entries;
      const types = FILTER_MAP[category];
      return entries.filter(e => types.includes(e.type));
    };
  }, [entries]);

  return { entries, filterEntries };
}

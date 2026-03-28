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

const EXCLUDED_TYPES = new Set(['state-brief']);

function journalToCollision(entry: JournalEntry): CollisionEntry | null {
  if (EXCLUDED_TYPES.has(entry.content_type)) return null;
  const type = TYPE_MAP[entry.content_type];
  if (!type) return null;

  let title = '';
  let severity: 'high' | 'medium' | 'low' = 'medium';

  switch (type) {
    case 'compound-risk':
      title = `${entry.state_abbr || '??'} — Compound risk: ${entry.title}`;
      severity = 'high';
      break;
    case 'correlation':
      title = `Brain found connection: ${entry.title}`;
      severity = 'medium';
      break;
    case 'anomaly':
      title = `Anomaly in ${entry.state_abbr || '??'}: ${entry.title}`;
      severity = 'medium';
      break;
    case 'grade-reasoning':
      title = `Grade post-mortem: ${entry.state_abbr || ''} ${entry.title}`;
      severity = 'low';
      break;
    case 'convergence':
      title = `${entry.state_abbr || '??'} convergence scored — ${entry.title}`;
      severity = 'low';
      break;
    case 'arc-fingerprint':
      title = `Arc fingerprint recorded: ${entry.title}`;
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
  all: ['compound-risk', 'correlation', 'anomaly', 'score-spike', 'grade-reasoning', 'convergence', 'arc-fingerprint'],
  connections: ['compound-risk', 'correlation', 'convergence'],
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

    let sorted = collisions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (stateFilter) {
      sorted = sorted.filter(e => e.stateAbbr === stateFilter);
    }

    return sorted;
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

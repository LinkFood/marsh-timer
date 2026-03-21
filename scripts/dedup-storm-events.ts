/**
 * Deduplicate storm-event entries in hunt_knowledge.
 *
 * NOAA bulk data creates one row per county affected — a single tornado may
 * have 5 entries. This script groups by effective_date + state_abbr + normalised
 * title, keeps the entry with the longest content, and deletes the rest.
 *
 * Usage:
 *   DRY_RUN=true  SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/dedup-storm-events.ts
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/dedup-storm-events.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rvhyotvklfowklzjahdd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log(`[dedup] Storm event deduplication (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`);

  let offset = 0;
  const BATCH = 1000;
  let totalDups = 0;
  let totalDeleted = 0;
  let totalChecked = 0;

  while (true) {
    const { data, error } = await supabase
      .from('hunt_knowledge')
      .select('id, title, content, state_abbr, effective_date')
      .eq('content_type', 'storm-event')
      .order('effective_date', { ascending: true })
      .order('state_abbr', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) { console.error('[dedup] Query error:', error); break; }
    if (!data || data.length === 0) break;

    totalChecked += data.length;

    // Group by effective_date + state_abbr + normalized title
    const groups = new Map<string, typeof data>();
    for (const row of data) {
      // Normalize title: lowercase, strip county/zone specifics
      const normTitle = (row.title || '')
        .toLowerCase()
        .replace(/\s+(county|zone|parish|borough)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      const key = `${row.effective_date}|${row.state_abbr}|${normTitle}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // Find duplicates
    const toDelete: string[] = [];
    for (const [_key, entries] of groups) {
      if (entries.length <= 1) continue;

      // Keep the entry with the longest content (most detail)
      entries.sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0));
      const dups = entries.slice(1);

      toDelete.push(...dups.map(d => d.id));
      totalDups += dups.length;
    }

    // Delete duplicates
    if (toDelete.length > 0) {
      if (DRY_RUN) {
        console.log(`[dedup] Would delete ${toDelete.length} duplicates from batch (offset ${offset})`);
      } else {
        // Delete in batches of 100
        for (let i = 0; i < toDelete.length; i += 100) {
          const batch = toDelete.slice(i, i + 100);
          const { error: delErr } = await supabase
            .from('hunt_knowledge')
            .delete()
            .in('id', batch);
          if (delErr) {
            console.error('[dedup] Delete error:', delErr.message);
          } else {
            totalDeleted += batch.length;
          }
        }
      }
    }

    if (totalChecked % 5000 === 0) {
      console.log(`[checkpoint] Checked: ${totalChecked}, Dups found: ${totalDups}, Deleted: ${totalDeleted}, Offset: ${offset}`);
    }

    offset += BATCH;
    await new Promise(r => setTimeout(r, 200)); // Rate limit
  }

  console.log(`\n[dedup] DONE. Checked: ${totalChecked}, Dups found: ${totalDups}, Deleted: ${totalDeleted}`);
}

main().catch(err => { console.error('[dedup] Fatal:', err); process.exit(1); });

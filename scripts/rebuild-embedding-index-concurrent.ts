/**
 * IVFFlat rebuild via CREATE INDEX CONCURRENTLY — Option A from
 * docs/REACTIVATION-RUNBOOK.md ("IVFFlat rebuild — options").
 *
 * No write lock: ingestion crons keep running while the index builds.
 * CONCURRENTLY cannot run inside a transaction, hence a direct Postgres
 * connection instead of a migration.
 *
 * Usage:
 *   set -a; source .env.local; set +a   # needs SUPABASE_DB_PASSWORD
 *   npx tsx scripts/rebuild-embedding-index-concurrent.ts
 *
 * Override connection entirely with SUPABASE_DB_URL if needed.
 *
 * Phases:
 *   0. Connect (direct db host, session-pooler fallback), print index state
 *   1. Drop any INVALID leftover from a previously killed CONCURRENTLY build
 *   2. CREATE INDEX CONCURRENTLY hunt_knowledge_embedding_idx_v2 (lists=2645)
 *      — progress polled from a second connection every 60s
 *   3. Verify indisvalid, then swap: drop both historical names, rename v2
 *   4. Update search_hunt_knowledge_v3 probes to 51, reschedule
 *      hunt-pattern-link-worker (the parked migration's follow-up parts)
 *   5. Timed sanity search through the new index
 *
 * If a run is killed mid-build, the leftover INVALID index is cleaned up
 * automatically on the next run (phase 1). Manual cleanup, if ever needed:
 *   DROP INDEX CONCURRENTLY IF EXISTS hunt_knowledge_embedding_idx_v2;
 */

import postgres from "postgres";

const PROJECT_REF = "rvhyotvklfowklzjahdd";
const NEW_INDEX = "hunt_knowledge_embedding_idx_v2";
const FINAL_INDEX = "hunt_knowledge_embedding_idx";
const OLD_INDEXES = ["idx_hunt_knowledge_embedding", "hunt_knowledge_embedding_idx"];
const LISTS = 2645; // sqrt(7M)
const PROBES = 51; // sqrt(2645)

const ts = () => new Date().toISOString().slice(11, 19);
const log = (msg: string) => console.log(`[${ts()}] ${msg}`);

function connectionCandidates(): string[] {
  if (process.env.SUPABASE_DB_URL) return [process.env.SUPABASE_DB_URL];
  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (!pw) {
    console.error("SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL) is required. Add it to .env.local.");
    process.exit(1);
  }
  const enc = encodeURIComponent(pw);
  return [
    // Direct connection (IPv6 on newer projects — may be unreachable)
    `postgresql://postgres:${enc}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
    // Session pooler (IPv4) — session mode, holds a dedicated backend
    `postgresql://postgres.${PROJECT_REF}:${enc}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  ];
}

async function connect(): Promise<{ sql: postgres.Sql; url: string }> {
  let lastErr: unknown;
  for (const url of connectionCandidates()) {
    const redacted = url.replace(/:[^:@/]+@/, ":***@");
    try {
      const sql = postgres(url, {
        max: 1,
        prepare: false,
        idle_timeout: 0,
        connect_timeout: 30,
        ssl: "require",
        onnotice: () => {},
      });
      await sql`SELECT 1`;
      log(`Connected: ${redacted}`);
      return { sql, url };
    } catch (err) {
      log(`Connection failed (${redacted}): ${err instanceof Error ? err.message : err}`);
      lastErr = err;
    }
  }
  throw lastErr;
}

async function indexState(sql: postgres.Sql) {
  return sql`
    SELECT c.relname AS name, i.indisvalid AS valid,
           pg_size_pretty(pg_relation_size(c.oid)) AS size
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relname = 'hunt_knowledge' AND c.relname LIKE '%embedding%'`;
}

async function main() {
  const { sql, url } = await connect();

  // Session config — CONCURRENTLY builds need the same k-means training
  // memory as a blocking build (~1637MB for lists=2645 on 7.6M x 512-dim).
  await sql.unsafe(`SET statement_timeout = 0`);
  await sql.unsafe(`SET lock_timeout = 0`);
  await sql.unsafe(`SET maintenance_work_mem = '2GB'`);
  await sql.unsafe(`SET search_path = public, extensions`);

  const before = await indexState(sql);
  log(`Embedding indexes before: ${JSON.stringify(before)}`);
  const rows = await sql`SELECT reltuples::bigint AS est FROM pg_class WHERE relname = 'hunt_knowledge'`;
  log(`hunt_knowledge estimated rows: ${rows[0].est}`);

  // Phase 1 — clean up an INVALID leftover from a killed prior run
  const leftover = before.find((r) => r.name === NEW_INDEX);
  if (leftover) {
    if (leftover.valid) {
      log(`${NEW_INDEX} already exists and is VALID — skipping build, proceeding to swap.`);
    } else {
      log(`Dropping INVALID leftover ${NEW_INDEX} from a killed prior run...`);
      await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${NEW_INDEX}`);
      log(`Dropped.`);
    }
  }

  // Phase 2 — the build
  const needBuild = !leftover || !leftover.valid;
  if (needBuild) {
    log(`CREATE INDEX CONCURRENTLY ${NEW_INDEX} (lists=${LISTS}) — expect hours. Progress every 60s.`);

    // Second connection for progress polling
    const mon = postgres(url, { max: 1, prepare: false, connect_timeout: 30, ssl: "require", onnotice: () => {} });
    const poll = setInterval(async () => {
      try {
        const p = await mon`
          SELECT phase, blocks_done, blocks_total, tuples_done, tuples_total
          FROM pg_stat_progress_create_index LIMIT 1`;
        if (p.length) {
          const { phase, blocks_done, blocks_total, tuples_done, tuples_total } = p[0];
          const pct = Number(blocks_total) > 0
            ? ((Number(blocks_done) / Number(blocks_total)) * 100).toFixed(1)
            : "?";
          log(`progress: ${phase} — blocks ${blocks_done}/${blocks_total} (${pct}%), tuples ${tuples_done}/${tuples_total}`);
        } else {
          log(`progress: no build row visible (still queued or between phases)`);
        }
      } catch (err) {
        log(`progress poll error: ${err instanceof Error ? err.message : err}`);
      }
    }, 60_000);

    const t0 = Date.now();
    try {
      await sql.unsafe(
        `CREATE INDEX CONCURRENTLY ${NEW_INDEX}
           ON hunt_knowledge USING ivfflat (embedding vector_cosine_ops)
           WITH (lists = ${LISTS})`
      );
    } finally {
      clearInterval(poll);
      await mon.end();
    }
    log(`Build finished in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);

    const check = await sql`
      SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ${NEW_INDEX}`;
    if (!check.length || !check[0].indisvalid) {
      throw new Error(`${NEW_INDEX} is missing or INVALID after build — do not swap. Re-run to clean up and retry.`);
    }
    log(`${NEW_INDEX} is VALID.`);
  }

  // Phase 3 — swap. DROP INDEX takes a brief ACCESS EXCLUSIVE on the old
  // index only; searches retry, ingestion is unaffected.
  log(`Swapping: dropping old index(es), renaming ${NEW_INDEX} -> ${FINAL_INDEX}...`);
  await sql.begin(async (tx) => {
    for (const old of OLD_INDEXES) {
      await tx.unsafe(`DROP INDEX IF EXISTS ${old}`);
    }
    await tx.unsafe(`ALTER INDEX ${NEW_INDEX} RENAME TO ${FINAL_INDEX}`);
  });
  log(`Swap complete.`);

  // Phase 4 — parked migration follow-ups: RPC probes + pattern-link-worker.
  // Function body preserved verbatim from
  // supabase/migrations/20260414100018_rebuild_ivfflat_for_7m.sql.PENDING_CONCURRENT
  // (return columns unchanged — required for PostgREST).
  log(`Updating search_hunt_knowledge_v3 (probes=${PROBES})...`);
  await sql.unsafe(`
CREATE OR REPLACE FUNCTION search_hunt_knowledge_v3(
  query_embedding vector(512),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_content_types text[] DEFAULT NULL,
  filter_state_abbr text DEFAULT NULL,
  filter_species text DEFAULT NULL,
  filter_date_from date DEFAULT NULL,
  filter_date_to date DEFAULT NULL,
  recency_weight float DEFAULT 0.0,
  exclude_du_report boolean DEFAULT false
)
RETURNS TABLE (
  id uuid, title text, content text, content_type text, tags text[],
  state_abbr text, species text, effective_date date, metadata jsonb,
  similarity float, signal_weight float
)
LANGUAGE plpgsql
AS $$
DECLARE
  inner_limit int;
BEGIN
  SET LOCAL statement_timeout = '30s';
  SET LOCAL ivfflat.probes = ${PROBES};

  IF filter_date_from IS NOT NULL OR filter_date_to IS NOT NULL THEN
    inner_limit := match_count * 40;
  ELSE
    inner_limit := match_count * 4;
  END IF;

  RETURN QUERY
  SELECT
    sub.id, sub.title, sub.content, sub.content_type, sub.tags,
    sub.state_abbr, sub.species, sub.effective_date, sub.metadata,
    sub.similarity, sub.signal_weight
  FROM (
    SELECT
      hk.id, hk.title, hk.content, hk.content_type, hk.tags,
      hk.state_abbr, hk.species, hk.effective_date, hk.metadata,
      (1 - (hk.embedding <=> query_embedding)) * COALESCE(hk.signal_weight, 1.0) AS similarity,
      COALESCE(hk.signal_weight, 1.0) AS signal_weight,
      (1 - (hk.embedding <=> query_embedding)) AS raw_similarity,
      CASE WHEN recency_weight > 0 AND hk.effective_date IS NOT NULL
        THEN (1.0 + recency_weight * exp(-1.0 * LEAST((CURRENT_DATE - hk.effective_date)::float, 365.0) / 30.0))
        ELSE 1.0
      END AS recency_boost
    FROM hunt_knowledge hk
    WHERE hk.embedding IS NOT NULL
      AND (filter_content_types IS NULL OR hk.content_type = ANY(filter_content_types))
      AND (filter_state_abbr IS NULL OR hk.state_abbr = filter_state_abbr)
      AND (filter_species IS NULL OR hk.species = filter_species)
      AND (NOT exclude_du_report OR hk.content_type NOT IN ('du_report', 'du_alert'))
    ORDER BY hk.embedding <=> query_embedding
    LIMIT inner_limit
  ) sub
  WHERE sub.raw_similarity > match_threshold
    AND (filter_date_from IS NULL OR sub.effective_date >= filter_date_from)
    AND (filter_date_to IS NULL OR sub.effective_date <= filter_date_to)
  ORDER BY sub.similarity * sub.recency_boost DESC
  LIMIT match_count;
END;
$$`);

  log(`Rescheduling hunt-pattern-link-worker...`);
  await sql.unsafe(`
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-pattern-link-worker') THEN
    PERFORM cron.unschedule('hunt-pattern-link-worker');
  END IF;
  PERFORM cron.schedule(
    'hunt-pattern-link-worker',
    '*/15 * * * *',
    $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-pattern-link-worker',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
END;
$do$`);

  // Phase 5 — timed sanity search through the new index
  log(`Sanity: nearest-neighbor search through the new index...`);
  await sql.unsafe(`SET statement_timeout = '60s'`);
  await sql.unsafe(`SET ivfflat.probes = ${PROBES}`);
  const t1 = Date.now();
  const sanity = await sql.unsafe(`
    SELECT id FROM hunt_knowledge
    ORDER BY embedding <=> (
      SELECT embedding FROM hunt_knowledge
      WHERE embedding IS NOT NULL AND content_type = 'ghcn-daily' LIMIT 1
    )
    LIMIT 5`);
  log(`Sanity search: ${sanity.length} rows in ${Date.now() - t1}ms.`);

  const after = await indexState(sql);
  log(`Embedding indexes after: ${JSON.stringify(after)}`);

  await sql.end();
  log(`DONE. lists=${LISTS}, probes=${PROBES}. Delete the .PENDING_CONCURRENT migration file and update the runbook.`);
}

main().catch((err) => {
  console.error(`[${ts()}] FATAL:`, err);
  process.exit(1);
});

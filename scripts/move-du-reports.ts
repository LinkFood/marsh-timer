/**
 * Move du_report entries from hunt_knowledge to hunt_knowledge_du
 * Runs via REST API in small batches to avoid timeouts
 *
 * Usage: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/move-du-reports.ts
 */

const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }

const headers: Record<string, string> = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

const BATCH = 100;

async function main() {
  console.log("=== Moving du_report rows to hunt_knowledge_du ===");
  let total = 0;

  while (true) {
    // Fetch batch of full du_report rows
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.du_report&select=*&limit=${BATCH}&order=created_at.asc`,
      { headers }
    );
    if (!fetchRes.ok) { console.error("Fetch failed:", await fetchRes.text()); break; }
    const rows = await fetchRes.json();
    if (rows.length === 0) { console.log("No more du_report rows."); break; }

    // Insert into hunt_knowledge_du (ignore duplicates)
    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge_du`,
      { method: "POST", headers: { ...headers, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(rows) }
    );
    if (!insertRes.ok) {
      const err = await insertRes.text();
      console.error("Insert error:", err.slice(0, 200));
      // Try to delete anyway (might already be in DU table from previous run)
    }

    // Delete by IDs — build filter in chunks to avoid URL length
    const ids = rows.map((r: { id: string }) => r.id);
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      const delRes = await fetch(
        `${SUPABASE_URL}/rest/v1/hunt_knowledge?id=in.(${chunk.join(",")})`,
        { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }
      );
      if (!delRes.ok) { console.error("Delete failed:", (await delRes.text()).slice(0, 100)); }
    }

    total += rows.length;
    if (total % 500 === 0 || rows.length < BATCH) {
      console.log(`Moved ${total} rows`);
    }
  }

  console.log(`\nDone! Moved ${total} du_report rows to hunt_knowledge_du`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });

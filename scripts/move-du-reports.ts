/**
 * Move du_report entries from hunt_knowledge to hunt_knowledge_du
 * Runs via REST API in small batches to avoid statement timeout
 * 
 * Usage: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/move-du-reports.ts
 */

const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

const BATCH = 50;

async function main() {
  console.log("=== Moving du_report rows to hunt_knowledge_du ===");
  let total = 0;

  while (true) {
    // Fetch a batch of du_report IDs
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.du_report&select=id&limit=${BATCH}`,
      { headers }
    );
    if (!fetchRes.ok) { console.error("Fetch failed:", await fetchRes.text()); break; }
    const rows = await fetchRes.json();
    if (rows.length === 0) { console.log("No more du_report rows."); break; }

    const ids = rows.map((r: { id: string }) => r.id);

    // Fetch full rows
    const fullRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?id=in.(${ids.join(",")})&select=*`,
      { headers }
    );
    if (!fullRes.ok) { console.error("Full fetch failed:", await fullRes.text()); break; }
    const fullRows = await fullRes.json();

    // Insert into hunt_knowledge_du
    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge_du`,
      { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(fullRows) }
    );
    if (!insertRes.ok) {
      const err = await insertRes.text();
      if (err.includes("duplicate")) {
        console.log(`  Batch had duplicates (already moved), deleting from main...`);
      } else {
        console.error("Insert failed:", err);
        break;
      }
    }

    // Delete from main table
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?id=in.(${ids.join(",")})`,
      { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }
    );
    if (!delRes.ok) { console.error("Delete failed:", await delRes.text()); break; }

    total += ids.length;
    console.log(`Moved ${ids.length} rows (${total} total)`);
  }

  console.log(`\nDone! Moved ${total} du_report rows to hunt_knowledge_du`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });

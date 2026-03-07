# Task 7: Seed the Knowledge Base (Optional)

This embeds all state facts and regulation links into the vector search database, making the AI chat much smarter at answering hunting questions.

## Prerequisites
- Deno must be installed: https://deno.land/#installation
  ```bash
  curl -fsSL https://deno.land/install.sh | sh
  ```
- You need the Supabase service role key and Voyage API key

## Steps

1. Open Terminal
2. Get your service role key:
   ```bash
   cd ~/marsh-timer
   npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | grep service_role
   ```
   Copy the key value (the long JWT string)

3. Get your Voyage API key from Supabase Secrets:
   - Go to: https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/settings/vault
   - Find `VOYAGE_API_KEY` and copy the value

4. Run the seed script:
   ```bash
   cd ~/marsh-timer
   SUPABASE_URL=https://rvhyotvklfowklzjahdd.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<paste-service-role-key-here> \
   VOYAGE_API_KEY=<paste-voyage-api-key-here> \
   deno run --allow-net --allow-env scripts/seed-knowledge.ts
   ```

5. You should see output like:
   ```
   === Seeding hunt_knowledge ===
   Fetching state facts...
   Found 250 fact entries
   Progress: 10/250
   ...
   Seeded 245 knowledge entries from facts
   Fetching regulation links...
   ...
   === Done ===
   ```

## Verification
Go to the Supabase Table Editor: https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/editor
Open the `hunt_knowledge` table — it should have rows with embeddings (the `embedding` column will show array data).

## If It Fails
- `VOYAGE_API_KEY not found` — double-check you copied it correctly from Supabase Secrets
- Timeout errors — the script batches requests with delays, but if Voyage is slow, try running again (it uses upsert so duplicates are safe)
- `relation "hunt_knowledge" does not exist` — the migration from the deploy didn't include this table. Check that the `hunt_knowledge` table exists (it was created in the bootstrap migration, not this one)

// Run with: deno run --allow-net --allow-env scripts/seed-knowledge.ts
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY env vars

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VOYAGE_KEY = Deno.env.get('VOYAGE_API_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function embed(text: string): Promise<number[] | null> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VOYAGE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-3-lite',
      input: [text],
      input_type: 'document',
    }),
  });

  if (!res.ok) {
    console.error('Embed error:', res.status, await res.text());
    return null;
  }

  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

async function seedFacts() {
  console.log('Fetching state facts...');
  const { data: facts } = await supabase.from('hunt_state_facts').select('*');
  if (!facts) { console.log('No facts found'); return; }

  console.log(`Found ${facts.length} fact entries`);
  let inserted = 0;

  // Batch in groups of 20 (Voyage timeout limit)
  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i];
    const factsText = (fact.facts as string[]).join('. ');
    const richText = `${fact.species_id} hunting in ${fact.state_name} | facts | ${factsText}`;

    const embedding = await embed(richText);
    if (!embedding) {
      console.warn(`Skipping ${fact.species_id} ${fact.state_name} — embed failed`);
      continue;
    }

    const { error } = await supabase.from('hunt_knowledge').upsert({
      title: `${fact.species_id} hunting facts: ${fact.state_name}`,
      content: factsText,
      content_type: 'fact',
      tags: [fact.species_id, fact.state_name.toLowerCase()],
      embedding,
    }, { onConflict: 'title' });

    if (error) console.warn(`Insert error for ${fact.state_name}:`, error.message);
    else inserted++;

    // Rate limit: small delay between embeds
    if (i % 10 === 9) {
      console.log(`Progress: ${i + 1}/${facts.length}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`Seeded ${inserted} knowledge entries from facts`);
}

async function seedRegulationSummaries() {
  console.log('Fetching regulation links...');
  const { data: regs } = await supabase.from('hunt_regulation_links').select('*');
  if (!regs) { console.log('No regulation links found'); return; }

  console.log(`Found ${regs.length} regulation entries`);
  let inserted = 0;

  for (let i = 0; i < regs.length; i++) {
    const reg = regs[i];
    const richText = `${reg.species_id} hunting regulations ${reg.state_abbr} | regulation | Official state regulation link: ${reg.url}`;

    const embedding = await embed(richText);
    if (!embedding) continue;

    const { error } = await supabase.from('hunt_knowledge').upsert({
      title: `${reg.species_id} regulations: ${reg.state_abbr}`,
      content: `Official ${reg.species_id} hunting regulations for ${reg.state_abbr}: ${reg.url}`,
      content_type: 'regulation',
      tags: [reg.species_id, reg.state_abbr.toLowerCase(), 'regulation'],
      embedding,
    }, { onConflict: 'title' });

    if (error) console.warn(`Insert error for ${reg.state_abbr}:`, error.message);
    else inserted++;

    if (i % 10 === 9) {
      console.log(`Progress: ${i + 1}/${regs.length}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`Seeded ${inserted} regulation knowledge entries`);
}

console.log('=== Seeding hunt_knowledge ===');
await seedFacts();
await seedRegulationSummaries();
console.log('=== Done ===');

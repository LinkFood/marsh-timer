// Shared Voyage AI embedding module.
// Calls Voyage API directly (no HTTP hop to hunt-generate-embedding).
// Model: voyage-3-lite (512-dim)

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3-lite';
const MAX_BATCH_SIZE = 20; // Voyage AI times out above 20

/**
 * Generate a single embedding vector via Voyage AI.
 * @param text - The text to embed
 * @param inputType - 'document' for storage, 'query' for search (default: 'document')
 * @returns 512-dimensional embedding vector
 */
export async function generateEmbedding(
  text: string,
  inputType: 'document' | 'query' = 'document'
): Promise<number[]> {
  const apiKey = Deno.env.get('VOYAGE_API_KEY');
  if (!apiKey) throw new Error('VOYAGE_API_KEY not set');

  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Batch embed multiple texts via Voyage AI.
 * Automatically splits into chunks of 20 (Voyage AI limit).
 * @param texts - Array of texts to embed
 * @param inputType - 'document' for storage, 'query' for search (default: 'document')
 * @returns Array of 512-dimensional embedding vectors (same order as input)
 */
export async function batchEmbed(
  texts: string[],
  inputType: 'document' | 'query' = 'document'
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = Deno.env.get('VOYAGE_API_KEY');
  if (!apiKey) throw new Error('VOYAGE_API_KEY not set');

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const chunk = texts.slice(i, i + MAX_BATCH_SIZE);

    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: chunk,
        input_type: inputType,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    for (const item of data.data) {
      results.push(item.embedding);
    }
  }

  return results;
}

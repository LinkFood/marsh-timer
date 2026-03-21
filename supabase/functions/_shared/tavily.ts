const TAVILY_API_URL = 'https://api.tavily.com/search';

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export async function searchWeb(query: string, options?: {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeDomains?: string[];
}): Promise<TavilyResult[]> {
  const apiKey = Deno.env.get('TAVILY_API_KEY');
  if (!apiKey) {
    console.warn('[Tavily] TAVILY_API_KEY not set, skipping web search');
    return [];
  }

  try {
    const res = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: options?.maxResults || 5,
        search_depth: options?.searchDepth || 'advanced',
        include_domains: options?.includeDomains || [],
      }),
    });

    if (!res.ok) {
      console.error('[Tavily] API error:', res.status);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch (err) {
    console.error('[Tavily] Search failed:', err);
    return [];
  }
}

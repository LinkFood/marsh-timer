export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

export const CLAUDE_MODELS = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

export const CLAUDE_RATES = {
  [CLAUDE_MODELS.opus]: { input: 15.0, output: 75.0 },
  [CLAUDE_MODELS.sonnet]: { input: 3.0, output: 15.0 },
  [CLAUDE_MODELS.haiku]: { input: 0.80, output: 4.0 },
} as const;

export interface ClaudeOptions {
  model?: string;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  tools?: unknown[];
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  model: string;
  stop_reason: string;
  usage: ClaudeUsage;
}

function getAnthropicHeaders(): Record<string, string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'Content-Type': 'application/json',
  };
}

export async function callClaude(options: ClaudeOptions): Promise<ClaudeResponse> {
  const {
    model = CLAUDE_MODELS.haiku,
    system,
    messages,
    tools,
    tool_choice,
    max_tokens = 4096,
    temperature = 0.3,
  } = options;

  const body: Record<string, unknown> = { model, messages, max_tokens, temperature };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: getAnthropicHeaders(),
      body: JSON.stringify(body),
    });

    if (response.ok) return await response.json();

    const errorText = await response.text();
    console.error(`Claude API error (attempt ${attempt + 1}):`, response.status, errorText);

    // 4xx = permanent, don't retry
    if (response.status < 500) {
      throw new Error(`Claude API ${response.status}: ${errorText}`);
    }

    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }

    throw new Error(`Claude API failed after ${MAX_RETRIES + 1} attempts`);
  }

  throw new Error('Claude API unknown error');
}

export function parseToolUse(response: ClaudeResponse): { name: string; input: Record<string, unknown> } | null {
  const block = response.content.find(c => c.type === 'tool_use');
  if (!block?.name || !block?.input) return null;
  return { name: block.name, input: block.input as Record<string, unknown> };
}

export function parseTextContent(response: ClaudeResponse): string {
  return response.content.find(c => c.type === 'text')?.text || '';
}

export function calculateCost(model: string, usage: ClaudeUsage): number {
  const rates = CLAUDE_RATES[model as keyof typeof CLAUDE_RATES];
  if (!rates) return 0;
  return (usage.input_tokens / 1_000_000) * rates.input + (usage.output_tokens / 1_000_000) * rates.output;
}

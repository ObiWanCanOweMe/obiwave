type LiteLlmEnv = Partial<Record<'LITELLM_API_BASE' | 'OPENAI_API_BASE' | 'LITELLM_API_KEY' | 'OPENAI_API_KEY', string>>;

export function effectiveLiteLlmBaseUrl(cfg: any, env: LiteLlmEnv = process.env): string {
  return String(cfg?.baseUrl || env.LITELLM_API_BASE || env.OPENAI_API_BASE || '')
    .trim()
    .replace(/\/+$/, '');
}

export function effectiveLiteLlmApiKey(cfg: any, env: LiteLlmEnv = process.env): string {
  return String(cfg?.apiKey || env.LITELLM_API_KEY || env.OPENAI_API_KEY || '').trim();
}

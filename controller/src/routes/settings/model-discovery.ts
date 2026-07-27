import { config } from '../../config.js';
import * as settings from '../../settings.js';
import * as llmProvider from '../../llm/provider.js';
import * as speech from '../../llm/speech.js';
import { fetchWithTimeout } from '../../util/fetch-timeout.js';
import {
  effectiveLiteLlmApiKey,
  effectiveLiteLlmBaseUrl,
} from '../../litellm-config.js';
import { createGateway } from 'ai';

export type ModelOwner = 'chat' | 'embedding' | 'tts';
export type ChatLeg = 'primary' | 'fallback' | 'onboarding';

export interface ModelDiscoveryInput {
  owner: ModelOwner;
  provider: string;
  leg?: ChatLeg;
  baseUrl?: string;
  ollamaUrl?: string;
  apiKey?: string;
}

export interface ModelDiscoveryResult {
  models: string[];
  provider: string;
}

const EMBEDDING_PROVIDERS = new Set([
  'ollama',
  'openai-compatible',
  'locca',
  'openrouter',
  'openai',
  'google',
  'requesty',
]);
const TTS_PROVIDERS = new Set(['openai', 'elevenlabs', 'openai-compatible']);

function endpoint(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function sameEndpoint(a: string, b: string): boolean {
  return !!a && !!b && endpoint(a) === endpoint(b);
}

function envKey(name: string): string {
  return String(process.env[name] || '').trim();
}

function looksLikeEmbeddingModel(id: string): boolean {
  const value = id.toLowerCase();
  if (value.includes('embed')) return true;
  return /(^|[/:_-])(bge|gte|e5|all-minilm|minilm|instructor)([/:_-]|$)/.test(value);
}

function looksLikeSpeechModel(id: string): boolean {
  const value = id.toLowerCase();
  return /(^|[/:_.-])(tts|speech|voice|vibevoice|chatterbox|kokoro|fish-speech|qwen[^/]*tts)([/:_.-]|$)/.test(value);
}

function modelsFromOpenAiPayload(payload: unknown): string[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (item as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === 'string' && !!id.trim());
}

function filterForOwner(models: string[], owner: ModelOwner, provider: string): string[] {
  const filtered = owner === 'tts' && provider === 'elevenlabs'
    // ElevenLabs already marks each returned entry with
    // can_do_text_to_speech. Its valid ids do not contain "tts" or "speech".
    ? models
    : owner === 'embedding'
    ? models.filter(looksLikeEmbeddingModel)
    : owner === 'tts'
      ? models.filter(looksLikeSpeechModel)
      : models.filter((id) => !looksLikeEmbeddingModel(id) && !looksLikeSpeechModel(id));
  return [...new Set(filtered)].sort();
}

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetchWithTimeout(url, {
    ...init,
    timeoutMs: 10_000,
    bodyDeadline: true,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function savedChatLeg(leg: ChatLeg) {
  const state = settings.get();
  if (leg === 'primary') return state.llm || {};
  if (leg === 'fallback') return state.llm?.fallback || {};
  return {};
}

function savedChatBase(leg: ChatLeg, provider: string): string {
  const saved = savedChatLeg(leg);
  if (provider === 'ollama') return endpoint(saved.ollamaUrl);
  const mapped = endpoint(saved.providerBaseUrls?.[provider]);
  if (mapped) return mapped;
  if (provider === 'locca') return llmProvider.DEFAULT_LOCCA_BASE_URL;
  return saved.provider === provider ? endpoint(saved.baseUrl) : '';
}

function resolveCustomConnection(input: ModelDiscoveryInput): {
  baseUrl: string;
  apiKey: string;
  ollamaUrl: string;
} {
  const suppliedBase = endpoint(input.baseUrl);
  const suppliedOllama = endpoint(input.ollamaUrl);
  const explicitKey = String(input.apiKey || '').trim();
  let savedProvider = '';
  let savedBase = '';
  let savedOllama = '';
  let savedKey = '';

  if (input.owner === 'chat') {
    const leg = input.leg!;
    const saved = savedChatLeg(leg);
    savedBase = savedChatBase(leg, input.provider);
    savedOllama = input.provider === 'ollama' ? endpoint(saved.ollamaUrl) : '';
    savedProvider = savedBase || savedOllama ? input.provider : '';
    savedKey = savedBase ? settings.llmKeyFor(input.provider) : '';
  } else if (input.owner === 'embedding') {
    // Resolve the submitted provider, not only the currently selected one, so
    // unsaved switch-back discovery mirrors runtime provider precedence.
    const cfg = llmProvider.resolveEmbeddingCfg({ provider: input.provider });
    savedProvider = cfg.provider;
    savedBase = endpoint(llmProvider.embeddingBaseUrl(cfg));
    savedOllama = endpoint(cfg.ollamaUrl);
    savedKey = cfg.apiKey;
  } else {
    const cloud = settings.get().tts?.cloud || {};
    savedProvider = String(cloud.provider || '');
    savedBase = savedProvider === input.provider ? endpoint(cloud.baseUrl) : '';
    savedKey = savedProvider === input.provider
      ? speech.resolveCloudApiKey({ provider: input.provider, apiKey: cloud.apiKey })
      : '';
  }

  const selectedBase = suppliedBase || savedBase;
  const selectedOllama = suppliedOllama || savedOllama;
  const storedCredentialIsBound =
    savedProvider === input.provider
    && (!suppliedBase || sameEndpoint(suppliedBase, savedBase));

  return {
    baseUrl: selectedBase,
    ollamaUrl: selectedOllama,
    apiKey: explicitKey || (storedCredentialIsBound ? savedKey : ''),
  };
}

function managedApiKey(input: ModelDiscoveryInput): string {
  const explicit = String(input.apiKey || '').trim();
  if (explicit) return explicit;
  if (input.owner === 'tts') {
    return speech.resolveCloudApiKey({ provider: input.provider });
  }
  if (input.owner === 'embedding') {
    const cfg = llmProvider.resolveEmbeddingCfg({ provider: input.provider });
    if (cfg.apiKey) return cfg.apiKey;
  } else if (input.owner === 'chat') {
    const saved = savedChatLeg(input.leg!);
    if (saved.provider === input.provider) {
      const inline = settings.llmKeyFor(input.provider);
      if (inline) return inline;
    }
  }
  const envByProvider: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    requesty: 'REQUESTY_API_KEY',
    gateway: 'AI_GATEWAY_API_KEY',
  };
  return envByProvider[input.provider] ? envKey(envByProvider[input.provider]) : '';
}

async function discoverLiteLlm(input: ModelDiscoveryInput): Promise<string[]> {
  const connection = resolveCustomConnection(input);
  const environmentBase = effectiveLiteLlmBaseUrl({});
  const baseUrl = connection.baseUrl || environmentBase;
  if (!baseUrl) throw new Error('LiteLLM base URL is required');
  const environmentKeyIsBound = !connection.baseUrl || sameEndpoint(baseUrl, environmentBase);
  const apiKey = connection.apiKey
    || (environmentKeyIsBound ? effectiveLiteLlmApiKey({}) : '');
  const payload = await getJson(`${baseUrl}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  return modelsFromOpenAiPayload(payload);
}

function assertOwnerProvider(input: ModelDiscoveryInput): void {
  if (input.owner === 'embedding' && !EMBEDDING_PROVIDERS.has(input.provider)) {
    throw new Error(`${input.provider} does not support embedding discovery`);
  }
  if (input.owner === 'tts' && !TTS_PROVIDERS.has(input.provider)) {
    throw new Error(`${input.provider} does not support TTS discovery`);
  }
  if (input.owner === 'chat' && input.provider === 'elevenlabs') {
    throw new Error('elevenlabs does not support chat discovery');
  }
}

export async function discoverModels(input: ModelDiscoveryInput): Promise<ModelDiscoveryResult> {
  await settings.load();
  assertOwnerProvider(input);
  const { owner, provider } = input;
  let models: string[] = [];

  if (provider === 'litellm') {
    if (owner !== 'chat') throw new Error('LiteLLM model discovery is chat-only');
    models = await discoverLiteLlm(input);
    return { models: filterForOwner(models, owner, provider), provider };
  }

  if (provider === 'ollama') {
    const connection = resolveCustomConnection(input);
    const url = connection.ollamaUrl || config.ollama.url || 'http://localhost:11434';
    const payload = await getJson(`${url}/api/tags`);
    const list = (payload as { models?: unknown })?.models;
    models = Array.isArray(list)
      ? list
          .map((item) => (item as { name?: unknown })?.name)
          .filter((name): name is string => typeof name === 'string')
      : [];
    return { models: filterForOwner(models, owner, provider), provider };
  }

  if (provider === 'openai-compatible' || provider === 'locca') {
    const connection = resolveCustomConnection(input);
    const baseUrl = connection.baseUrl
      || (provider === 'locca'
        ? owner === 'embedding'
          ? llmProvider.embeddingBaseUrl({ provider: 'locca', baseUrl: '' })
          : llmProvider.DEFAULT_LOCCA_BASE_URL
        : '');
    if (!baseUrl) throw new Error('baseUrl is required for openai-compatible');
    const payload = await getJson(`${baseUrl}/models`, {
      headers: connection.apiKey
        ? { Authorization: `Bearer ${connection.apiKey}` }
        : {},
    });
    models = modelsFromOpenAiPayload(payload);
    return { models: filterForOwner(models, owner, provider), provider };
  }

  const apiKey = managedApiKey(input);
  switch (provider) {
    case 'openai': {
      if (!apiKey) throw new Error('OpenAI API key not set');
      models = modelsFromOpenAiPayload(await getJson('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }));
      break;
    }
    case 'elevenlabs': {
      if (!apiKey) throw new Error('ElevenLabs API key not set');
      const payload = await getJson('https://api.elevenlabs.io/v1/models', {
        headers: { 'xi-api-key': apiKey },
      });
      const list = Array.isArray(payload) ? payload : [];
      models = list
        .filter((item) => (item as { can_do_text_to_speech?: unknown }).can_do_text_to_speech !== false)
        .map((item) => (item as { model_id?: unknown }).model_id)
        .filter((id): id is string => typeof id === 'string');
      break;
    }
    case 'anthropic': {
      if (!apiKey) throw new Error('Anthropic API key not set');
      const payload = await getJson('https://api.anthropic.com/v1/models?limit=100', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      models = modelsFromOpenAiPayload(payload);
      break;
    }
    case 'google': {
      if (!apiKey) throw new Error('Google API key not set');
      const payload = await getJson(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      );
      const list = (payload as { models?: unknown })?.models;
      models = Array.isArray(list)
        ? list
            .filter((item) => {
              const methods = (item as { supportedGenerationMethods?: unknown }).supportedGenerationMethods;
              return Array.isArray(methods)
                && methods.includes(owner === 'embedding' ? 'embedContent' : 'generateContent');
            })
            .map((item) => String((item as { name?: unknown }).name || '').replace(/^models\//, ''))
            .filter(Boolean)
        : [];
      break;
    }
    case 'deepseek': {
      if (!apiKey) throw new Error('DeepSeek API key not set');
      models = modelsFromOpenAiPayload(await getJson('https://api.deepseek.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }));
      break;
    }
    case 'openrouter': {
      const url = owner === 'embedding'
        ? 'https://openrouter.ai/api/v1/models?output_modalities=embeddings'
        : 'https://openrouter.ai/api/v1/models';
      models = modelsFromOpenAiPayload(await getJson(url));
      break;
    }
    case 'requesty': {
      if (!apiKey) throw new Error('Requesty API key not set');
      models = modelsFromOpenAiPayload(await getJson(
        `${llmProvider.DEFAULT_REQUESTY_BASE_URL}/models`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ));
      break;
    }
    case 'gateway': {
      const gateway = createGateway({
        ...(apiKey ? { apiKey } : {}),
      });
      const result = await gateway.getAvailableModels();
      models = (Array.isArray(result.models) ? result.models : [])
        .filter((item: { modelType?: unknown }) =>
          owner === 'embedding' ? item.modelType === 'embedding' : item.modelType !== 'embedding')
        .map((item: { id?: unknown }) => item.id)
        .filter((id): id is string => typeof id === 'string');
      break;
    }
    default:
      throw new Error(`unknown provider: ${provider}`);
  }

  return { models: filterForOwner(models, owner, provider), provider };
}

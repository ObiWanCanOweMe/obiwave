'use client';

import { useCallback, useRef, useState } from 'react';
import { useAdminAuth } from '@/lib/adminAuth';
import { AsyncResultGeneration } from '@/lib/asyncResultGeneration';
import {
  llmDraftForProviderChange,
  llmForSubmission,
  type LlmProvider,
  type ProviderDrafts,
} from './providerState';
import { fishAudioIssue } from '@/lib/schemas.generated';

// Every step reads and writes through the `set` updater rather than its own
// state, so the Review step can show the whole picture without prop-drilling.
export interface WizardData {
  navidrome: { url: string; user: string; pass: string };
  navidromeTest: { ok: boolean | null; msg?: string };

  llm: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl: string;
    ollamaUrl: string;
  };
  llmTest: { ok: boolean | null; msg?: string };

  tts: {
    defaultEngine: 'piper' | 'kokoro' | 'cloud' | 'chatterbox' | 'pocket-tts' | 'remote';
    // Advisory only: the web wizard can't start the tts-heavy sidecar, so this
    // captures intent (persisted to settings.tts.heavyEnabled) and shows the
    // copy-paste docker commands. The CLI setup writes COMPOSE_PROFILES to .env.
    heavyEnabled: boolean;
    cloud: { enabled: boolean; provider: string; apiKey: string; model: string; voice: string };
  };

  dj: {
    stationName: string;
    locationName: string;
    // Strings because they back text inputs; parsed and range-checked by the
    // controller's settings.update() on save.
    lat: string;
    lng: string;
    // IANA zone. '' = Auto (server zone), matching the admin sentinel.
    timezone: string;
    frequency: 'silent' | 'quiet' | 'moderate' | 'chatty' | 'aggressive';
  };

  // Destined for state/secrets.env, keyed by env-var name to match the
  // controller's allow list.
  apiKeys: Record<string, string>;
}

export const DEFAULT_DATA: WizardData = {
  navidrome: { url: '', user: '', pass: '' },
  navidromeTest: { ok: null },
  llm: {
    provider: 'ollama',
    // Ollama's hosted "cloud" model works with a stock install (no local pull)
    // and matches the terminal wizard's default.
    model: 'glm-5.1:cloud',
    apiKey: '',
    baseUrl: '',
    ollamaUrl: 'http://host.docker.internal:11434',
  },
  llmTest: { ok: null },
  tts: {
    defaultEngine: 'piper',
    heavyEnabled: false,
    cloud: { enabled: false, provider: 'openai', apiKey: '', model: 's2.1-pro', voice: '' },
  },
  dj: {
    stationName: 'SUB/WAVE',
    // Punjab (Chandigarh) — operator's home region; coordinates drive weather.
    locationName: 'Punjab',
    lat: '30.7333',
    lng: '76.7794',
    timezone: '',
    frequency: 'moderate',
  },
  apiKeys: {},
};

export type StepId = 'navidrome' | 'llm' | 'tts' | 'dj' | 'review';

export const STEP_ORDER: StepId[] = ['navidrome', 'llm', 'tts', 'dj', 'review'];

export const STEP_LABELS: Record<StepId, string> = {
  navidrome: 'Navidrome',
  llm: 'LLM',
  tts: 'TTS',
  dj: 'DJ persona',
  review: 'Review',
};

// AbortSignal timeouts reject with a TimeoutError; everything else (connection
// refused, DNS, CORS/TLS) is a bare "Failed to fetch" that means nothing to an
// operator, so point them at the real culprit: reaching the controller.
function fetchErrorMsg(err: unknown): string {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return 'timed out — the controller did not respond';
  }
  const m = err instanceof Error ? err.message : '';
  return `could not reach the controller${m ? ` (${m})` : ''}`;
}

export function useWizard() {
  const auth = useAdminAuth();
  const [data, setData] = useState<WizardData>(DEFAULT_DATA);
  const [stepIdx, setStepIdx] = useState(0);
  const llmTestGeneration = useRef(new AsyncResultGeneration());
  const llmDiscoveryGeneration = useRef(new AsyncResultGeneration());
  const providerDrafts = useRef<ProviderDrafts>({});

  const step = STEP_ORDER[stepIdx];
  const next = useCallback(() => setStepIdx(i => Math.min(i + 1, STEP_ORDER.length - 1)), []);
  const back = useCallback(() => setStepIdx(i => Math.max(i - 1, 0)), []);
  const goto = useCallback((id: StepId) => {
    const i = STEP_ORDER.indexOf(id);
    if (i >= 0) setStepIdx(i);
  }, []);

  // Provider drafts outlive the LLM step's RHF instance, so Back/Next and
  // provider switches never reuse another provider's URL or bearer and never
  // discard the draft the operator typed for a provider they return to.
  const changeLlmProvider = useCallback((
    current: WizardData['llm'],
    nextProvider: LlmProvider,
  ): WizardData['llm'] => {
    const changed = llmDraftForProviderChange(current, nextProvider, providerDrafts.current);
    providerDrafts.current = changed.drafts;
    llmDiscoveryGeneration.current.invalidate();
    llmTestGeneration.current.invalidate();
    return changed.llm;
  }, []);

  const patch = useCallback((p: Partial<WizardData> | ((d: WizardData) => Partial<WizardData>)) => {
    setData(d => {
      const incoming = typeof p === 'function' ? p(d) : p;
      const next = { ...d, ...incoming };
      if (
        next.llm.provider !== d.llm.provider
        || next.llm.apiKey !== d.llm.apiKey
        || next.llm.baseUrl !== d.llm.baseUrl
        || next.llm.ollamaUrl !== d.llm.ollamaUrl
      ) {
        llmDiscoveryGeneration.current.invalidate();
      }
      if (
        next.llm.provider !== d.llm.provider
        || next.llm.model !== d.llm.model
        || next.llm.apiKey !== d.llm.apiKey
        || next.llm.baseUrl !== d.llm.baseUrl
        || next.llm.ollamaUrl !== d.llm.ollamaUrl
      ) {
        llmTestGeneration.current.invalidate();
      }
      return next;
    });
  }, []);

  // Every wizard write goes through adminFetch for the admin shell's
  // 401-handling. Both test helpers catch their own failures into the result
  // pill: a rejected or timed-out fetch must surface as a red pill, never as an
  // unhandled throw that wedges the button on "Testing…" (issue #682).
  //
  // Both now take the credentials/config as an explicit argument rather than
  // reading `data.navidrome` / `data.llm` — each step owns its own
  // react-hook-form instance and only writes back into `data` on Next, so the
  // Test button (which must probe whatever is CURRENTLY typed, not the last
  // committed value) hands over the step form's live values directly.
  const testNavidrome = useCallback(async (creds: WizardData['navidrome']) => {
    // The browser→controller hop has no default timeout, so a request that
    // never answers wedges the button. 15s clears the 5s server-side Subsonic
    // probe with margin.
    try {
      const r = await auth.adminFetch('/onboarding/test-navidrome', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(creds),
        signal: AbortSignal.timeout(15000),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; serverType?: string; serverVersion?: string; error?: string };
      const result = { ok: !!j.ok, msg: j.ok ? `${j.serverType || 'Subsonic'} v${j.serverVersion || ''}` : (j.error || `controller returned HTTP ${r.status}`) };
      patch({ navidromeTest: result });
      return result;
    } catch (err: unknown) {
      const result = { ok: false, msg: fetchErrorMsg(err) };
      patch({ navidromeTest: result });
      return result;
    }
  }, [auth, patch]);

  const testLlm = useCallback(async (values: WizardData['llm']) => {
    // 60s client cap sits just above the controller's 45s generateText abort,
    // so a slow/unreachable model surfaces the server's error rather than a
    // bare client timeout — and the button can never hang forever.
    const generation = llmTestGeneration.current.begin();
    try {
      const r = await auth.adminFetch('/onboarding/test-llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(60000),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; sample?: string; error?: string };
      const result = { ok: !!j.ok, msg: j.ok ? `responded: "${j.sample}"` : (j.error || `controller returned HTTP ${r.status}`) };
      if (llmTestGeneration.current.isCurrent(generation)) patch({ llmTest: result });
      return result;
    } catch (err: unknown) {
      const result = { ok: false, msg: fetchErrorMsg(err) };
      if (llmTestGeneration.current.isCurrent(generation)) patch({ llmTest: result });
      return result;
    }
  }, [auth, patch]);

  // Probe a custom endpoint for its loaded model list so the operator can pick
  // the model instead of typing it. LiteLLM resolves a blank URL from the
  // controller environment; openai-compatible still requires an explicit URL.
  const discoverCustomModels = useCallback(async () => {
    const generation = llmDiscoveryGeneration.current.begin();
    const r = await auth.adminFetch('/settings/llm/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: 'chat',
        provider: data.llm.provider,
        leg: 'onboarding',
        baseUrl: data.llm.baseUrl,
        apiKey: data.llm.apiKey,
      }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      models?: string[];
      error?: string;
    };
    if (!llmDiscoveryGeneration.current.isCurrent(generation)) {
      return { reachable: false, models: [], error: undefined };
    }
    return { reachable: !!j.ok, models: j.models || [], error: j.error };
  }, [auth, data.llm.provider, data.llm.baseUrl, data.llm.apiKey]);

  const save = useCallback(async () => {
    const apiKeys: Record<string, string> = { ...data.apiKeys };
    if (data.llm.apiKey) {
      const k =
        data.llm.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' :
        data.llm.provider === 'openai' ? 'OPENAI_API_KEY' :
        data.llm.provider === 'google' ? 'GOOGLE_GENERATIVE_AI_API_KEY' :
        data.llm.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' :
        data.llm.provider === 'openrouter' ? 'OPENROUTER_API_KEY' :
        data.llm.provider === 'requesty' ? 'REQUESTY_API_KEY' :
        data.llm.provider === 'gateway' ? 'AI_GATEWAY_API_KEY' : '';
      if (k) apiKeys[k] = data.llm.apiKey;
    }
    if (data.tts.cloud.enabled && data.tts.cloud.apiKey) {
      const k =
        data.tts.cloud.provider === 'openai' ? 'OPENAI_API_KEY' :
        data.tts.cloud.provider === 'elevenlabs' ? 'ELEVENLABS_API_KEY' :
        data.tts.cloud.provider === 'fish-audio' ? 'FISH_API_KEY' : '';
      if (k) apiKeys[k] = data.tts.cloud.apiKey;
    }
    // The key may already come from the root environment, so fishAudioIssue
    // only judges the fields the wizard itself must persist for a usable Fish
    // request. Same helper the controller's save handler runs — the two
    // hand-rolled copies this replaces had already drifted in the message
    // ('1-100' vs '1–100') before they could in logic.
    const fishIssue = fishAudioIssue(data.tts.cloud);
    if (fishIssue) return { ok: false, error: fishIssue };

    const body = {
      navidrome: data.navidrome,
      llm: llmForSubmission(data.llm),
      tts: {
        defaultEngine: data.tts.defaultEngine,
        heavyEnabled: data.tts.heavyEnabled,
        cloud: data.tts.cloud.enabled
          ? {
            enabled: true,
            provider: data.tts.cloud.provider,
            ...(data.tts.cloud.provider === 'fish-audio'
              ? { model: data.tts.cloud.model.trim(), voice: data.tts.cloud.voice.trim() }
              : {}),
          }
          : { enabled: false },
      },
      weather: { locationName: data.dj.locationName, lat: data.dj.lat, lng: data.dj.lng },
      station: data.dj.stationName,
      // '' = Auto; sent so a picked city's zone reaches settings.update().
      timezone: data.dj.timezone,
      apiKeys,
    };
    const r = await auth.adminFetch('/onboarding/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: !!j.ok, error: j.error };
  }, [auth, data]);

  return {
    auth,
    data,
    patch,
    step,
    stepIdx,
    next,
    back,
    goto,
    changeLlmProvider,
    testNavidrome,
    testLlm,
    discoverCustomModels,
    save,
  };
}

export type WizardController = ReturnType<typeof useWizard>;

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  discoveryKeys,
  fetchModels,
  fetchVoices,
  refreshDiscoveryQuery,
  useModelDiscoveryQuery,
  useVoiceDiscoveryQuery,
} from './discovery-queries';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 10));
}

test('discovery cache identity separates credentials without retaining their raw values', () => {
  const modelA = discoveryKeys.models({ owner: 'chat', provider: 'openai', apiKey: 'model-secret-a' });
  const modelB = discoveryKeys.models({ owner: 'chat', provider: 'openai', apiKey: 'model-secret-b' });
  const voice = discoveryKeys.voices({ provider: 'elevenlabs', apiKey: 'voice-secret' });

  assert.notDeepEqual(modelA, modelB, 'a changed unsaved credential must trigger a distinct discovery read');
  assert.doesNotMatch(JSON.stringify(modelA), /model-secret-a/);
  assert.doesNotMatch(JSON.stringify(modelB), /model-secret-b/);
  assert.doesNotMatch(JSON.stringify(voice), /voice-secret/);
});

test('query-backed model discovery keeps unsaved provider configuration in a POST body', async () => {
  const controller = new AbortController();
  let receivedPath = '';
  let receivedInit: RequestInit | undefined;
  const result = await fetchModels(async (path, init) => {
    receivedPath = path;
    receivedInit = init;
    return Response.json({ ok: true, models: ['body-safe-model'] });
  }, {
    owner: 'chat',
    provider: 'openai-compatible',
    leg: 'fallback',
    apiKey: 'unsaved-model-secret',
    baseUrl: 'https://models.example/v1',
    ollamaUrl: 'https://ollama.example',
  }, controller.signal);

  assert.deepEqual(result, { ok: true, models: ['body-safe-model'] });
  assert.equal(receivedPath, '/settings/llm/models');
  assert.equal(receivedInit?.method, 'POST');
  assert.equal(receivedInit?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(receivedInit?.body)), {
    owner: 'chat',
    provider: 'openai-compatible',
    leg: 'fallback',
    baseUrl: 'https://models.example/v1',
    ollamaUrl: 'https://ollama.example',
    apiKey: 'unsaved-model-secret',
  });
  assert.doesNotMatch(receivedPath, /secret|example|apiKey|baseUrl|ollamaUrl/);
});

test('query-backed voice discovery keeps unsaved provider configuration in a POST body', async () => {
  const controller = new AbortController();
  let receivedPath = '';
  let receivedInit: RequestInit | undefined;
  const result = await fetchVoices(async (path, init) => {
    receivedPath = path;
    receivedInit = init;
    return Response.json({ ok: true, voices: [{ id: 'voice-1', label: 'Voice One' }] });
  }, {
    provider: 'openai-compatible',
    apiKey: 'unsaved-voice-secret',
    baseUrl: 'https://voices.example/v1',
  }, controller.signal);

  assert.deepEqual(result, {
    ok: true,
    voices: [{ id: 'voice-1', label: 'Voice One' }],
  });
  assert.equal(receivedPath, '/settings/tts/voices');
  assert.equal(receivedInit?.method, 'POST');
  assert.equal(receivedInit?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(receivedInit?.body)), {
    provider: 'openai-compatible',
    baseUrl: 'https://voices.example/v1',
    apiKey: 'unsaved-voice-secret',
  });
  assert.doesNotMatch(receivedPath, /secret|example|apiKey|baseUrl/);
});

test('manual discovery refresh aborts and supersedes an in-flight same-key probe', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['discovery', 'models', { provider: 'ollama' }] as const;
  let firstAborted = false;
  let requests = 0;
  const queryFn = ({ signal }: { signal: AbortSignal }) => {
    requests++;
    if (requests === 1) {
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          firstAborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    }
    return Promise.resolve('fresh');
  };

  const first = client.fetchQuery({ queryKey: key, queryFn }).catch(() => undefined);
  const result = await refreshDiscoveryQuery(client, key, queryFn);
  await first;

  assert.equal(firstAborted, true);
  assert.equal(requests, 2);
  assert.equal(result, 'fresh');
});

test('model discovery hides an A response that resolves during the raw A-to-B debounce transition', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pendingA = deferredResponse();
  let requestStarted!: () => void;
  const started = new Promise<void>(resolve => { requestStarted = resolve; });
  const adminFetch = async () => {
    requestStarted();
    return pendingA.promise;
  };
  const inputA = { owner: 'chat' as const, provider: 'provider-a', apiKey: 'key-a' };
  const inputB = { owner: 'chat' as const, provider: 'provider-b', apiKey: 'key-b' };
  let activeInput = inputA;
  let latest: ReturnType<typeof useModelDiscoveryQuery> | undefined;

  function Harness() {
    latest = useModelDiscoveryQuery(activeInput, true, adminFetch);
    return null;
  }

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(
        QueryClientProvider,
        { client },
        createElement(Harness),
      ));
    });
    await started;

    await act(async () => {
      activeInput = inputB;
      renderer!.update(createElement(
        QueryClientProvider,
        { client },
        createElement(Harness),
      ));
    });

    pendingA.resolve(Response.json({ ok: true, models: ['stale-model-a'] }));
    await act(flush);

    assert.deepEqual(client.getQueryData(discoveryKeys.models(inputA)), {
      ok: true,
      models: ['stale-model-a'],
    }, 'the A response must resolve while the A query is still active');
    assert.deepEqual(latest?.models, []);
    assert.equal(latest?.error, null);
  } finally {
    const mounted = renderer;
    if (mounted) await act(async () => { mounted.unmount(); });
    client.clear();
  }
});

test('model discovery hides an A error that resolves during the raw A-to-B debounce transition', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pendingA = deferredResponse();
  let requestStarted!: () => void;
  const started = new Promise<void>(resolve => { requestStarted = resolve; });
  const adminFetch = async () => {
    requestStarted();
    return pendingA.promise;
  };
  const inputA = { owner: 'chat' as const, provider: 'provider-a', baseUrl: 'https://a.example/v1' };
  const inputB = { owner: 'chat' as const, provider: 'provider-b', baseUrl: 'https://b.example/v1' };
  let activeInput = inputA;
  let latest: ReturnType<typeof useModelDiscoveryQuery> | undefined;

  function Harness() {
    latest = useModelDiscoveryQuery(activeInput, true, adminFetch);
    return null;
  }

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(
        QueryClientProvider,
        { client },
        createElement(Harness),
      ));
    });
    await started;

    await act(async () => {
      activeInput = inputB;
      renderer!.update(createElement(
        QueryClientProvider,
        { client },
        createElement(Harness),
      ));
    });

    pendingA.resolve(Response.json({ ok: false, models: [], error: 'stale-model-error-a' }));
    await act(flush);

    assert.equal(client.getQueryState(discoveryKeys.models(inputA))?.status, 'success');
    assert.equal(latest?.error, null);
  } finally {
    const mounted = renderer;
    if (mounted) await act(async () => { mounted.unmount(); });
    client.clear();
  }
});

test('voice discovery hides an A error that resolves during the raw A-to-B debounce transition', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pendingA = deferredResponse();
  let requestStarted!: () => void;
  const started = new Promise<void>(resolve => { requestStarted = resolve; });
  const adminFetch = async () => {
    requestStarted();
    return pendingA.promise;
  };
  const inputA = { provider: 'provider-a', apiKey: 'voice-key-a' };
  const inputB = { provider: 'provider-b', apiKey: 'voice-key-b' };
  let activeInput = inputA;
  let latest: ReturnType<typeof useVoiceDiscoveryQuery> | undefined;

  function Harness() {
    latest = useVoiceDiscoveryQuery(activeInput, true, adminFetch);
    return null;
  }

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(
        QueryClientProvider,
        { client },
        createElement(Harness),
      ));
    });
    await started;

    await act(async () => {
      activeInput = inputB;
      renderer!.update(createElement(
        QueryClientProvider,
        { client },
        createElement(Harness),
      ));
    });

    pendingA.resolve(Response.json(
      { error: 'stale-voice-error-a' },
      { status: 503 },
    ));
    await act(flush);

    assert.equal(client.getQueryState(discoveryKeys.voices(inputA))?.status, 'error');
    assert.equal(latest?.error, null);
  } finally {
    const mounted = renderer;
    if (mounted) await act(async () => { mounted.unmount(); });
    client.clear();
  }
});

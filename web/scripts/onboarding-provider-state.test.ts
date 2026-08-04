import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { act, create } from 'react-test-renderer';
import * as providerState from '../components/onboarding/providerState.ts';
import { useWizard, type WizardController } from '../components/onboarding/useWizard.ts';

const {
  llmDraftForProviderChange,
} = providerState;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const compatible = {
  provider: 'openai-compatible',
  model: 'local-model',
  apiKey: 'compatible-secret',
  baseUrl: 'https://compatible.example/v1',
  ollamaUrl: 'http://host.docker.internal:11434',
};

const toLiteLlm = llmDraftForProviderChange(compatible, 'litellm', {});
assert.deepEqual(toLiteLlm, {
  llm: {
    provider: 'litellm',
    model: '',
    apiKey: '',
    baseUrl: '',
    ollamaUrl: '',
  },
  drafts: {
    'openai-compatible': {
      model: 'local-model',
      apiKey: 'compatible-secret',
      baseUrl: 'https://compatible.example/v1',
      ollamaUrl: 'http://host.docker.internal:11434',
    },
  },
});

const editedLiteLlm = {
  ...toLiteLlm.llm,
  model: 'anthropic/claude-sonnet',
  apiKey: 'litellm-secret',
  baseUrl: 'https://litellm.example/v1',
};
const backToCompatible = llmDraftForProviderChange(
  editedLiteLlm,
  'openai-compatible',
  toLiteLlm.drafts,
);
assert.deepEqual(backToCompatible.llm, compatible);

const backToLiteLlm = llmDraftForProviderChange(
  backToCompatible.llm,
  'litellm',
  backToCompatible.drafts,
);
assert.deepEqual(backToLiteLlm.llm, editedLiteLlm);

const llmForSubmission = (providerState as typeof providerState & {
  llmForSubmission?: (llm: typeof compatible) => Record<string, string>;
}).llmForSubmission;
assert.equal(typeof llmForSubmission, 'function');
assert.deepEqual(llmForSubmission?.(backToCompatible.llm), {
  provider: 'openai-compatible',
  model: 'local-model',
  apiKey: 'compatible-secret',
  baseUrl: 'https://compatible.example/v1',
});
assert.deepEqual(llmForSubmission?.(backToLiteLlm.llm), {
  provider: 'litellm',
  model: 'anthropic/claude-sonnet',
  apiKey: 'litellm-secret',
  baseUrl: 'https://litellm.example/v1',
});

interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

async function verifyStaleDiscoveryCannotReachActiveDraft() {
  const previousFetch = globalThis.fetch;
  const pendingResponse = deferredResponse();
  globalThis.fetch = async () => pendingResponse.promise;

  let wizard: WizardController | undefined;
  let refresh: (() => Promise<void>) | undefined;
  function Harness() {
    wizard = useWizard();
    const [models, setModels] = useState<string[]>([]);
    refresh = async () => {
      const result = await wizard!.discoverCustomModels();
      setModels(result.models);
    };
    return createElement('output', {
      'data-provider': wizard.data.llm.provider,
      'data-model': wizard.data.llm.model,
      'data-discovered-models': models.join(','),
    });
  }

  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(Harness)); });
    await act(async () => {
      wizard!.patch(current => ({
        llm: {
          ...current.llm,
          provider: 'openai-compatible',
          model: 'active-compatible-model',
          apiKey: 'compatible-secret',
          baseUrl: 'https://compatible.example/v1',
        },
      }));
    });

    const staleRequest = refresh!();
    await act(async () => {
      wizard!.patch(current => ({
        llm: llmDraftForProviderChange(current.llm, 'litellm'),
      }));
    });
    assert.equal(wizard!.data.llm.provider, 'litellm');
    assert.equal(wizard!.data.llm.model, '');

    pendingResponse.resolve(new Response(JSON.stringify({
      ok: true,
      models: ['stale-compatible-model'],
    }), { headers: { 'content-type': 'application/json' } }));
    await act(async () => { await staleRequest; });

    assert.equal(wizard!.data.llm.provider, 'litellm');
    assert.equal(wizard!.data.llm.model, '');
    const output = renderer.root.findByType('output');
    assert.equal(output.props['data-provider'], 'litellm');
    assert.equal(output.props['data-model'], '');
    assert.equal(output.props['data-discovered-models'], '');
  } finally {
    globalThis.fetch = previousFetch;
    if (renderer) await act(async () => { renderer.unmount(); });
  }
}

async function verifyEndpointChangeInvalidatesDiscovery() {
  const previousFetch = globalThis.fetch;
  const pendingResponse = deferredResponse();
  let requestBody = '';
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? '');
    return pendingResponse.promise;
  };

  let wizard: WizardController | undefined;
  let refresh: (() => Promise<void>) | undefined;
  function Harness() {
    wizard = useWizard();
    const [models, setModels] = useState<string[]>([]);
    refresh = async () => {
      const result = await wizard!.discoverCustomModels();
      setModels(result.models);
    };
    return createElement('output', {
      'data-provider': wizard.data.llm.provider,
      'data-base-url': wizard.data.llm.baseUrl,
      'data-model': wizard.data.llm.model,
      'data-discovered-models': models.join(','),
    });
  }

  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(Harness)); });
    await act(async () => {
      wizard!.patch(current => ({
        llm: llmDraftForProviderChange(current.llm, 'openai-compatible'),
      }));
    });
    await act(async () => {
      wizard!.patch(current => ({
        llm: {
          ...current.llm,
          model: 'active-compatible-model',
          apiKey: 'compatible-secret',
          baseUrl: 'https://endpoint-a.example/v1',
        },
      }));
    });

    const staleRequest = refresh!();
    assert.equal(JSON.parse(requestBody).baseUrl, 'https://endpoint-a.example/v1');
    await act(async () => {
      wizard!.patch(current => ({
        llm: { ...current.llm, baseUrl: 'https://endpoint-b.example/v1' },
      }));
    });

    pendingResponse.resolve(new Response(JSON.stringify({
      ok: true,
      models: ['stale-endpoint-a-model'],
    }), { headers: { 'content-type': 'application/json' } }));
    await act(async () => { await staleRequest; });

    assert.equal(wizard!.data.llm.provider, 'openai-compatible');
    assert.equal(wizard!.data.llm.baseUrl, 'https://endpoint-b.example/v1');
    assert.equal(wizard!.data.llm.model, 'active-compatible-model');
    const output = renderer.root.findByType('output');
    assert.equal(output.props['data-provider'], 'openai-compatible');
    assert.equal(output.props['data-base-url'], 'https://endpoint-b.example/v1');
    assert.equal(output.props['data-model'], 'active-compatible-model');
    assert.equal(output.props['data-discovered-models'], '');
  } finally {
    globalThis.fetch = previousFetch;
    if (renderer) await act(async () => { renderer.unmount(); });
  }
}

async function main() {
  await verifyStaleDiscoveryCannotReachActiveDraft();
  await verifyEndpointChangeInvalidatesDiscovery();
  console.log('onboarding-provider-state.test.ts: provider drafts, serialization, and real discovery ownership stay isolated');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

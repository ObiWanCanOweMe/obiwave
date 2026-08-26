import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ChangeEvent, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { SettingsData } from '../components/admin/settings/shared.tsx';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const storage = new Map<string, string>([['subwave_admin_auth', 'test-admin-token']]);
const storageWrites: Array<[string, string]> = [];
const requests: Array<{ url: string; method: string; owner?: string }> = [];
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageWrites.push([key, value]);
    storage.set(key, value);
  },
  removeItem: (key: string) => { storage.delete(key); },
};

class TestElement {
  scrollIntoView() {}
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  removeEventListener() {}
  contains() { return false; }
  closest() { return null; }
}

class TestFormElement extends TestElement {}
class TestSelectElement extends TestElement {}
Object.defineProperty(TestSelectElement.prototype, 'value', {
  configurable: true,
  get: () => '',
  set: () => {},
});

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (fn: FrameRequestCallback) => { fn(0); return 1; },
    setTimeout,
    clearTimeout,
    HTMLSelectElement: TestSelectElement,
    getComputedStyle: () => ({ direction: 'ltr' }),
  },
});
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    head: { appendChild: () => {} },
    documentElement: { getAttribute: () => null },
    hidden: false,
    activeElement: null,
    createElement: () => ({ appendChild: () => {} }),
    createTextNode: () => ({}),
    getElementsByTagName: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: TestElement });
Object.defineProperty(globalThis, 'HTMLFormElement', {
  configurable: true,
  value: TestFormElement,
});
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: class { observe() {}; unobserve() {}; disconnect() {} },
});
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? init.body : '';
    let owner: string | undefined;
    try {
      owner = (JSON.parse(body) as { owner?: string }).owner;
    } catch {}
    // Count only redacted request metadata. Draft credentials remain solely in
    // the component and transient Request body, never in this behavior ledger.
    requests.push({ url, method: init.method || 'GET', ...(owner ? { owner } : {}) });
    if (url.endsWith('/settings/llm/models')) {
      return new Response(JSON.stringify({ ok: true, models: ['fixture-model'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/settings/tts/voices')) {
      return new Response(JSON.stringify({ ok: true, voices: [{ id: 'fixture-voice', label: 'Fixture voice' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(SETTINGS), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});

const SETTINGS = {
  values: {
    station: 'Test station',
    tts: {
      enabled: true,
      defaultEngine: 'cloud',
      fallback: {
        enabled: false,
        engine: 'piper',
        voice: '',
        cloudProvider: 'openai-compatible',
      },
      kokoro: { voice: 'bf_isabella', lang: 'en-us' },
      chatterbox: { referenceVoice: '' },
      pocketTts: { voice: 'alba' },
      cloud: {
        enabled: true,
        provider: 'openai-compatible',
        model: 'tts-model',
        voice: '',
        baseUrl: 'https://tts.example.test/v1',
        compatParams: [],
      },
      remote: { url: '' },
      gainDb: {},
      speed: {},
      corrections: [],
    },
    llm: {
      provider: 'openai-compatible',
      model: 'chat-model',
      providerBaseUrls: { 'openai-compatible': 'https://chat.example.test/v1' },
      fallback: {
        enabled: true,
        provider: 'openai-compatible',
        model: 'fallback-model',
        providerBaseUrls: { 'openai-compatible': 'https://fallback.example.test/v1' },
      },
    },
    embedding: {
      enabled: true,
      provider: 'openai-compatible',
      model: 'embedding-model',
      providerBaseUrls: { 'openai-compatible': 'https://embed.example.test/v1' },
      enrichment: {},
    },
  },
  env: {},
  tts: {
    engines: ['cloud'],
    available: { cloud: true },
    cloudProviders: ['openai-compatible'],
  },
  llm: {
    active: 'openai-compatible:chat-model',
    providers: ['openai-compatible'],
  },
  embedding: { providers: ['openai-compatible'] },
  navidrome: {
    url: 'https://music.saved.example.test',
    user: 'saved-user',
    passSet: true,
    env: { url: false, user: false, pass: false },
  },
} as unknown as SettingsData;

function textContent(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
}

function navButton(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const button = renderer.root.findAllByType('button').find(node => {
    const text = textContent(node);
    return text.includes(label) && !text.includes('Save');
  });
  assert.ok(button, `navigation button ${label} is mounted`);
  return button;
}

function inputById(renderer: ReactTestRenderer, id: string): ReactTestInstance {
  return renderer.root.findAllByType('input').find(node => node.props.id === id)!;
}

async function navigate(renderer: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => { navButton(renderer, label).props.onClick(); });
}

async function type(input: ReactTestInstance, value: string): Promise<void> {
  await act(async () => {
    input.props.onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);
  });
}

function passwordInputs(renderer: ReactTestRenderer, section: string): ReactTestInstance[] {
  const root = renderer.root.find(
    node => node.props['data-settings-section'] === section,
  );
  return root.findAllByType('input').filter(node => node.props.type === 'password');
}

function sectionRoots(renderer: ReactTestRenderer, section: string): ReactTestInstance[] {
  return renderer.root.findAll(node => node.props['data-settings-section'] === section);
}

function savePortals(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(node => node.props['data-settings-save-portal'] === true);
}

function discoveryRequests(path: string, owner?: string) {
  return requests.filter(request => request.url.endsWith(path) && (!owner || request.owner === owner));
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.fail(message);
}

function hasUnsavedDot(button: ReactTestInstance): boolean {
  return button.findAll(node => node.props['aria-label'] === 'unsaved changes').length > 0;
}

async function main() {
  const require = createRequire(import.meta.url);
  const reactDom = require('react-dom') as typeof import('react-dom');
  const realCreatePortal = reactDom.createPortal;
  reactDom.createPortal = ((children: ReactNode, target: Element | DocumentFragment) =>
    createElement('test-save-portal', {
      'data-settings-save-portal': true,
      target,
    }, children)) as typeof reactDom.createPortal;

  const [{ AppRouterContext }, { SearchParamsContext, PathnameContext }, { default: SettingsPanel }] =
    await Promise.all([
      import('next/dist/shared/lib/app-router-context.shared-runtime.js'),
      import('next/dist/shared/lib/hooks-client-context.shared-runtime.js'),
      import('../components/admin/SettingsPanel.tsx'),
    ]);

  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
    },
  });
  client.setQueryData(['settings', 'detail'], SETTINGS);
  const router = {
    bfcacheId: 'settings-draft-test',
    back: () => {}, forward: () => {}, refresh: () => {}, hmrRefresh: () => {},
    push: () => {}, replace: () => {}, prefetch: async () => {},
  };

  let renderer!: ReactTestRenderer;
  try {
    await act(async () => {
      renderer = create(
        createElement(
          AppRouterContext.Provider,
          { value: router },
          createElement(
            SearchParamsContext.Provider,
            { value: new URLSearchParams() },
            createElement(
              PathnameContext.Provider,
              { value: '/admin/settings' },
              createElement(QueryClientProvider, { client }, createElement(SettingsPanel)),
            ),
          ),
        ),
        { createNodeMock: () => new TestElement() },
      );
    });

    // Credential-heavy sections are deferred: their real component roots and
    // discovery effects do not exist until the operator first visits them.
    for (const section of ['tts', 'llm', 'library', 'music']) {
      assert.equal(sectionRoots(renderer, section).length, 0, `${section} starts unmounted`);
    }
    assert.equal(discoveryRequests('/settings/llm/models').length, 0);
    assert.equal(discoveryRequests('/settings/tts/voices').length, 0);

    await navigate(renderer, 'TTS voice');
    assert.equal(sectionRoots(renderer, 'tts').length, 1, 'first TTS visit mounts one root');
    const ttsRoot = sectionRoots(renderer, 'tts')[0]!;
    await waitFor(
      () => discoveryRequests('/settings/llm/models', 'tts').length === 1
        && discoveryRequests('/settings/tts/voices').length === 1,
      'first TTS visit did not finish its model and voice discovery effects',
    );
    await navigate(renderer, 'Station');
    assert.equal(sectionRoots(renderer, 'tts')[0], ttsRoot, 'inactive TTS root stays mounted');
    await navigate(renderer, 'TTS voice');
    assert.equal(sectionRoots(renderer, 'tts')[0], ttsRoot, 'TTS revisit reuses the same component root');
    assert.equal(discoveryRequests('/settings/llm/models', 'tts').length, 1);
    assert.equal(discoveryRequests('/settings/tts/voices').length, 1);

    const tts = passwordInputs(renderer, 'tts')[0]!;
    await type(tts, 'tts-draft-secret');
    assert.equal(tts.props.value, 'tts-draft-secret');
    assert.equal(hasUnsavedDot(navButton(renderer, 'TTS voice')), true);
    assert.equal(savePortals(renderer).length, 1, 'active dirty TTS owns one SaveBar portal');
    assert.ok(savePortals(renderer)[0]!.props.target instanceof TestElement);
    await navigate(renderer, 'Station');
    assert.equal(hasUnsavedDot(navButton(renderer, 'TTS voice')), true);
    assert.equal(
      savePortals(renderer).length,
      0,
      'inactive dirty TTS cannot portal its SaveBar into the active section slot',
    );
    await navigate(renderer, 'TTS voice');
    assert.equal(passwordInputs(renderer, 'tts')[0]!.props.value, 'tts-draft-secret');
    assert.equal(sectionRoots(renderer, 'tts')[0], ttsRoot);
    assert.equal(savePortals(renderer).length, 1, 'TTS revisit restores exactly one active portal');

    assert.equal(sectionRoots(renderer, 'llm').length, 0, 'LLM remains unmounted before first visit');
    await navigate(renderer, 'LLM provider');
    assert.equal(sectionRoots(renderer, 'llm').length, 1, 'first LLM visit mounts one root');
    const llmRoot = sectionRoots(renderer, 'llm')[0]!;
    await waitFor(
      () => discoveryRequests('/settings/llm/models', 'chat').length === 2,
      'first LLM visit did not finish its primary and fallback discovery effects',
    );
    await navigate(renderer, 'Station');
    assert.equal(savePortals(renderer).length, 0, 'inactive dirty sections expose no SaveBar portal');
    await navigate(renderer, 'LLM provider');
    assert.equal(sectionRoots(renderer, 'llm')[0], llmRoot, 'LLM revisit reuses the same component root');
    assert.equal(discoveryRequests('/settings/llm/models', 'chat').length, 2);
    let llmPasswords = passwordInputs(renderer, 'llm');
    assert.equal(llmPasswords.length, 1, 'the real primary compatibility-key field is mounted');
    await type(llmPasswords[0]!, 'llm-primary-secret');
    const advanced = llmRoot.findAllByType('button')
      .find(node => textContent(node).includes('Advanced'))!;
    await act(async () => { advanced.props.onClick(); });
    llmPasswords = passwordInputs(renderer, 'llm');
    assert.equal(llmPasswords.length, 2, 'the real fallback compatibility-key field is mounted');
    await type(llmPasswords[1]!, 'llm-fallback-secret');
    await navigate(renderer, 'Station');
    await navigate(renderer, 'LLM provider');
    assert.equal(sectionRoots(renderer, 'llm')[0], llmRoot);
    assert.deepEqual(passwordInputs(renderer, 'llm').map(input => input.props.value), [
      'llm-primary-secret',
      'llm-fallback-secret',
    ]);

    assert.equal(sectionRoots(renderer, 'library').length, 0, 'library remains unmounted before first visit');
    await navigate(renderer, 'Library tagger');
    assert.equal(sectionRoots(renderer, 'library').length, 1, 'first library visit mounts one root');
    const libraryRoot = sectionRoots(renderer, 'library')[0]!;
    await waitFor(
      () => discoveryRequests('/settings/llm/models', 'embedding').length === 1,
      'first library visit did not finish its embedding discovery effect',
    );
    await navigate(renderer, 'Station');
    await navigate(renderer, 'Library tagger');
    assert.equal(sectionRoots(renderer, 'library')[0], libraryRoot, 'library revisit reuses the same component root');
    assert.equal(discoveryRequests('/settings/llm/models', 'embedding').length, 1);
    const embedding = passwordInputs(renderer, 'library')[0]!;
    await type(embedding, 'embedding-draft-secret');
    await navigate(renderer, 'Station');
    await navigate(renderer, 'Library tagger');
    assert.equal(passwordInputs(renderer, 'library')[0]!.props.value, 'embedding-draft-secret');

    assert.equal(sectionRoots(renderer, 'music').length, 0, 'music source remains unmounted before first visit');
    await navigate(renderer, 'Music source');
    assert.equal(sectionRoots(renderer, 'music').length, 1, 'first music source visit mounts one root');
    const musicRoot = sectionRoots(renderer, 'music')[0]!;
    await navigate(renderer, 'Station');
    await navigate(renderer, 'Music source');
    assert.equal(sectionRoots(renderer, 'music')[0], musicRoot, 'music source revisit reuses the same component root');
    await type(inputById(renderer, 'nv-url'), 'https://music.draft.example.test');
    await type(inputById(renderer, 'nv-user'), 'draft-user');
    await type(inputById(renderer, 'nv-pass'), 'navidrome-draft-secret');
    await navigate(renderer, 'Station');
    assert.equal(hasUnsavedDot(navButton(renderer, 'Music source')), true);
    await navigate(renderer, 'Music source');
    assert.equal(sectionRoots(renderer, 'music')[0], musicRoot);
    assert.equal(inputById(renderer, 'nv-url').props.value, 'https://music.draft.example.test');
    assert.equal(inputById(renderer, 'nv-user').props.value, 'draft-user');
    assert.equal(inputById(renderer, 'nv-pass').props.value, 'navidrome-draft-secret');

    const secretValues = [
      'tts-draft-secret', 'llm-primary-secret', 'llm-fallback-secret',
      'embedding-draft-secret', 'navidrome-draft-secret',
    ];
    const persisted = JSON.stringify({ storage: [...storage], storageWrites });
    const cached = JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data));
    for (const secret of secretValues) {
      assert.doesNotMatch(persisted, new RegExp(secret));
      assert.doesNotMatch(cached, new RegExp(secret));
    }

    await type(inputById(renderer, 'nv-url'), 'https://music.saved.example.test');
    await type(inputById(renderer, 'nv-user'), 'saved-user');
    await type(inputById(renderer, 'nv-pass'), '');
    assert.equal(hasUnsavedDot(navButton(renderer, 'Music source')), false);
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    client.clear();
    reactDom.createPortal = realCreatePortal;
  }

  console.log('settings-draft-navigation.test.ts: mounted SettingsPanel keeps credential drafts in memory across navigation');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

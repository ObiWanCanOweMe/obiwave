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

function hasUnsavedDot(button: ReactTestInstance): boolean {
  return button.findAll(node => node.props['aria-label'] === 'unsaved changes').length > 0;
}

async function main() {
  const require = createRequire(import.meta.url);
  const reactDom = require('react-dom') as typeof import('react-dom');
  const realCreatePortal = reactDom.createPortal;
  reactDom.createPortal = ((children: ReactNode) => children) as typeof reactDom.createPortal;

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

    await navigate(renderer, 'TTS voice');
    const tts = passwordInputs(renderer, 'tts')[0]!;
    await type(tts, 'tts-draft-secret');
    assert.equal(tts.props.value, 'tts-draft-secret');
    assert.equal(hasUnsavedDot(navButton(renderer, 'TTS voice')), true);
    await navigate(renderer, 'Station');
    assert.equal(hasUnsavedDot(navButton(renderer, 'TTS voice')), true);
    await navigate(renderer, 'TTS voice');
    assert.equal(passwordInputs(renderer, 'tts')[0]!.props.value, 'tts-draft-secret');

    await navigate(renderer, 'LLM provider');
    let llmPasswords = passwordInputs(renderer, 'llm');
    assert.equal(llmPasswords.length, 1, 'the real primary compatibility-key field is mounted');
    await type(llmPasswords[0]!, 'llm-primary-secret');
    const llmRoot = renderer.root.find(node => node.props['data-settings-section'] === 'llm');
    const advanced = llmRoot.findAllByType('button')
      .find(node => textContent(node).includes('Advanced'))!;
    await act(async () => { advanced.props.onClick(); });
    llmPasswords = passwordInputs(renderer, 'llm');
    assert.equal(llmPasswords.length, 2, 'the real fallback compatibility-key field is mounted');
    await type(llmPasswords[1]!, 'llm-fallback-secret');
    await navigate(renderer, 'Station');
    await navigate(renderer, 'LLM provider');
    assert.deepEqual(passwordInputs(renderer, 'llm').map(input => input.props.value), [
      'llm-primary-secret',
      'llm-fallback-secret',
    ]);

    await navigate(renderer, 'Library tagger');
    const embedding = passwordInputs(renderer, 'library')[0]!;
    await type(embedding, 'embedding-draft-secret');
    await navigate(renderer, 'Station');
    await navigate(renderer, 'Library tagger');
    assert.equal(passwordInputs(renderer, 'library')[0]!.props.value, 'embedding-draft-secret');

    await navigate(renderer, 'Music source');
    await type(inputById(renderer, 'nv-url'), 'https://music.draft.example.test');
    await type(inputById(renderer, 'nv-user'), 'draft-user');
    await type(inputById(renderer, 'nv-pass'), 'navidrome-draft-secret');
    await navigate(renderer, 'Station');
    assert.equal(hasUnsavedDot(navButton(renderer, 'Music source')), true);
    await navigate(renderer, 'Music source');
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

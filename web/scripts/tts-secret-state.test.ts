import assert from 'node:assert/strict';
import { createElement, useState, type ChangeEvent } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { TtsSection } from '../components/admin/settings/TtsSection.tsx';
import type { FormState, SettingsData } from '../components/admin/settings/shared.tsx';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENGINE_IDS = ['piper', 'kokoro', 'chatterbox', 'pocket-tts', 'cloud', 'remote'];

const FORM = {
  kokoroLang: 'en-us',
  tts: {
    enabled: true,
    defaultEngine: 'cloud',
    kokoro: { voice: '' },
    chatterbox: { referenceVoice: '' },
    pocketTts: { voice: 'alba' },
    cloud: {
      enabled: true,
      provider: 'openai-compatible',
      model: 'compat-model',
      voice: '',
      baseUrl: '',
      voiceStability: 0.5,
      voiceStyle: 0,
      voiceSimilarityBoost: 0.75,
      voiceUseSpeakerBoost: true,
      temperature: 0.7,
      topP: 0.7,
      latency: 'normal',
    },
    remote: { url: '' },
    gainDb: Object.fromEntries(ENGINE_IDS.map(id => [id, 0])),
    speed: Object.fromEntries(ENGINE_IDS.map(id => [id, 1])),
    corrections: [],
  },
} as unknown as FormState;

const DATA = {
  values: {
    tts: {
      defaultEngine: 'cloud',
      cloud: { provider: 'openai-compatible', compatApiKey: 'set' },
    },
  },
  tts: {
    engines: ['cloud'],
    available: { cloud: true },
    cloudProviders: ['openai-compatible'],
  },
  env: {},
} as SettingsData;

function textContent(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
}

async function renderTtsSection(
  saveSettings: () => Promise<boolean>,
): Promise<{ renderer: ReactTestRenderer; input: () => ReactTestInstance; save: () => Promise<void> }> {
  function Harness() {
    const [form, setForm] = useState(FORM);
    return createElement(TtsSection, {
      data: DATA,
      form,
      setForm: updater => setForm(current => updater(current)),
      busy: false,
      saveSettings,
      adminFetch: async () => new Response(JSON.stringify({ ok: true, models: [], voices: [] })),
      refresh: async () => {},
    });
  }

  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Harness)); });
  const input = () => renderer.root.findAllByType('input').find(node => node.props.type === 'password')!;
  const saveButton = renderer.root.findAllByType('button').find(node => textContent(node).includes('Save TTS settings'))!;
  return {
    renderer,
    input,
    save: async () => {
      await act(async () => { await saveButton.props.onClick({}); });
    },
  };
}

async function typeSecret(view: Awaited<ReturnType<typeof renderTtsSection>>): Promise<void> {
  await act(async () => {
    view.input().props.onChange({ target: { value: 'raw-secret' } } as ChangeEvent<HTMLInputElement>);
  });
  assert.equal(view.input().props.value, 'raw-secret');
}

async function main() {
  let calls = 0;
  let outcome = async () => true;
  const view = await renderTtsSection(async () => { calls += 1; return outcome(); });

  await typeSecret(view);
  await view.save();
  assert.equal(calls, 1);
  assert.equal(view.input().props.value, '');

  outcome = async () => false;
  await typeSecret(view);
  await view.save();
  assert.equal(calls, 2);
  assert.equal(view.input().props.value, 'raw-secret');

  const rejection = new Error('settings unavailable');
  outcome = async () => { throw rejection; };
  await assert.rejects(view.save(), error => error === rejection);
  assert.equal(calls, 3);
  assert.equal(view.input().props.value, 'raw-secret');

  await act(async () => { view.renderer.unmount(); });

  console.log('tts-secret-state.test.ts: compatibility input follows real TTS save outcomes');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

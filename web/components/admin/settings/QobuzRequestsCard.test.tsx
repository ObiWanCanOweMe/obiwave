import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QobuzRequestsCard } from './QobuzRequestsCard';
import { settingsForm } from './form-state';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
test('credential inputs stay empty on hydration, survive refusal and clear after saving', async () => {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = []; let fail = true;
  const status = { enabled: false, ready: false, credentials: Object.fromEntries(['appId','appSecret','userAuthToken','userId'].map(k => [k, { present: true, source: 'saved' }])), cache: { bytes: 0, items: 0 }, lastError: null };
  const adminFetch = async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) }); return Response.json(fail ? { error: 'Save failed' } : { saved: ['appSecret'] }, { status: fail ? 400 : 200 }); }
    return Response.json(status);
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  function Harness() { const [form,setForm] = useState(settingsForm({})); return createElement(QobuzRequestsCard, { form, setForm, fieldErrors: {}, adminFetch }); }
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(Harness))); await new Promise(r => setTimeout(r, 20)); });
  const secret = () => renderer.root.findByProps({ id: 'qobuz-appSecret' });
  assert.equal(secret().props.type, 'password'); assert.equal(secret().props.value, '');
  await act(async () => { secret().props.onChange({ target: { value: 'typed-private-value' } }); });
  const save = () => renderer.root.findAllByType('button').find(b => b.props.children === 'Save credentials')!;
  await act(async () => { await save().props.onClick(); }); assert.equal(secret().props.value, 'typed-private-value');
  fail = false; await act(async () => { await save().props.onClick(); }); assert.equal(secret().props.value, '');
  assert.equal(posts[0]!.path, '/settings/qobuz/credentials'); assert.equal(posts[0]!.body.appSecret, 'typed-private-value');
  assert.equal(JSON.stringify(client.getMutationCache().getAll().map(m => m.state)).includes('typed-private-value'), false);
  await act(async () => renderer.unmount()); client.clear();
});

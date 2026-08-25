import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as searchProviderState from '../components/admin/settings/search-provider-state.ts';
import {
  SEARCH_PROVIDER_META,
  createSearchKeyTestOwnership,
  reconcileSearchKeyDraftsAfterSave,
  searchKeyDirty,
  searchKeyInputValue,
  searchKeyPatch,
  searchKeySource,
} from '../components/admin/settings/search-provider-state.ts';

assert.equal(SEARCH_PROVIDER_META.kagi.label, 'Kagi (paid Search API)');
assert.equal(SEARCH_PROVIDER_META.kagi.envVar, 'KAGI_API_KEY');
assert.equal(SEARCH_PROVIDER_META.brave.envVar, 'SEARCH_API_KEY');
assert.equal(searchKeyInputValue('set'), '');
assert.equal(searchKeyInputValue(null), '');
assert.equal(searchKeyInputValue('new-key'), 'new-key');
assert.equal(searchKeyPatch('set'), undefined);
assert.equal(searchKeyPatch(''), undefined);
assert.equal(searchKeyPatch('  new-key  '), 'new-key');
assert.equal(searchKeyPatch(null), null);
assert.equal(searchKeyDirty('set', 'set'), false);
assert.equal(searchKeyDirty('new-key', 'set'), true);
assert.equal(searchKeyDirty(null, 'set'), true);
assert.equal(searchKeyDirty(null, ''), false);
assert.equal(searchKeySource('set', true), 'saved');
assert.equal(searchKeySource('', true), 'environment');
assert.equal(searchKeySource('', false), 'missing');

const keyTestOwnership = createSearchKeyTestOwnership();
const invalidatedRequest = keyTestOwnership.begin();
keyTestOwnership.invalidate();
let publishedResult = '';
assert.equal(
  keyTestOwnership.publishIfCurrent(invalidatedRequest, () => {
    publishedResult = 'obsolete';
  }),
  false,
);
assert.equal(publishedResult, '');
const currentRequest = keyTestOwnership.begin();
assert.equal(
  keyTestOwnership.publishIfCurrent(currentRequest, () => {
    publishedResult = 'current';
  }),
  true,
);
assert.equal(publishedResult, 'current');

assert.deepEqual(
  reconcileSearchKeyDraftsAfterSave(
    { tavily: '', brave: 'set', kagi: 'replacement-key' },
    { kagi: 'replacement-key' },
  ),
  { tavily: '', brave: 'set', kagi: 'set' },
);
assert.deepEqual(
  reconcileSearchKeyDraftsAfterSave(
    { tavily: '', brave: 'set', kagi: null },
    { kagi: null },
  ),
  { tavily: '', brave: 'set', kagi: null },
);
assert.deepEqual(
  reconcileSearchKeyDraftsAfterSave(
    { tavily: '', brave: 'set', kagi: 'unchanged' },
    { tavily: '', brave: 'set' },
  ),
  { tavily: '', brave: 'set', kagi: 'unchanged' },
);

const here = dirname(fileURLToPath(import.meta.url));
const sectionPath = resolve(here, '../components/admin/settings/SearchSection.tsx');
const section = readFileSync(sectionPath, 'utf8');

// Exercise SearchSection's real event handlers without bringing a DOM renderer
// into this small node:test-style contract. TypeScript removes the TSX, inert
// child components keep the returned element tree inspectable, and the hook
// dispatcher supplies only the useState behavior SearchSection itself uses.
const components = {
  Input: function Input() {},
  Label: function Label() {},
  Select: function Select() {},
  SelectTrigger: function SelectTrigger() {},
  SelectValue: function SelectValue() {},
  SelectContent: function SelectContent() {},
  SelectItem: function SelectItem() {},
  SelectGroup: function SelectGroup() {},
  Card: function Card() {},
  Btn: function Btn() {},
  Pill: function Pill() {},
  SectionHeader: function SectionHeader() {},
  SaveBar: function SaveBar() {},
  KeyStatus: function KeyStatus() {},
  KeyTestResult: function KeyTestResult() {},
};
const hookState: unknown[] = [];
let hookStateWriteCount = 0;
let hookCursor = 0;
const useState = (initial: unknown) => {
  const index = hookCursor++;
  if (!(index in hookState)) {
    hookState[index] = typeof initial === 'function'
      ? (initial as () => unknown)()
      : initial;
  }
  return [
    hookState[index],
    (next: unknown) => {
      hookStateWriteCount += 1;
      hookState[index] = typeof next === 'function'
        ? (next as (current: unknown) => unknown)(hookState[index])
        : next;
    },
  ];
};
const dependencyMocks = new Map<string, unknown>([
  ['react', { useState }],
  ['../../../lib/notify', { errorMessage: (error: unknown) => String(error) }],
  ['../../../lib/admin-query', {
    adminResponse: (
      adminFetch: (path: string, init?: RequestInit) => Promise<Response>,
      path: string,
      init?: RequestInit,
    ) => adminFetch(path, init),
  }],
  ['../../ui/input', { Input: components.Input }],
  ['../../ui/label', { Label: components.Label }],
  ['../../ui/select', {
    Select: components.Select,
    SelectTrigger: components.SelectTrigger,
    SelectValue: components.SelectValue,
    SelectContent: components.SelectContent,
    SelectItem: components.SelectItem,
    SelectGroup: components.SelectGroup,
  }],
  ['../ui', {
    Card: components.Card,
    Btn: components.Btn,
    Pill: components.Pill,
  }],
  ['./shared', {
    SectionHeader: components.SectionHeader,
    SaveBar: components.SaveBar,
    KeyStatus: components.KeyStatus,
    KeyTestResult: components.KeyTestResult,
  }],
  ['./search-provider-state', searchProviderState],
]);
const transpiledSection = ts.transpileModule(section, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sectionPath,
}).outputText;
const realRequire = createRequire(import.meta.url);
const sectionModule = { exports: {} as Record<string, unknown> };
const sectionFactory = runInThisContext(
  `(function (exports, require, module, __filename, __dirname) {\n${transpiledSection}\n})`,
  { filename: sectionPath },
) as (
  exports: Record<string, unknown>,
  require: (specifier: string) => unknown,
  module: typeof sectionModule,
  filename: string,
  directory: string,
) => void;
sectionFactory(
  sectionModule.exports,
  specifier => dependencyMocks.get(specifier) ?? realRequire(specifier),
  sectionModule,
  sectionPath,
  dirname(sectionPath),
);
const SearchSection = sectionModule.exports.SearchSection as (props: unknown) => React.ReactNode;

const renderWithHooks = (props: unknown): React.ReactNode => {
  hookCursor = 0;
  return SearchSection(props);
};

type TestElement = React.ReactElement<Record<string, unknown>>;
const findElement = (
  node: React.ReactNode,
  predicate: (element: TestElement) => boolean,
): TestElement | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (!React.isValidElement<Record<string, unknown>>(node)) return undefined;
  if (predicate(node)) return node;
  return findElement(node.props.children as React.ReactNode, predicate);
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}
const deferred = <T>(): Deferred<T> => {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  return {
    promise: new Promise<T>((resolvePromiseArg, rejectPromiseArg) => {
      resolvePromise = resolvePromiseArg;
      rejectPromise = rejectPromiseArg;
    }),
    resolve: resolvePromise,
    reject: rejectPromise,
  };
};

const requests: Deferred<Response>[] = [];
const adminFetch = () => {
  const request = deferred<Response>();
  requests.push(request);
  return request.promise;
};
let form = {
  search: {
    provider: 'searxng',
    baseUrl: 'http://old-searxng.test',
    apiKeys: {},
  },
};
const props = () => ({
  data: {
    values: {
      search: {
        provider: 'searxng',
        baseUrl: 'http://old-searxng.test',
        apiKeys: {},
      },
    },
    search: { providers: ['duckduckgo', 'searxng'] },
    env: {},
  },
  form,
  setForm: (update: typeof form | ((current: typeof form) => typeof form)) => {
    form = typeof update === 'function' ? update(form) : update;
  },
  busy: false,
  saveSettings: async () => {},
  adminFetch,
});
const renderSection = () => renderWithHooks(props());
const searxngInput = (tree: React.ReactNode) => {
  const input = findElement(tree, element => element.type === components.Input);
  assert.ok(input, 'SearXNG URL input must be rendered');
  return input;
};
const providerSelect = (tree: React.ReactNode) => {
  const select = findElement(tree, element => element.type === components.Select);
  assert.ok(select, 'provider select must be rendered');
  return select;
};
const searxngButton = (tree: React.ReactNode) => {
  const button = findElement(
    tree,
    element => element.type === components.Btn
      && (element.props.children === 'Test' || element.props.children === 'Testing…'),
  );
  assert.ok(button, 'SearXNG test button must be rendered');
  return button;
};
const searxngUi = (tree: React.ReactNode) => {
  const button = searxngButton(tree);
  const status = findElement(
    tree,
    element => element.type === 'p' && element.props.role === 'status',
  );
  return {
    button: button.props.children,
    disabled: button.props.disabled,
    status: status?.props.children ?? null,
  };
};

let tree = renderSection();
const firstClick = searxngButton(tree).props.onClick as () => Promise<void>;
assert.equal(typeof firstClick, 'function', 'SearXNG test button must be clickable');
const firstRun = firstClick();
tree = renderSection();
assert.equal(searxngUi(tree).button, 'Testing…', 'probe start publishes busy state');

const firstRequest = requests[0];
assert.ok(firstRequest, 'first SearXNG request must be pending');
firstRequest.resolve({
  json: async () => ({ ok: true, results: 17 }),
} as Response);
await firstRun;
tree = renderSection();
assert.deepEqual(
  searxngUi(tree),
  { button: 'Test', disabled: false, status: 'Connected · 17 results' },
  'the current SearXNG probe publishes its completed verdict',
);
const successfulStatus = findElement(
  tree,
  element => element.type === 'p' && element.props.role === 'status',
);
assert.ok(successfulStatus, 'successful SearXNG verdict must be rendered');
assert.match(
  String(successfulStatus.props.className),
  /\btext-green-600\b/,
  'successful SearXNG verdict must use the green status treatment',
);

const editUrl = searxngInput(tree).props.onChange as (
  event: { target: { value: string } },
) => void;
assert.equal(typeof editUrl, 'function', 'SearXNG URL input must be editable');
editUrl({ target: { value: 'http://new-searxng.test' } });
tree = renderSection();
assert.deepEqual(
  searxngUi(tree),
  { button: 'Test', disabled: false, status: null },
  'editing the URL immediately clears the completed verdict and busy state',
);

const secondClick = searxngButton(tree).props.onClick as () => Promise<void>;
assert.equal(typeof secondClick, 'function', 'replacement SearXNG URL must be testable');
const secondRun = secondClick();
tree = renderSection();
assert.equal(searxngUi(tree).button, 'Testing…', 'replacement URL starts its own probe');

const editPendingUrl = searxngInput(tree).props.onChange as (
  event: { target: { value: string } },
) => void;
assert.equal(typeof editPendingUrl, 'function', 'pending SearXNG URL must be editable');
editPendingUrl({ target: { value: 'http://newer-searxng.test' } });
tree = renderSection();
assert.deepEqual(
  searxngUi(tree),
  { button: 'Test', disabled: false, status: null },
  'editing the URL invalidates the pending probe and immediately clears its UI state',
);
const writesAfterPendingUrlEdit = hookStateWriteCount;

const secondRequest = requests[1];
assert.ok(secondRequest, 'edited SearXNG request must still be pending');
secondRequest.resolve({
  json: async () => ({ ok: true, results: 23 }),
} as Response);
await secondRun;
assert.equal(
  hookStateWriteCount,
  writesAfterPendingUrlEdit,
  'stale success and finally must not publish any state writes after a URL edit',
);
tree = renderSection();
assert.deepEqual(
  searxngUi(tree),
  { button: 'Test', disabled: false, status: null },
  'the edited URL owns visible state before any replacement probe can supersede the old request',
);

const thirdClick = searxngButton(tree).props.onClick as () => Promise<void>;
assert.equal(typeof thirdClick, 'function', 'edited SearXNG URL must remain testable');
const thirdRun = thirdClick();
tree = renderSection();
assert.equal(searxngUi(tree).button, 'Testing…', 'provider-switch probe starts pending');

const switchAway = providerSelect(tree).props.onValueChange as (provider: string) => void;
assert.equal(typeof switchAway, 'function', 'provider must be selectable');
switchAway('duckduckgo');
tree = renderSection();
const switchBack = providerSelect(tree).props.onValueChange as (provider: string) => void;
assert.equal(typeof switchBack, 'function', 'SearXNG must be selectable again');
switchBack('searxng');
tree = renderSection();
assert.deepEqual(
  searxngUi(tree),
  { button: 'Test', disabled: false, status: null },
  'switching providers invalidates the pending probe and immediately clears its UI state',
);

const thirdRequest = requests[2];
assert.ok(thirdRequest, 'provider-switch SearXNG request must be pending');
thirdRequest.reject(new Error('old provider failed'));
await thirdRun;
tree = renderSection();
assert.deepEqual(
  searxngUi(tree),
  { button: 'Test', disabled: false, status: null },
  'stale errors and finally cannot republish after a provider switch',
);

assert.match(
  section,
  /const setActiveKeyDraft =.*invalidateKeyTest\(\).*apiKeys:.*\[provider\]: value/s,
  'active credential updates invalidate keyed probes before changing the draft',
);
assert.match(
  section,
  /onChange=.*setActiveKeyDraft\(e\.target\.value\)/s,
  'active credential edits use the invalidating draft updater',
);
assert.match(
  section,
  /onClick=.*setActiveKeyDraft\(null\)/s,
  'staged credential clears use the invalidating draft updater',
);
assert.match(
  section,
  /key:\s*keyed\.envVar[\s\S]*provider/,
  'key probe uses the active provider environment variable and id',
);

console.log('✓ search provider state stays provider-scoped');

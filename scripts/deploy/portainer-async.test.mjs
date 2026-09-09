import test from 'node:test';
import assert from 'node:assert/strict';
import { PortainerClient } from './portainer-client.mjs';

function fixture(replies, options = {}) {
  let clock = 0;
  const calls = [];
  const client = new PortainerClient({
    baseUrl: 'https://portainer.example', apiKey: 'secret', stackId: 7, endpointId: 2,
    now: () => clock, sleep: async ms => { clock += ms; }, pollDelayMs: 10,
    fetchImpl: async (url, init) => {
      calls.push(init.method ?? 'GET');
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      assert.notEqual(reply, undefined, 'unexpected request');
      return new Response(JSON.stringify(reply));
    }, ...options,
  });
  return { client, calls };
}
const snapshot = { Env: [], StackFileContent: 'services: {}' };

test('Portainer 2.45 waits for async deployment before returning', async () => {
  const { client, calls } = fixture([{ Status: 3 }, { Status: 3 }, { Status: 1 }]);
  await client.updateStack(snapshot);
  assert.deepEqual(calls, ['PUT', 'GET', 'GET']);
});

test('synchronous older Portainer response needs no polling', async () => {
  const { client, calls } = fixture([{ Status: 1 }]);
  await client.updateStack(snapshot);
  assert.deepEqual(calls, ['PUT']);
});

test('async failure is reported without leaking the server error', async () => {
  const { client, calls } = fixture([{ Status: 3 }, { Status: 4, Error: 'secret-key' }, { Status: 1 }]);
  await assert.rejects(client.updateStack(snapshot), e => !e.message.includes('secret-key') && /deployment failed/.test(e.message));
  await client.updateStack(snapshot);
  assert.deepEqual(calls, ['PUT', 'GET', 'PUT']);
});

test('timed-out async operation settles before rollback PUT', async () => {
  const { client, calls } = fixture([{ Status: 3 }, { Status: 3 }, { Status: 1 }, { Status: 3 }, { Status: 1 }]);
  await assert.rejects(client.updateStack(snapshot, { deadlineMs: 5 }));
  await client.updateStack(snapshot, { deadlineMs: 100 });
  assert.deepEqual(calls, ['PUT', 'GET', 'GET', 'PUT', 'GET']);
});

test('unreadable pending deployment never permits overlapping rollback', async () => {
  const { client, calls } = fixture([{ Status: 3 }, new Error('offline'), new Error('offline')]);
  await assert.rejects(client.updateStack(snapshot));
  await assert.rejects(client.updateStack(snapshot));
  assert.deepEqual(calls, ['PUT', 'GET', 'GET']);
});


test('rollback settlement and PUT share one update timeout budget', async () => {
  const timeouts = [];
  const { client, calls } = fixture([{ Status: 3 }, { Status: 1 }, { Status: 1 }], {
    updateTimeoutMs: 100, pollDelayMs: 90,
    signalFactory: ms => { timeouts.push(ms); return new AbortController().signal; },
  });
  client.pendingUpdate = true;
  await client.updateStack(snapshot);
  assert.deepEqual(calls, ['GET', 'GET', 'PUT']);
  assert.deepEqual(timeouts, [100, 10, 10]);
});

for (const failure of [new TypeError('connection reset'), new DOMException('aborted', 'TimeoutError'), new SyntaxError('truncated JSON')]) {
  test(`lost update response (${failure.name}) settles accepted work before rollback`, async () => {
    const { client, calls } = fixture([failure, { Status: 3 }, { Status: 1 }, { Status: 1 }]);
    await assert.rejects(client.updateStack(snapshot));
    await client.updateStack(snapshot);
    assert.deepEqual(calls, ['PUT', 'GET', 'GET', 'PUT']);
  });
}

test('lost update response followed by unreadable status prevents rollback PUT', async () => {
  const { client, calls } = fixture([new TypeError('connection reset'), new Error('offline')]);
  await assert.rejects(client.updateStack(snapshot));
  await assert.rejects(client.updateStack(snapshot), /offline/);
  assert.deepEqual(calls, ['PUT', 'GET']);
});

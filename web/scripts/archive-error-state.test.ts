import assert from 'node:assert/strict';
import { archiveErrorMessage } from '../components/admin/archiveState.ts';

assert.equal(
  archiveErrorMessage({ operation: 'clear', code: 'EACCES' }, 'failed (500)'),
  'archive clear failed (EACCES)',
  'structured root failures keep their safe operation and code',
);
assert.equal(
  archiveErrorMessage('failed to remove 2 archive day directories', 'failed (500)'),
  'failed to remove 2 archive day directories',
  'legacy string failures remain readable',
);
assert.equal(
  archiveErrorMessage({ operation: { hostPath: '/private/archive' }, code: ['EIO'] }, 'failed (500)'),
  'failed (500)',
  'non-scalar structured fields cannot leak through object coercion',
);

console.log('archive-error-state.test.ts: structured archive failures render safe operation and code details');

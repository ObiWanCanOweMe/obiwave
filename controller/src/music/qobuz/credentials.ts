import { createHash } from 'node:crypto';
import { SECRET_BOOT_OVERRIDES } from '../../setup/secrets.js';
import { QOBUZ_CREDENTIAL_FIELDS } from '../../schemas/qobuz.js';
import { accountKeyOf } from './client.js';
import type { QobuzAuthority, QobuzCredentials } from './types.js';
export const QOBUZ_ENV = { appId: 'QOBUZ_APP_ID', appSecret: 'QOBUZ_APP_SECRET', userAuthToken: 'QOBUZ_USER_AUTH_TOKEN', userId: 'QOBUZ_USER_ID' } as const;
let fingerprint = ''; let revision = 0; let verified: string | null = null;
function identify(credentials: QobuzCredentials | null) { return createHash('sha256').update(JSON.stringify(credentials)).digest('hex'); }
export function effectiveQobuzCredentials(): QobuzCredentials | null {
  const values = Object.fromEntries(QOBUZ_CREDENTIAL_FIELDS.map(field => [field, process.env[QOBUZ_ENV[field]] || ''])) as unknown as QobuzCredentials;
  const complete = Object.values(values).every(value => value && !/[\x00-\x1f\x7f]/.test(value));
  const next = identify(complete ? values : null);
  if (next !== fingerprint) { fingerprint = next; revision++; verified = null; }
  return complete ? values : null;
}
export function verifyQobuzAuthority(credentials: QobuzCredentials): QobuzAuthority | null {
  const effective = effectiveQobuzCredentials();
  if (!effective || identify(credentials) !== identify(effective)) return null;
  verified = accountKeyOf(credentials.userId);
  return { accountKey: verified, revision };
}
export function qobuzAuthority(): QobuzAuthority | null {
  effectiveQobuzCredentials();
  return verified ? { accountKey: verified, revision } : null;
}
export function qobuzCredentialStatus() {
  return Object.fromEntries(QOBUZ_CREDENTIAL_FIELDS.map(field => {
    const key = QOBUZ_ENV[field];
    return [field, { present: !!process.env[key], source: SECRET_BOOT_OVERRIDES[key] ? 'environment' : process.env[key] ? 'saved' : 'unset' }];
  })) as Record<keyof QobuzCredentials, { present: boolean; source: 'environment' | 'saved' | 'unset' }>;
}

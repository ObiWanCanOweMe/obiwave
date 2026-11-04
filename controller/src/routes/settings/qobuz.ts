import express from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { QOBUZ_CREDENTIAL_FIELDS, qobuzCredentialPatchSchema } from '../../schemas/qobuz.js';
import { saveSecrets, secretValueIssue, SECRET_BOOT_OVERRIDES } from '../../setup/secrets.js';
import { QOBUZ_ENV, effectiveQobuzCredentials, verifyQobuzAuthority } from '../../music/qobuz/credentials.js';
import { createQobuzClient, accountKeyOf, type QobuzClient } from '../../music/qobuz/client.js';
import { qobuzStatus } from '../../music/qobuz/runtime.js';
import { QobuzError, type QobuzCredentials } from '../../music/qobuz/types.js';
import * as settings from '../../settings.js';
export function createQobuzSettingsRouter(deps: { client?: (credentials: QobuzCredentials) => Pick<QobuzClient, 'testConnection'> } = {}) {
  const router = express.Router();
  router.get('/settings/qobuz', requireAdmin, async (_req, res) => { await settings.load(); res.json(qobuzStatus()); });
  router.post('/settings/qobuz/test', requireAdmin, async (req, res) => {
    const parsed = qobuzCredentialPatchSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.clear?.length) return res.status(400).json({ ok: false, error: 'Invalid credential input' });
    const values = Object.fromEntries(QOBUZ_CREDENTIAL_FIELDS.map(field => [field, parsed.data[field]?.trim() && parsed.data[field] !== 'set' ? parsed.data[field]!.trim() : process.env[QOBUZ_ENV[field]] || ''])) as unknown as QobuzCredentials;
    if (Object.values(values).some(value => !value || secretValueIssue(value))) return res.status(400).json({ ok: false, error: 'Supply all four credentials as single-line values' });
    try {
      const result = await (deps.client ?? createQobuzClient)(values).testConnection();
      if (!result.fullTrackAccess) return res.json({ ok: false, fullTrackAccess: false, error: 'This account does not report full-track streaming access' });
      if (result.accountKey === accountKeyOf(values.userId)) verifyQobuzAuthority(values);
      return res.json({ ok: true, fullTrackAccess: true });
    } catch (error) { return res.json({ ok: false, error: error instanceof QobuzError ? error.message : 'Qobuz connection test failed' }); }
  });
  router.post('/settings/qobuz/credentials', requireAdmin, async (req, res) => {
    const parsed = qobuzCredentialPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid credential input' });
    const patch: Record<string, string> = {};
    for (const field of QOBUZ_CREDENTIAL_FIELDS) {
      const value = parsed.data[field]; const clear = parsed.data.clear?.includes(field);
      if (value !== undefined && secretValueIssue(value)) return res.status(400).json({ error: 'Credential values must be single-line text' });
      if (!clear && (!value?.trim() || value === 'set')) continue;
      const key = QOBUZ_ENV[field];
      if (SECRET_BOOT_OVERRIDES[key]) return res.status(400).json({ error: `${field} is managed by the environment` });
      patch[key] = clear ? '' : value!.trim();
    }
    try {
      await saveSecrets(patch); effectiveQobuzCredentials();
      res.json({ saved: Object.keys(patch).map(key => QOBUZ_CREDENTIAL_FIELDS.find(field => QOBUZ_ENV[field] === key)) });
    } catch { res.status(400).json({ error: 'Could not save Qobuz credentials' }); }
  });
  return router;
}
export const router = createQobuzSettingsRouter();

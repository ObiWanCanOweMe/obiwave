import { z } from 'zod';
export const qobuzPatchSchema = z.object({
  enabled: z.boolean({ error: 'qobuz.enabled must be a boolean' }).optional(),
  cacheMaxGb: z.number({ error: 'qobuz.cacheMaxGb must be a number' }).min(0.25, 'qobuz.cacheMaxGb must be at least 0.25').max(1024, 'qobuz.cacheMaxGb must be at most 1024').optional(),
});
export const QOBUZ_CREDENTIAL_FIELDS = ['appId', 'appSecret', 'userAuthToken', 'userId'] as const;
export const qobuzStatusSchema = z.object({
  enabled: z.boolean(), ready: z.boolean(),
  credentials: z.record(z.enum(QOBUZ_CREDENTIAL_FIELDS), z.object({ present: z.boolean(), source: z.enum(['environment', 'saved', 'unset']) })),
  cache: z.object({ bytes: z.number(), items: z.number() }),
  lastError: z.object({ code: z.string(), at: z.number() }).nullable(),
});
export type QobuzStatus = z.infer<typeof qobuzStatusSchema>;
export const qobuzCredentialPatchSchema = z.object({
  appId: z.string().max(4096).optional(), appSecret: z.string().max(4096).optional(),
  userAuthToken: z.string().max(4096).optional(), userId: z.string().max(4096).optional(),
  clear: z.array(z.enum(QOBUZ_CREDENTIAL_FIELDS)).max(4).optional(),
});
export const qobuzTestResultSchema = z.object({ ok: z.boolean(), fullTrackAccess: z.boolean().optional(), error: z.string().optional() });

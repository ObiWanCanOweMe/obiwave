'use client';
import { useEffect, useRef, useState } from 'react';
import { QOBUZ_CREDENTIAL_FIELDS } from '../../../lib/schemas.generated';
import { fieldAria } from '../../../lib/form';
import type { AdminFetch } from '../../../lib/admin-query';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Card, Btn } from '../ui';
import { SettingsFieldError, type SectionProps } from './shared';
import { useQobuzStatusQuery, useQobuzCredentialCommand } from './queries';
const labels = { appId: 'App ID', appSecret: 'App secret', userAuthToken: 'User auth token', userId: 'User ID' } as const;
const blank = () => ({ appId: '', appSecret: '', userAuthToken: '', userId: '' });
export function QobuzRequestsCard({ form, setForm, fieldErrors, adminFetch }: Pick<SectionProps, 'form' | 'setForm' | 'fieldErrors'> & { adminFetch: AdminFetch }) {
  const status = useQobuzStatusQuery(adminFetch);
  const command = useQobuzCredentialCommand(adminFetch);
  const [fields, setFields] = useState(blank);
  const [feedback, setFeedback] = useState('');
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const execute = async (action: 'test' | 'save', clear?: string[]) => {
    setFeedback('');
    try {
      const result = await command.run(action, clear ? { clear } : fields);
      if (!mounted.current) return;
      if (action === 'save') { setFields(blank()); setFeedback(clear ? 'Saved credential cleared.' : 'Credentials saved.'); }
      else setFeedback(result?.ok ? 'Connection verified. This account reports full-track streaming access; individual recordings may still be unavailable.' : result?.error || 'Connection test failed.');
    } catch (error) { if (mounted.current) setFeedback(error instanceof Error ? error.message : 'Credential command failed.'); }
  };
  const enableAria = fieldAria('qobuz-enabled');
  const budgetError = fieldErrors['qobuz.cacheMaxGb'];
  const budgetAria = fieldAria('qobuz-cacheMaxGb', budgetError ? { message: budgetError } : undefined);
  return <Card title="Qobuz requests" sub="Find requested recordings outside your music library">
    <div className="field">
      <Label {...enableAria.labelProps}><input {...enableAria.controlProps} type="checkbox" checked={form.qobuz.enabled} onChange={event => setForm(f => ({ ...f, qobuz: { ...f.qobuz, enabled: event.target.checked } }))} /> Enable Qobuz requests</Label>
      <p className="field-hint">Checks the library, then the disk cache, then Qobuz for an exact recording. Downloads stay outside your library and expire seven days after download or the latest accepted cache hit. Queued and playing files stay protected.</p>
    </div>
    <div className="field">
      <Label {...budgetAria.labelProps}>Cache limit (GiB)</Label>
      <Input {...budgetAria.controlProps} type="number" min={0.25} max={1024} step={0.25} value={form.qobuz.cacheMaxGb} onChange={event => setForm(f => ({ ...f, qobuz: { ...f.qobuz, cacheMaxGb: event.target.value } }))} />
      <SettingsFieldError path="qobuz.cacheMaxGb" errors={fieldErrors} {...budgetAria.errorProps} />
      <p className="field-hint">Save station settings to apply the enable switch and cache limit.</p>
    </div>
    {status.data && <p className="field-hint">Cache: {status.data.cache.items} recordings, {(status.data.cache.bytes / 1024**2).toFixed(1)} MiB. {status.data.ready ? 'All credential fields configured.' : 'Credentials or cache setup incomplete.'}</p>}
    {status.isError && <p role="status">Could not load Qobuz status.</p>}
    {status.data?.lastError && <p role="status">Recent acquisition: {status.data.lastError.code}.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {QOBUZ_CREDENTIAL_FIELDS.map(field => {
        const aria = fieldAria(`qobuz-${field}`); const info = status.data?.credentials[field]; const locked = info?.source === 'environment';
        return <div className="field" key={field}>
          <Label {...aria.labelProps}>{labels[field]}</Label>
          <Input {...aria.controlProps} type="password" autoComplete="off" spellCheck={false} disabled={locked || command.isPending} value={fields[field]} placeholder={locked ? 'Set through environment' : info?.present ? 'Saved; leave blank to keep' : 'Not configured'} onChange={event => setFields(previous => ({ ...previous, [field]: event.target.value }))} />
          {info?.present && !locked && <Btn type="button" disabled={command.isPending} onClick={() => execute('save', [field])}>Clear {labels[field].toLowerCase()}</Btn>}
        </div>;
      })}
    </div>
    <p className="field-hint">Credentials are saved separately in private secret storage. Blank fields keep saved values. Test connection uses your edits without saving.</p>
    <div className="flex flex-wrap gap-2">
      <Btn type="button" disabled={command.isPending} onClick={() => execute('test')}>Test connection</Btn>
      <Btn type="button" disabled={command.isPending} onClick={() => execute('save')}>Save credentials</Btn>
    </div>
    {feedback && <p role="status">{feedback}</p>}
  </Card>;
}

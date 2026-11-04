// Signing/API conventions adapted from QBZ-Downloader (MIT). See THIRD_PARTY_NOTICES.md.
import { createHash } from 'node:crypto';
import { publicHttps, readBounded, abortable, type HttpTransport } from './http.js';
import { QobuzError, type QobuzCredentials, type QobuzTrack } from './types.js';
export function accountKeyOf(userId: string): string { return createHash('sha256').update(userId).digest('hex'); }
export function createQobuzClient(credentials: QobuzCredentials, deps: { transport?: HttpTransport; now?: () => number; timeoutMs?: number } = {}) {
  const transport = deps.transport ?? publicHttps;
  async function call(endpoint: string, params: Record<string, string>, caller?: AbortSignal): Promise<Record<string, any>> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), Math.min(deps.timeoutMs ?? 15_000, 15_000));
    const signal = AbortSignal.any([deadline.signal, ...(caller ? [caller] : [])]);
    const url = new URL(`https://www.qobuz.com/api.json/0.2/${endpoint}`);
    for (const [key, value] of Object.entries({ ...params, app_id: credentials.appId, user_auth_token: credentials.userAuthToken })) url.searchParams.set(key, value);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        signal.throwIfAborted();
        const response = await abortable(transport(url, signal), signal);
        const body = await abortable(readBounded(response.body, 2 * 1024 * 1024, signal), signal);
        if (response.status === 401 || response.status === 403) throw new QobuzError('unauthorized');
        if ((response.status === 429 || response.status >= 500) && attempt === 0) continue;
        if (response.status !== 200) throw new QobuzError('provider unavailable');
        const data = JSON.parse(body.toString('utf8'));
        if (!data || typeof data !== 'object' || data.status === 'error') throw new QobuzError('invalid provider response');
        return data;
      }
    } catch (error) {
      if (error instanceof QobuzError) throw error;
      throw new QobuzError(signal.aborted ? 'request cancelled or timed out' : 'invalid provider response');
    } finally { clearTimeout(timer); }
    throw new QobuzError('provider unavailable');
  }
  return {
    async testConnection(signal?: AbortSignal) {
      const user = await call('user/get', { user_id: credentials.userId }, signal);
      if (String(user.id) !== credentials.userId) throw new QobuzError('account mismatch');
      const params = user.credential?.parameters;
      return { accountKey: accountKeyOf(credentials.userId), fullTrackAccess: params?.lossless_streaming === true || params?.hires_streaming === true };
    },
    async search(query: string, signal?: AbortSignal): Promise<QobuzTrack[]> {
      const data = await call('catalog/search', { query: query.slice(0, 512), type: 'tracks', limit: '50', offset: '0' }, signal);
      if (!Array.isArray(data.tracks?.items)) throw new QobuzError('invalid search response');
      return data.tracks.items.slice(0, 50).flatMap((track: any) => {
        const artist = track.performer?.name || track.album?.artist?.name;
        if (!/^\d+$/.test(String(track.id)) || typeof track.title !== 'string' || !track.title.trim() || typeof artist !== 'string' || !artist.trim() || !Number.isFinite(track.duration) || track.duration <= 0 || track.streamable === false) return [];
        return [{ id: String(track.id), title: track.title.slice(0, 512), artist: artist.slice(0, 512), album: String(track.album?.title || '').slice(0, 512), duration: track.duration, explicit: track.parental_warning === true, ...(typeof track.isrc === 'string' ? { isrc: track.isrc } : {}), ...(typeof track.album?.image?.large === 'string' ? { artworkUrl: track.album.image.large } : {}) }];
      });
    },
    async fileUrl(trackId: string, signal?: AbortSignal) {
      if (!/^\d{1,20}$/.test(trackId)) throw new QobuzError('invalid track');
      const params = { format_id: '6', intent: 'stream', track_id: trackId };
      const timestamp = String(Math.floor((deps.now ?? Date.now)() / 1000));
      const base = 'trackgetFileUrl' + Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + value).join('') + timestamp + credentials.appSecret;
      const data = await call('track/getFileUrl', { ...params, request_ts: timestamp, request_sig: createHash('md5').update(base).digest('hex') }, signal);
      if (data.sample || !Number.isFinite(data.duration) || data.duration <= 30 || typeof data.url !== 'string') throw new QobuzError('preview or unavailable recording');
      return { url: data.url as string, sample: false, duration: data.duration as number };
    },
  };
}
export type QobuzClient = ReturnType<typeof createQobuzClient>;

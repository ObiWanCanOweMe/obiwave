// Public HTTPS only. DNS answers are checked by the socket's own lookup callback,
// eliminating the gap between a preflight DNS check and a second resolution.
import https from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { QobuzError } from './types.js';
export interface HttpResponse { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Buffer> }
export type HttpTransport = (url: URL, signal: AbortSignal) => Promise<HttpResponse>;
const denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) denied.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
const deniedV6 = new BlockList(); deniedV6.addSubnet('2001:db8::', 32, 'ipv6'); deniedV6.addSubnet('2001::', 32, 'ipv6'); deniedV6.addSubnet('2002::', 16, 'ipv6');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !denied.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6');
}
export function validateMediaUrl(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || (isIP(host) && !isPublicAddress(host))) throw new QobuzError('unsafe destination');
}
export const publicHttps: HttpTransport = async (url, signal) => {
  validateMediaUrl(url);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      signal, agent: false, headers: { 'User-Agent': 'SUB-WAVE/1 Qobuz requests' },
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true, verbatim: true }, (error, records) => {
          if (error || !records.length || records.some(record => !isPublicAddress(record.address))) {
            callback(new QobuzError('unsafe destination'), []); return;
          }
          callback(null, options.all ? records : records[0].address, records[0].family);
        });
      },
    }, response => resolve({ status: response.statusCode || 0, headers: response.headers, body: response }));
    request.on('error', () => reject(new QobuzError(signal.aborted ? 'request cancelled or timed out' : 'network unavailable')));
  });
};
export async function openPublicResource(url: URL, signal: AbortSignal, transport: HttpTransport = publicHttps): Promise<HttpResponse> {
  for (let redirects = 0; ; redirects++) {
    validateMediaUrl(url); signal.throwIfAborted();
    const response = await transport(url, signal);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    // Close the old body before opening another connection.
    await response.body[Symbol.asyncIterator]().return?.();
    const location = response.headers.location;
    if (redirects >= 3 || typeof location !== 'string') throw new QobuzError('redirect refused');
    url = new URL(location, url);
  }
}
export async function readBounded(body: AsyncIterable<Buffer>, limit: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of body) {
    signal.throwIfAborted(); bytes += chunk.length;
    if (bytes > limit) throw new QobuzError('response too large');
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks);
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new QobuzError('request cancelled or timed out'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

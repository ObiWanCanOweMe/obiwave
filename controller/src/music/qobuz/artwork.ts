import { openPublicResource, readBounded, type HttpTransport } from './http.js';
export interface QobuzArtwork { bytes: Buffer; contentType: string }
export function rasterArtwork(bytes: Buffer): QobuzArtwork | null {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) return null;
  const contentType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg'
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  return contentType ? { bytes, contentType } : null;
}
export async function fetchQobuzArtwork(url: string, caller?: AbortSignal, transport?: HttpTransport): Promise<QobuzArtwork | null> {
  const signal = AbortSignal.any([AbortSignal.timeout(5000), ...(caller ? [caller] : [])]);
  const response = await openPublicResource(new URL(url), signal, transport);
  if (response.status !== 200) return null;
  return rasterArtwork(await readBounded(response.body, 2 * 1024 * 1024, signal));
}

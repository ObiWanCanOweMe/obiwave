#!/usr/bin/env node
// Read Docker's archive HEAD metadata only; never download settings or log credentials.
import { fileURLToPath } from 'node:url';

export async function verifyMainSettingsMode({ baseUrl, apiKey, endpointId, fetchImpl = fetch }) {
  if (!baseUrl || !apiKey || !endpointId) throw new Error('Portainer verification configuration is missing');
  const base = `${baseUrl.replace(/\/$/, '')}/api/endpoints/${encodeURIComponent(endpointId)}/docker`;
  const headers = { 'X-API-Key': apiKey };
  const listing = await fetchImpl(`${base}/containers/json`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!listing.ok) throw new Error('Controller metadata request failed');
  const containers = await listing.json();
  const controller = Array.isArray(containers) && containers.find(c => c?.Names?.includes('/sub-wave-controller'));
  if (!controller?.Id) throw new Error('Production controller is missing');
  const path = '/var/sub-wave/stations/main/settings.json';
  const response = await fetchImpl(`${base}/containers/${encodeURIComponent(controller.Id)}/archive?path=${encodeURIComponent(path)}`, {
    method: 'HEAD', headers, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Main settings metadata request failed');
  let stat;
  try {
    const encoded = response.headers.get('X-Docker-Container-Path-Stat');
    if (encoded) stat = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch { /* Report only fixed text, never a response or a decoded header. */ }
  if (!Number.isInteger(stat?.mode)) throw new Error('Main settings metadata is missing or invalid');
  if (stat.linkTarget || stat.mode !== 0o644) throw new Error('Main station settings permissions must be 0644');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await verifyMainSettingsMode({ baseUrl: process.env.PORTAINER_URL, apiKey: process.env.PORTAINER_API_KEY, endpointId: process.env.PORTAINER_ENDPOINT_ID });
    console.log('Verified main station settings mode: 0644');
  } catch {
    console.error('Production main station settings permission verification failed');
    process.exitCode = 1;
  }
}

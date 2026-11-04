// Explicit live check. Not discovered by npm test and never queues station audio.
import { readFile, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'dotenv';
import { createQobuzClient } from '../src/music/qobuz/client.js';
import { createQobuzCache } from '../src/music/qobuz/cache.js';
import { createQobuzService } from '../src/music/qobuz/service.js';
import { modelFreeRequest } from '../src/music/request-match.js';
import { QobuzError, type QobuzCredentials } from '../src/music/qobuz/types.js';
const arg = (key: string) => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index + 1] : undefined; };
let stage = 'arguments'; let ownedCache: string | null = null;
try {
  const fileArg = arg('--credentials-file'); const stateArg = arg('--state-dir'); const query = arg('--query');
  if (!fileArg || !stateArg || !query) throw new QobuzError('usage: --credentials-file PATH --state-dir EMPTY_TEMP_DIR --query "Song by Artist"');
  const file = resolve(fileArg); const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new QobuzError('credentials file must be a private regular file (0600)');
  const vars = parse(await readFile(file));
  const credentials: QobuzCredentials = { appId: vars.QOBUZ_APP_ID, appSecret: vars.QOBUZ_APP_SECRET, userAuthToken: vars.QOBUZ_USER_AUTH_TOKEN, userId: vars.QOBUZ_USER_ID };
  if (Object.values(credentials).some(v => !v || /[\x00-\x1f\x7f]/.test(v))) throw new QobuzError('credentials missing or invalid');
  const state = resolve(stateArg); await mkdir(state, { recursive: true, mode: 0o700 });
  const canonical = await realpath(state); const temp = await realpath(tmpdir()); const rel = relative(temp, canonical);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || (await readdir(state)).length) throw new QobuzError('state-dir must be an empty directory beneath the system temporary directory');
  const match = modelFreeRequest(query);
  if (arg('--album')) match.album = arg('--album');
  if (!match.title || !match.artist || match.reversible) throw new QobuzError('query must name one recording as Song by Artist');
  stage = 'account'; const client = createQobuzClient(credentials); const verified = await client.testConnection();
  if (!verified.fullTrackAccess) throw new QobuzError('account does not report full-track access');
  console.log('account: authenticated; full-track access reported');
  let clock = Date.now(); let searches = 0; let fileUrls = 0;
  ownedCache = join(state, 'qobuz-cache');
  const cache = createQobuzCache({ root: ownedCache, now: () => clock, references: () => [], capacityBytes: () => 1024**3 }); await cache.load();
  const authority = { accountKey: verified.accountKey, revision: 1 };
  const service = createQobuzService({ cache, enabled: () => true, credentials: () => credentials, authority: () => authority, verify: () => authority, allowed: () => true, client: () => ({ ...client, search: (...args) => { searches++; return client.search(...args); }, fileUrl: (...args) => { fileUrls++; return client.fileUrl(...args); } }) });
  stage = 'search/download/decode'; const acquired = await service.acquire(match);
  if (!acquired) throw new QobuzError('no unambiguous exact recording');
  const ref = acquired.track.providerRef; acquired.release();
  console.log('recording: exact match downloaded and complete CD FLAC validated');
  const before = { searches, fileUrls }; clock += 60_000; stage = 'cache reuse';
  const hit = await service.acquire(match); if (!hit) throw new QobuzError('cache hit missing');
  await hit.accepted(clock); hit.release();
  if (searches !== before.searches || fileUrls !== before.fileUrls) throw new QobuzError('cache hit unexpectedly called provider');
  const manifest = JSON.parse(await readFile(join(ownedCache, 'index.json'), 'utf8'));
  if (manifest.entries.find((e: { generation: string }) => e.generation === ref.generation)?.expiresAt !== clock + 604800000) throw new QobuzError('sliding expiry did not renew');
  console.log('cache: reused without provider search/file URL; seven-day deadline renewed');
  clock += 604800000 + 120001; await cache.cleanup();
  if (await cache.resolve(ref)) throw new QobuzError('expired audio was not deleted');
  console.log('cleanup: expired audio deleted; no library or broadcast changes');
} catch (error) {
  console.error(`${stage}: ${error instanceof QobuzError ? error.message : 'Qobuz smoke check failed (details withheld)'}`);
  process.exitCode = 1;
} finally {
  if (ownedCache) await rm(ownedCache, { recursive: true, force: true });
}

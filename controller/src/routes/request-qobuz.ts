// External request admission, sharing queue safety and ordinary intro generation.
import * as settings from '../settings.js';
import { qobuzService } from '../music/qobuz/runtime.js';
import type { QobuzService } from '../music/qobuz/service.js';
import type { CachedTrack, QobuzTrack } from '../music/qobuz/types.js';
import type { RequestMatch } from '../music/request-match.js';
import type { QueueApi } from '../broadcast/queue.js';
import { generateQueuedRequestIntro } from '../broadcast/request-intro.js';
import { sorryNoMatch } from '../util/request-guard.js';
import { heldBackFromShow } from '../music/explicit-policy.js';
import * as blocklist from '../music/blocklist.js';
export type QobuzRequestResult = { kind: 'continue' } | { kind: 'queued'; track: CachedTrack; queuePosition: number; introScript: string | null } | { kind: 'refused'; message: string; outcome?: string };
export async function tryQobuzRequest({ match, text, requester, context, queue, service = qobuzService, now = Date.now }: { match: RequestMatch; text: string; requester: string; context: Record<string, unknown>; queue: QueueApi; service?: QobuzService; now?: () => number }): Promise<QobuzRequestResult> {
  let refusal: QobuzRequestResult | null = null;
  const guard = (candidate: QobuzTrack) => {
    const id = candidate.id.startsWith('qobuz:') ? candidate.id : `qobuz:${candidate.id}`;
    if (queue.queuedIds().has(id) || queue.current?.track?.id === id) {
      refusal = { kind: 'refused', message: queue.dedupAck(id), outcome: 'already-queued' }; throw Error('request refused');
    }
    const minutes = settings.get().requests.repeatCooldownMin ?? 120;
    if (minutes > 0 && queue.recentlyPlayedIds(minutes / 60).has(id)) {
      refusal = { kind: 'refused', message: queue.cooldownAck(id, candidate.title), outcome: 'cooldown' }; throw Error('request refused');
    }
    const track = { ...candidate, id, explicitStatus: candidate.explicit ? 'explicit' : 'clean' };
    if (blocklist.hitOf(track) || heldBackFromShow(track, settings.resolveActiveShow())) {
      refusal = { kind: 'refused', message: sorryNoMatch(requester) }; throw Error('request refused');
    }
  };
  let lease;
  try { lease = await service.acquire(match, undefined, guard); }
  catch { return refusal ?? { kind: 'continue' }; }
  if (!lease) return { kind: 'continue' };
  const authority = lease.authority;
  try {
    const generated = await generateQueuedRequestIntro({ track: lease.track, context, requestedBy: requester, recap: queue.getDjRecap(), recentTracks: queue.getRecentTracks(), recentOpeners: queue.getRecentOpeners() }, text);
    if (settings.get().qobuz?.enabled !== true || !service.stillValid(authority)) return { kind: 'continue' };
    guard(lease.track);
    const position = await queue.push({ track: lease.track, requestedBy: requester, intent: match.intent, ...generated, introKind: 'dj-speak' });
    if (position < 0) return { kind: 'refused', message: position === -1 ? queue.dedupAck(lease.track.id) : sorryNoMatch(requester), outcome: position === -1 ? 'already-queued' : 'no-match' };
    // Playback is committed even if the nonfatal manifest renewal fails.
    try { await lease.accepted(now()); } catch { queue.log?.('error', 'Qobuz cache expiry renewal failed; queued audio remains protected'); }
    return { kind: 'queued', track: lease.track, queuePosition: position, introScript: generated.introScript };
  } catch { return refusal ?? { kind: 'continue' }; }
  finally { lease.release(); }
}

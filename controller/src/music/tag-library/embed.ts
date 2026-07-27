// Phase 1 - embedding. Turns each track's metadata and enrichment into the
// text vector the picker's similarity search runs over.
//
// Part of the tag-library/ split - see ../tag-library.ts for main().

import * as db from '../library-db.js';
import * as embeddings from '../embeddings.js';
import {
  bulkEmbeddingBatchSize,
  bulkEmbeddingFailureMessage,
  commitBulkEmbeddingBatch,
  withBulkEmbeddingRateLimit,
} from '../embedding-bulk.js';
import { reportProgress } from '../tagger-progress.js';
import { logEvent } from './log.js';


// ---------------------------------------------------------------------------
// Phase 1 — Embed
// ---------------------------------------------------------------------------

export async function phaseEmbed(
  targetIds: string[],
  batchSize: number,
  // The index's task-prefix mode (resolved once in run()) — every document
  // this phase writes must match the vectors already in the index.
  textMode: embeddings.IndexTextMode,
): Promise<void> {
  // Embed any track in scope that doesn't already have a vector. Includes
  // already-tagged tracks (legacy v1) so they can serve as KNN neighbours.
  const needsEmbed: string[] = [];
  for (const id of targetIds) {
    if (!db.hasVector(id)) needsEmbed.push(id);
  }
  // Also embed all already-tagged tracks that don't have vectors yet (legacy
  // v1 imports). Without this they can't anchor the KNN graph.
  for (const id of db.allTaggedIds()) {
    if (!db.hasVector(id)) needsEmbed.push(id);
  }
  // Dedup
  const unique = [...new Set(needsEmbed)];
  if (unique.length === 0) {
    console.log('[tag] phase-1 nothing to embed');
    return;
  }
  logEvent('info', `Building similarity vectors for ${unique.length.toLocaleString('en-GB')} tracks…`);
  reportProgress({ phase: 'embed', label: 'Embedding tracks', done: 0, total: unique.length });

  const local = embeddings.embeddingPerfAdvisory().local;
  const embedBatchSize = bulkEmbeddingBatchSize(batchSize, local);
  for (let i = 0; i < unique.length; i += embedBatchSize) {
    const batch = unique.slice(i, i + embedBatchSize);
    const songs = batch.map(id => db.getTrack(id)).filter((t): t is db.TrackRecord => !!t);
    const texts = songs.map(t =>
      embeddings.formatTrackText(
        { title: t.title, artist: t.artist, album: t.album, year: t.year, genres: t.genres },
        { lastfmTags: t.lastfmTags, lyricExcerpt: t.lyricExcerpt },
      ),
    );
    let vecs: number[][];
    try {
      vecs = await withBulkEmbeddingRateLimit(
        () => embeddings.embedDocTexts(texts, textMode, { maxRetries: 0 }),
        {
          onWait: ({ seconds, attempt }) =>
            logEvent('info', `Embedding rate limit — waiting ${seconds}s (attempt ${attempt})`),
        },
      );
    } catch (err) {
      const message = bulkEmbeddingFailureMessage(err);
      logEvent('error', message);
      throw new Error(message);
    }
    commitBulkEmbeddingBatch({
      result: vecs,
      commit: vecs => {
        for (let j = 0; j < songs.length; j++) db.upsertTrackVector(songs[j].id, vecs[j]);
      },
      onCommitted: () => {
        reportProgress({
          phase: 'embed',
          label: 'Embedding tracks',
          done: Math.min(i + batch.length, unique.length),
          total: unique.length,
        });
      },
    });
  }
}

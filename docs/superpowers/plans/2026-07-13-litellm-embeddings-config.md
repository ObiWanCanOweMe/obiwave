# LiteLLM Embeddings Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route SUB/WAVE text embeddings through the existing LiteLLM gateway with `cohere.embed-english-v3`, then rebuild the complete vector index and tag the remaining library tracks.

**Architecture:** Keep `litellm:gemini-3-flash-no-reasoning` as the independent DJ chat leg. Configure embeddings through the existing `openai-compatible` embedding transport, validate the saved gateway configuration before touching the index, then launch the supported unlimited `reseed + thenTag` background run.

**Tech Stack:** SUB/WAVE controller settings API, Vercel AI SDK OpenAI-compatible embedding transport, LiteLLM `/embeddings`, SQLite vector index, Docker Compose production stack.

## Global Constraints

- Keep DJ chat configured as `litellm:gemini-3-flash-no-reasoning`.
- Configure embeddings as `openai-compatible:cohere.embed-english-v3` using the existing LiteLLM API base and key from the root `.env`.
- Never print, place in a URL, or log the LiteLLM token; public settings must expose only the masked value `set`.
- Require a successful embedding probe reporting exactly 1024 dimensions before starting the reseed.
- Do not start a limited reseed; the complete library must use one vector model and dimension.
- Preserve existing mood/energy tags and do not rerun acoustic analysis.
- Keep the broadcast, DJ session, Odin analyzer, and failed Odin `:8090` embedding service otherwise unchanged.
- On failed preflight, restore the previous embedding settings and do not modify the vector index.

---

### Task 1: Save and prove the LiteLLM embedding configuration

**Files:**
- Read: `.env`
- Read: `state/settings.json`
- Modify through API: `state/settings.json` (`settings.embedding` only)
- Verify through API: `controller/src/routes/settings.ts` (`POST /settings`, `GET /settings/embedding/probe`)

**Interfaces:**
- Consumes: root `.env` variables `ADMIN_USER`, `ADMIN_PASS`, and `LITELLM_API_BASE` / `LITELLM_API_KEY` with `OPENAI_API_BASE` / `OPENAI_API_KEY` fallbacks.
- Produces: saved embedding configuration `{ provider: "openai-compatible", model: "cohere.embed-english-v3", baseUrl, apiKey }` and a successful `{ ok: true, dim: 1024 }` probe.

- [ ] **Step 1: Capture the current non-public rollback values without printing them**

Run in the repository root in one persistent shell:

```bash
set -a
. ./.env
set +a

ADMIN_AUTH="$ADMIN_USER:$ADMIN_PASS"
LITE_BASE="${LITELLM_API_BASE:-${OPENAI_API_BASE:-}}"
LITE_KEY="${LITELLM_API_KEY:-${OPENAI_API_KEY:-}}"

OLD_EMBED_PROVIDER=$(jq -r '.embedding.provider // ""' state/settings.json)
OLD_EMBED_MODEL=$(jq -r '.embedding.model // ""' state/settings.json)
OLD_EMBED_BASE=$(jq -r '.embedding.baseUrl // ""' state/settings.json)
OLD_EMBED_OLLAMA=$(jq -r '.embedding.ollamaUrl // ""' state/settings.json)
OLD_EMBED_KEY=$(jq -r '.embedding.apiKey // ""' state/settings.json)

test -n "$LITE_BASE"
test -n "$LITE_KEY"
```

Expected: exit `0` with no secret values written to stdout.

- [ ] **Step 2: Record the current vector-index boundary**

Run:

```bash
curl -fsS --max-time 10 -u "$ADMIN_AUTH" \
  http://localhost:7700/api/library/coverage \
  | jq '{tagged,total,embeddedModel,embeddedDim,currentEmbeddingModel,embeddingStale}'
```

Expected before migration: `embeddedModel` is `openai-compatible:nomic-embed-text:latest`, `embeddedDim` is `768`, and `embeddingStale` is `false`.

- [ ] **Step 3: Save the new embedding leg without altering chat settings**

Run:

```bash
payload=$(jq -n \
  --arg provider 'openai-compatible' \
  --arg model 'cohere.embed-english-v3' \
  --arg baseUrl "$LITE_BASE" \
  --arg apiKey "$LITE_KEY" \
  '{embedding:{provider:$provider,model:$model,baseUrl:$baseUrl,ollamaUrl:"",apiKey:$apiKey}}')

curl -fsS --max-time 15 -u "$ADMIN_AUTH" \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:7700/api/settings \
  --data-binary "$payload" \
  | jq -e '.requiresRestart == false'

unset payload
```

Expected: `true`. The response must not contain `saved`, `apiKey`, or the token.

- [ ] **Step 4: Run the saved-config preflight**

Run:

```bash
probe=$(curl -fsS --max-time 30 -u "$ADMIN_AUTH" \
  http://localhost:7700/api/settings/embedding/probe)
printf '%s\n' "$probe" | jq '{ok,dim,code,message}'
printf '%s\n' "$probe" | jq -e '.ok == true and .dim == 1024'
```

Expected: exit `0` and `{ "ok": true, "dim": 1024, "code": "ok" }`.

- [ ] **Step 5: Roll back automatically if the preflight gate fails**

Run only if Step 4's assertion fails:

```bash
rollback=$(jq -n \
  --arg provider "$OLD_EMBED_PROVIDER" \
  --arg model "$OLD_EMBED_MODEL" \
  --arg baseUrl "$OLD_EMBED_BASE" \
  --arg ollamaUrl "$OLD_EMBED_OLLAMA" \
  --arg apiKey "$OLD_EMBED_KEY" \
  '{embedding:{provider:$provider,model:$model,baseUrl:$baseUrl,ollamaUrl:$ollamaUrl,apiKey:$apiKey}}')

curl -fsS --max-time 15 -u "$ADMIN_AUTH" \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:7700/api/settings \
  --data-binary "$rollback" \
  | jq -e '.requiresRestart == false'

unset rollback probe LITE_KEY OLD_EMBED_KEY
exit 1
```

Expected: previous settings restored, vector index still at its original model/dimension, and execution stops before Task 2.

- [ ] **Step 6: Verify masked settings and unchanged chat configuration**

Run:

```bash
curl -fsS --max-time 10 -u "$ADMIN_AUTH" \
  http://localhost:7700/api/settings \
  | jq -e '
      .values.llm.provider == "litellm" and
      .values.llm.model == "gemini-3-flash-no-reasoning" and
      .values.embedding.provider == "openai-compatible" and
      .values.embedding.model == "cohere.embed-english-v3" and
      .values.embedding.apiKey == "set"
    '
```

Expected: `true`.

### Task 2: Rebuild the complete embedding index and continue tagging

**Files:**
- Modify through API: `state/library.db` text-vector index and embedding metadata
- Preserve: existing mood/energy tag rows and acoustic-analysis columns
- Observe: `state/logs/events-*.jsonl`, controller tagger status, stream health

**Interfaces:**
- Consumes: Task 1's proven 1024-dimensional saved embedding configuration.
- Produces: a background tagger run started with `{ reseed: true, thenTag: true }`, ultimately recording `openai-compatible:cohere.embed-english-v3` at 1024 dimensions and processing remaining untagged tracks.

- [ ] **Step 1: Confirm no tagger/analyzer run currently owns the single-flight slot**

Run:

```bash
curl -fsS --max-time 10 -u "$ADMIN_AUTH" \
  http://localhost:7700/api/library/tagger \
  | jq -e '.tagger.running == false'
```

Expected: `true`.

- [ ] **Step 2: Start the supported unlimited reseed and forward tag pass**

Run:

```bash
curl -fsS --max-time 15 -u "$ADMIN_AUTH" \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:7700/api/tag-library \
  --data-binary '{"reseed":true,"thenTag":true}' \
  | jq -e '.ok == true and .tagger.running == true'
```

Expected: `true`. The body deliberately contains no `limit`, `reEnrich`, `reAnalyze`, or acoustic-analysis flag.

- [ ] **Step 3: Prove the tagger entered re-embedding instead of failing preflight**

Run for up to 60 seconds:

```bash
for i in $(seq 1 12); do
  snapshot=$(curl -fsS --max-time 10 -u "$ADMIN_AUTH" \
    http://localhost:7700/api/library/tagger)
  printf '%s\n' "$snapshot" | jq '{running:.tagger.running,mode:.tagger.mode,progress:.tagger.progress,lastLog:.tagger.lastLog[-3:]}'
  if printf '%s\n' "$snapshot" | jq -e '(.tagger.running == false and .tagger.lastRun.outcome == "failed") or (.tagger.lastLog | tostring | test("preflight failed"; "i"))' >/dev/null; then
    exit 1
  fi
  if printf '%s\n' "$snapshot" | jq -e '.tagger.running == true and (.tagger.progress != null or (.tagger.lastLog | length) > 0)' >/dev/null; then
    break
  fi
  sleep 5
done
```

Expected: `running: true` with re-embedding progress/log output and no preflight failure.

- [ ] **Step 4: Verify the broadcast remains healthy during the background run**

Run:

```bash
.claude/skills/subwave-deploy/scripts/health-check.sh
```

Expected: containers running, `/api/health` reports `on-air`, and the audio probe reports a non-silent mean volume above the script's `-50 dB` failure threshold. A recovered LLM fallback message may make the script's log scan nonzero; verify that playback and queuing continued before treating it as a deployment failure.

- [ ] **Step 5: Monitor the long-running job to a terminal state**

Poll no faster than every 30 seconds and report meaningful phase/progress changes:

```bash
while true; do
  snapshot=$(curl -fsS --max-time 10 -u "$ADMIN_AUTH" \
    http://localhost:7700/api/library/tagger)
  printf '%s\n' "$snapshot" | jq '{running:.tagger.running,mode:.tagger.mode,progress:.tagger.progress,lastRun:.tagger.lastRun,lastLog:.tagger.lastLog[-3:]}'
  running=$(printf '%s\n' "$snapshot" | jq -r '.tagger.running')
  [ "$running" = true ] || break
  sleep 30
done
```

Expected: the run eventually reaches `lastRun.outcome == "completed"`. If it reaches `failed`, stop and report the exact phase/error; do not automatically launch another reseed.

- [ ] **Step 6: Verify the completed index and library state**

Run after completion:

```bash
curl -fsS --max-time 10 -u "$ADMIN_AUTH" \
  http://localhost:7700/api/library/coverage \
  | jq -e '
      .embeddedModel == "openai-compatible:cohere.embed-english-v3" and
      .embeddedDim == 1024 and
      .currentEmbeddingModel == "openai-compatible:cohere.embed-english-v3" and
      .embeddingStale == false
    '
```

Expected: `true`. Report final `tagged`, `total`, vector model/dimension, run duration, and stream health.

- [ ] **Step 7: Clear sensitive shell variables**

Run:

```bash
unset LITE_KEY OLD_EMBED_KEY ADMIN_AUTH probe snapshot
```

Expected: shell contains no retained API or admin credential variables.

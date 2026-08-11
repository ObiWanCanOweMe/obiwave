#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseForkTag } from '../release/fork-tag.mjs';
import { loadImageDigestRecord } from '../release/image-digest-record.mjs';
import {
  DeploymentRolledBackError,
  PortainerClient,
  RollbackIncidentError,
  deployWithRollback,
} from './portainer-client.mjs';

const REQUIRED_ENV = [
  'PORTAINER_URL',
  'PORTAINER_API_KEY',
  'PORTAINER_STACK_ID',
  'PORTAINER_ENDPOINT_ID',
  'SUBWAVE_RELEASE_TAG',
  'SUBWAVE_HEALTH_URL',
  'SUBWAVE_STREAM_URL',
];
const MANIFEST_URL = new URL('../../deploy/portainer/docker-compose.yml', import.meta.url);
const TTS_IMAGE = 'subwave-tts-heavy-cuda';
const TTS_IMAGE_REPOSITORY = `ghcr.io/obiwancanoweme/${TTS_IMAGE}`;

function releaseConfig(env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required release configuration: ${missing.join(', ')}`);
  }
  const release = parseForkTag(env.SUBWAVE_RELEASE_TAG);
  if (release.revision >= 2 && !env.SUBWAVE_TTS_DIGEST_DIRECTORY?.trim()) {
    throw new Error('Missing required release configuration: SUBWAVE_TTS_DIGEST_DIRECTORY');
  }
  return {
    ...Object.fromEntries(REQUIRED_ENV.map((name) => [name, env[name]])),
    SUBWAVE_STREAM_PASSWORD: env.SUBWAVE_STREAM_PASSWORD || undefined,
    SUBWAVE_TTS_DIGEST_DIRECTORY: env.SUBWAVE_TTS_DIGEST_DIRECTORY || undefined,
  };
}

function displayVersion(value) {
  if (!value) return '(not set or unrecognized)';
  try {
    parseForkTag(value);
    return value;
  } catch {
    return '(not set or unrecognized)';
  }
}

function sanitizedFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const safeMessage = /^(?:Portainer [a-z][a-z ]{0,40} failed with HTTP [1-5][0-9]{2}|Portainer [a-z][a-z ]{0,40} timed out after [1-9][0-9]{0,8}ms)$/;
  if (safeMessage.test(message)) return message;

  const safeNames = new Set([
    'DeploymentVerificationError',
    'Error',
    'PortainerRequestTimeoutError',
  ]);
  const name = safeNames.has(error?.name) ? error.name : 'Unknown failure';
  return `${name} (details redacted)`;
}

export async function runRelease({
  env = process.env,
  readFile: readFileImpl = readFile,
  appendFile: appendFileImpl = appendFile,
  clientFactory = (options) => new PortainerClient(options),
  deploy = deployWithRollback,
  log = console.log,
} = {}) {
  const config = releaseConfig(env);
  const manifest = await readFileImpl(MANIFEST_URL, 'utf8');
  const ttsDigestRecord = config.SUBWAVE_TTS_DIGEST_DIRECTORY
    ? await loadImageDigestRecord({
      directory: config.SUBWAVE_TTS_DIGEST_DIRECTORY,
      expectedImage: TTS_IMAGE,
      expectedTagRef: `${TTS_IMAGE_REPOSITORY}:${config.SUBWAVE_RELEASE_TAG}`,
    })
    : undefined;
  const client = clientFactory({
    baseUrl: config.PORTAINER_URL,
    apiKey: config.PORTAINER_API_KEY,
    stackId: config.PORTAINER_STACK_ID,
    endpointId: config.PORTAINER_ENDPOINT_ID,
  });

  log(`Deploying SUB/WAVE ${config.SUBWAVE_RELEASE_TAG}`);
  let result;
  try {
    result = await deploy({
      client,
      manifest,
      targetVersion: config.SUBWAVE_RELEASE_TAG,
      healthUrl: config.SUBWAVE_HEALTH_URL,
      streamUrl: config.SUBWAVE_STREAM_URL,
      streamPassword: config.SUBWAVE_STREAM_PASSWORD,
      expectedTtsDigest: ttsDigestRecord?.digest,
    });
  } catch (error) {
    if (error instanceof DeploymentRolledBackError) {
      const previous = displayVersion(error.previousVersion);
      log(`Target version: ${error.targetVersion}; restored previous version: ${previous}; rollback verified.`);
      if (env.GITHUB_STEP_SUMMARY) {
        await appendFileImpl(
          env.GITHUB_STEP_SUMMARY,
          `## Portainer deployment failed safely\n\n- Target version: \`${error.targetVersion}\`\n- Restored previous version: \`${previous}\`\n- Status: **Target failed; rollback verified**\n`,
          'utf8',
        );
      }
    } else if (error instanceof RollbackIncidentError) {
      const previous = displayVersion(error.previousVersion);
      log(`Target version: ${error.targetVersion}; previous version: ${previous}; ROLLBACK FAILED OR UNVERIFIED.`);
      const [deploymentError, rollbackError] = error.cause instanceof AggregateError
        ? error.cause.errors
        : [];
      log(`Target failure: ${sanitizedFailure(deploymentError)}`);
      log(`Rollback failure: ${sanitizedFailure(rollbackError)}`);
      if (env.GITHUB_STEP_SUMMARY) {
        await appendFileImpl(
          env.GITHUB_STEP_SUMMARY,
          `## Portainer rollback incident\n\n- Target version: \`${error.targetVersion}\`\n- Previous version: \`${previous}\`\n- Status: **ROLLBACK FAILED OR UNVERIFIED**\n- Action: operator intervention required; inspect Portainer directly.\n`,
          'utf8',
        );
      }
    }
    throw error;
  }
  log(`Verified SUB/WAVE ${result.targetVersion}`);

  if (env.GITHUB_STEP_SUMMARY) {
    const previous = displayVersion(result.previousVersion);
    await appendFileImpl(
      env.GITHUB_STEP_SUMMARY,
      `## Portainer deployment\n\n- Target version: \`${result.targetVersion}\`\n- Previous version: \`${previous}\`\n`,
      'utf8',
    );
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runRelease().catch(() => {
    console.error('Portainer release failed; no sensitive deployment details were printed.');
    process.exitCode = 1;
  });
}

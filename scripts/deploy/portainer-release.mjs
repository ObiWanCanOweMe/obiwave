#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseForkTag } from '../release/fork-tag.mjs';
import { PortainerClient, deployWithRollback } from './portainer-client.mjs';

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

function releaseConfig(env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required release configuration: ${missing.join(', ')}`);
  }
  parseForkTag(env.SUBWAVE_RELEASE_TAG);
  return Object.fromEntries(REQUIRED_ENV.map((name) => [name, env[name]]));
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
  const client = clientFactory({
    baseUrl: config.PORTAINER_URL,
    apiKey: config.PORTAINER_API_KEY,
    stackId: config.PORTAINER_STACK_ID,
    endpointId: config.PORTAINER_ENDPOINT_ID,
  });

  log(`Deploying SUB/WAVE ${config.SUBWAVE_RELEASE_TAG}`);
  const result = await deploy({
    client,
    manifest,
    targetVersion: config.SUBWAVE_RELEASE_TAG,
    healthUrl: config.SUBWAVE_HEALTH_URL,
    streamUrl: config.SUBWAVE_STREAM_URL,
  });
  log(`Verified SUB/WAVE ${result.targetVersion}`);

  if (env.GITHUB_STEP_SUMMARY) {
    const previous = result.previousVersion ?? '(not set)';
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

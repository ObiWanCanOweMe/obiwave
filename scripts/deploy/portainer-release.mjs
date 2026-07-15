#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseForkTag } from '../release/fork-tag.mjs';
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

function releaseConfig(env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required release configuration: ${missing.join(', ')}`);
  }
  parseForkTag(env.SUBWAVE_RELEASE_TAG);
  return Object.fromEntries(REQUIRED_ENV.map((name) => [name, env[name]]));
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
  let result;
  try {
    result = await deploy({
      client,
      manifest,
      targetVersion: config.SUBWAVE_RELEASE_TAG,
      healthUrl: config.SUBWAVE_HEALTH_URL,
      streamUrl: config.SUBWAVE_STREAM_URL,
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

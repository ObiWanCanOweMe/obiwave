#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseForkTag } from '../release/fork-tag.mjs';

function inspectImage(imageRef) {
  const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', imageRef], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function assertImageTagAbsent(imageRef, inspect = inspectImage) {
  const separator = imageRef.lastIndexOf(':');
  if (separator < 0) throw new Error('Image reference must include a fork-qualified release tag');
  parseForkTag(imageRef.slice(separator + 1));

  const result = inspect(imageRef);
  if (result.status === 0) {
    throw new Error(`Image tag already exists; immutable releases never overwrite it: ${imageRef}`);
  }

  const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const escapedRef = imageRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const explicitAbsence = new RegExp(
    `(?:manifest unknown|(?:^|\\n)(?:ERROR:\\s*)?${escapedRef}:\\s*not found(?:\\s|$))`,
    'i',
  );
  if (!explicitAbsence.test(diagnostic)) {
    throw new Error(`Could not prove image tag is absent; refusing publication: ${imageRef}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    assertImageTagAbsent(process.argv[2] ?? '');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

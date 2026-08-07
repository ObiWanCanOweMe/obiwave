#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseForkTag } from '../release/fork-tag.mjs';

export const EXPECTED_IMAGES = Object.freeze([
  'subwave-caddy',
  'subwave-broadcast',
  'subwave-controller',
  'subwave-web',
  'subwave-aio',
  'subwave-aio-heavy',
  'subwave-tts-heavy',
  'subwave-analyzer',
  'subwave-analyzer-heavy',
  'subwave-analyzer-cuda',
]);

export const CANONICAL_IMAGE_NAMESPACE = 'ghcr.io/obiwancanoweme';
export const PINNED_CUDA_IMAGE_DIGESTS = Object.freeze({
  'v1.3.0-obiwave.2': 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72',
  'v1.5.0-obiwave.1': 'sha256:a69d2f866eb9d991a69212b5605c15a3631d4d21cec8c4608a6cb29f9d7c9cc2',
  'v1.6.0-obiwave.1': 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341',
  'v1.6.0-obiwave.2': 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341',
  'v1.6.0-obiwave.3': 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341',
});

const POLICY_SEVERITIES = Object.freeze(['CRITICAL', 'HIGH']);
const ACCEPTANCE_FIELDS = Object.freeze([
  'vulnerabilityId',
  'images',
  'package',
  'installedVersion',
  'disposition',
  'justification',
  'owner',
  'approvedOn',
  'expiresOn',
  'tracking',
]);
const ACCEPTANCE_DISPOSITIONS = new Set(['no-fix', 'unreachable', 'upstream-mirror']);
const DAY_MS = 24 * 60 * 60 * 1000;

export class PolicyValidationError extends Error {
  constructor(violations, summary) {
    const details = violations.map(({ code, message }) => `- [${code}] ${message}`).join('\n');
    super(`Trivy policy failed with ${violations.length} violation(s):\n${details}`);
    this.name = 'PolicyValidationError';
    this.violations = violations;
    this.summary = summary;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalImageRef(image, tag) {
  return `${CANONICAL_IMAGE_NAMESPACE}/${image}:${tag}`;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function normalizedFindingKey(finding) {
  return [
    finding.vulnerabilityId,
    finding.image,
    finding.target,
    finding.package,
    finding.installedVersion,
    finding.fixedVersion,
    finding.severity,
  ].join('\u0000');
}

function acceptanceScopeKey(record, image) {
  return [record.vulnerabilityId, image, record.package, record.installedVersion].join('\u0000');
}

function acceptanceMatches(record, image, finding) {
  return (
    record.vulnerabilityId === finding.vulnerabilityId &&
    image === finding.image &&
    record.package === finding.package &&
    record.installedVersion === finding.installedVersion
  );
}

function addViolation(violations, code, message) {
  violations.push({ code, message });
}

function validateScanStatus(image, status, expectedImageRef, violations) {
  if (status === undefined) {
    addViolation(violations, 'missing-scan-status', `${image}: scan status marker is missing`);
    return;
  }

  if (!isObject(status)) {
    addViolation(violations, 'malformed-scan-status', `${image}: scan status marker must be an object`);
    return;
  }

  const malformed = [];
  if (status.schemaVersion !== 1) malformed.push('schemaVersion must equal 1');
  if (status.image !== image) malformed.push(`image must equal ${image}`);
  if (status.imageRef !== expectedImageRef) {
    malformed.push(`imageRef must equal ${expectedImageRef}`);
  }
  if (status.scanner !== 'trivy') malformed.push('scanner must equal trivy');
  if (status.scannerVersion !== '0.67.2') malformed.push('scannerVersion must equal 0.67.2');
  if (!Array.isArray(status.scanners)) malformed.push('scanners must be an array');
  if (!Array.isArray(status.severities)) malformed.push('severities must be an array');
  if (!['success', 'failure'].includes(status.outcome)) {
    malformed.push('outcome must equal success or failure');
  }
  if (status.error !== undefined && typeof status.error !== 'string') {
    malformed.push('error must be a string when present');
  }

  if (malformed.length > 0) {
    addViolation(
      violations,
      'malformed-scan-status',
      `${image}: malformed scan status (${malformed.join('; ')})`,
    );
  }

  if (Array.isArray(status.scanners) && !status.scanners.includes('vuln')) {
    addViolation(
      violations,
      'incomplete-vulnerability-scan',
      `${image}: scan status does not include the vuln scanner`,
    );
  }

  if (
    Array.isArray(status.severities) &&
    POLICY_SEVERITIES.some((severity) => !status.severities.includes(severity))
  ) {
    addViolation(
      violations,
      'incomplete-severity-scan',
      `${image}: scan status must include CRITICAL and HIGH severities`,
    );
  }

  if (status.outcome === 'failure') {
    const detail = isNonEmptyString(status.error) ? `: ${status.error.trim()}` : '';
    addViolation(violations, 'scanner-error', `${image}: Trivy scanner failed${detail}`);
  }
}

function normalizeReport(image, entry, expectedImageRef, pinnedCudaDigest, violations) {
  if (!isObject(entry)) {
    addViolation(violations, 'malformed-report', `${image}: report entry must be an object`);
    return [];
  }

  validateScanStatus(image, entry.status, expectedImageRef, violations);

  if (entry.reportError !== undefined) {
    const detail = isNonEmptyString(entry.reportError) ? entry.reportError.trim() : 'unknown read error';
    addViolation(violations, 'unreadable-report', `${image}: ${detail}`);
    return [];
  }

  const report = entry.report;
  if (!isObject(report)) {
    addViolation(violations, 'unreadable-report', `${image}: Trivy JSON report is missing`);
    return [];
  }

  const malformed = [];
  if (report.SchemaVersion !== 2) malformed.push('SchemaVersion must equal 2');
  if (report.ArtifactType !== 'container_image') malformed.push('ArtifactType must equal container_image');
  if (report.ArtifactName !== expectedImageRef) {
    malformed.push(`ArtifactName must equal ${expectedImageRef}`);
  }
  if (!Array.isArray(report.Results) || report.Results.length === 0) {
    malformed.push('Results must be a non-empty array');
  }

  if (malformed.length > 0) {
    addViolation(
      violations,
      'malformed-report',
      `${image}: malformed Trivy report (${malformed.join('; ')})`,
    );
    return [];
  }

  if (
    isObject(entry.status) &&
    isNonEmptyString(entry.status.imageRef) &&
    isNonEmptyString(report.ArtifactName) &&
    entry.status.imageRef !== report.ArtifactName
  ) {
    addViolation(
      violations,
      'report-status-identity-mismatch',
      `${image}: scan status imageRef ${entry.status.imageRef} does not equal report ArtifactName ${report.ArtifactName}`,
    );
  }

  if (image === 'subwave-analyzer-cuda' && pinnedCudaDigest) {
    const expectedRepoDigest = `${CANONICAL_IMAGE_NAMESPACE}/${image}@${pinnedCudaDigest}`;
    const repoDigests = isObject(report.Metadata) ? report.Metadata.RepoDigests : undefined;
    if (!Array.isArray(repoDigests) || !repoDigests.includes(expectedRepoDigest)) {
      addViolation(
        violations,
        'cuda-digest-mismatch',
        `${image}: report Metadata.RepoDigests must include pinned repository digest ${expectedRepoDigest}`,
      );
    }
  }

  const findings = [];
  for (const [resultIndex, result] of (report.Results ?? []).entries()) {
    if (!isObject(result)) {
      addViolation(
        violations,
        'malformed-report',
        `${image}: Results[${resultIndex}] must be an object`,
      );
      continue;
    }

    if (!isNonEmptyString(result.Target)) {
      addViolation(
        violations,
        'malformed-report',
        `${image}: Results[${resultIndex}].Target must be a non-empty string`,
      );
      continue;
    }

    if (!['os-pkgs', 'lang-pkgs'].includes(result.Class)) {
      addViolation(
        violations,
        'malformed-report',
        `${image}: Results[${resultIndex}].Class must identify a vulnerability result`,
      );
      continue;
    }

    if (
      result.Vulnerabilities !== undefined &&
      result.Vulnerabilities !== null &&
      !Array.isArray(result.Vulnerabilities)
    ) {
      addViolation(
        violations,
        'malformed-report',
        `${image}: Results[${resultIndex}].Vulnerabilities must be an array or null when present`,
      );
      continue;
    }

    for (const [vulnerabilityIndex, vulnerability] of (result.Vulnerabilities ?? []).entries()) {
      if (!isObject(vulnerability)) {
        addViolation(
          violations,
          'malformed-report',
          `${image}: vulnerability ${resultIndex}.${vulnerabilityIndex} must be an object`,
        );
        continue;
      }

      if (!isNonEmptyString(vulnerability.Severity)) {
        addViolation(
          violations,
          'malformed-report',
          `${image}: vulnerability ${resultIndex}.${vulnerabilityIndex}.Severity must be a non-empty string`,
        );
        continue;
      }

      const severity = vulnerability.Severity.toUpperCase();
      if (!POLICY_SEVERITIES.includes(severity)) continue;

      const fields = [
        ['VulnerabilityID', vulnerability.VulnerabilityID],
        ['PkgName', vulnerability.PkgName],
        ['InstalledVersion', vulnerability.InstalledVersion],
      ];
      const missingFields = fields.filter(([, value]) => !isNonEmptyString(value)).map(([name]) => name);
      if (missingFields.length > 0) {
        addViolation(
          violations,
          'malformed-report',
          `${image}: vulnerability ${resultIndex}.${vulnerabilityIndex} is missing ${missingFields.join(', ')}`,
        );
        continue;
      }

      if (
        vulnerability.FixedVersion !== undefined &&
        vulnerability.FixedVersion !== null &&
        typeof vulnerability.FixedVersion !== 'string'
      ) {
        addViolation(
          violations,
          'malformed-report',
          `${image}: vulnerability ${resultIndex}.${vulnerabilityIndex}.FixedVersion must be a string`,
        );
        continue;
      }

      findings.push({
        vulnerabilityId: vulnerability.VulnerabilityID.trim(),
        image,
        target: result.Target.trim(),
        package: vulnerability.PkgName.trim(),
        installedVersion: vulnerability.InstalledVersion.trim(),
        fixedVersion: vulnerability.FixedVersion?.trim() ?? '',
        severity,
        accepted: false,
      });
    }
  }

  return findings;
}

function validateAcceptanceManifest(acceptance, expectedImages, now, violations) {
  if (!isObject(acceptance)) {
    addViolation(violations, 'malformed-acceptance-manifest', 'acceptance manifest must be an object');
    return [];
  }

  const rootKeys = Object.keys(acceptance).sort();
  if (
    acceptance.schemaVersion !== 1 ||
    !Array.isArray(acceptance.acceptances) ||
    rootKeys.some((key) => !['acceptances', 'schemaVersion'].includes(key))
  ) {
    addViolation(
      violations,
      'malformed-acceptance-manifest',
      'acceptance manifest requires only schemaVersion 1 and an acceptances array',
    );
    return [];
  }

  const expectedImageSet = new Set(expectedImages);
  const nowDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const records = [];
  const seenScopes = new Map();

  for (const [index, rawRecord] of acceptance.acceptances.entries()) {
    if (!isObject(rawRecord)) {
      addViolation(
        violations,
        'malformed-acceptance',
        `acceptances[${index}] must be an object`,
      );
      continue;
    }

    const defects = [];
    const keys = Object.keys(rawRecord);
    const missing = ACCEPTANCE_FIELDS.filter((field) => !Object.hasOwn(rawRecord, field));
    const unknown = keys.filter((field) => !ACCEPTANCE_FIELDS.includes(field));
    if (missing.length > 0) defects.push(`missing fields: ${missing.join(', ')}`);
    if (unknown.length > 0) defects.push(`unknown fields: ${unknown.join(', ')}`);
    if (!isNonEmptyString(rawRecord.vulnerabilityId)) defects.push('vulnerabilityId must be non-empty');
    if (!Array.isArray(rawRecord.images) || rawRecord.images.length === 0) {
      defects.push('images must be a non-empty array');
    } else if (rawRecord.images.some((image) => !isNonEmptyString(image))) {
      defects.push('images entries must be non-empty strings');
    }
    if (!isNonEmptyString(rawRecord.package)) defects.push('package must be non-empty');
    if (!isNonEmptyString(rawRecord.installedVersion)) {
      defects.push('installedVersion must be non-empty');
    }
    if (!ACCEPTANCE_DISPOSITIONS.has(rawRecord.disposition)) {
      defects.push('disposition must be no-fix, unreachable, or upstream-mirror');
    }
    if (!isNonEmptyString(rawRecord.justification)) defects.push('justification must be non-empty');
    if (!isNonEmptyString(rawRecord.owner)) defects.push('owner must be non-empty');
    if (!isNonEmptyString(rawRecord.tracking)) {
      defects.push('tracking must be a non-empty URL');
    } else {
      try {
        const tracking = new URL(rawRecord.tracking);
        if (!['https:', 'http:'].includes(tracking.protocol)) throw new Error('unsupported protocol');
      } catch {
        defects.push('tracking must be an HTTP(S) URL');
      }
    }

    const approvedOn = parseDateOnly(rawRecord.approvedOn);
    const expiresOn = parseDateOnly(rawRecord.expiresOn);
    if (!approvedOn) defects.push('approvedOn must be a valid YYYY-MM-DD date');
    if (!expiresOn) defects.push('expiresOn must be a valid YYYY-MM-DD date');

    if (defects.length > 0) {
      addViolation(
        violations,
        'malformed-acceptance',
        `acceptances[${index}] is malformed (${defects.join('; ')})`,
      );
      continue;
    }

    const record = {
      ...rawRecord,
      vulnerabilityId: rawRecord.vulnerabilityId.trim(),
      images: rawRecord.images.map((image) => image.trim()),
      package: rawRecord.package.trim(),
      installedVersion: rawRecord.installedVersion.trim(),
      justification: rawRecord.justification.trim(),
      owner: rawRecord.owner.trim(),
      tracking: rawRecord.tracking.trim(),
      index,
      approvedDate: approvedOn,
      expiresDate: expiresOn,
      eligible: true,
    };

    const uniqueImages = new Set(record.images);
    if (uniqueImages.size !== record.images.length) {
      addViolation(
        violations,
        'duplicate-acceptance',
        `acceptances[${index}] repeats an image in its own scope`,
      );
      record.eligible = false;
    }

    for (const image of uniqueImages) {
      if (!expectedImageSet.has(image)) {
        addViolation(
          violations,
          'unknown-acceptance-image',
          `acceptances[${index}] names unknown image ${image}`,
        );
        record.eligible = false;
      }
    }

    if (approvedOn > nowDate) {
      addViolation(
        violations,
        'future-acceptance',
        `acceptances[${index}] approval ${record.approvedOn} is in the future`,
      );
      record.eligible = false;
    }
    if (expiresOn < approvedOn) {
      addViolation(
        violations,
        'invalid-acceptance-window',
        `acceptances[${index}] expires before it was approved`,
      );
      record.eligible = false;
    } else if ((expiresOn.getTime() - approvedOn.getTime()) / DAY_MS > 90) {
      addViolation(
        violations,
        'acceptance-over-90-days',
        `acceptances[${index}] exceeds the 90-day maximum`,
      );
      record.eligible = false;
    }
    if (expiresOn < nowDate) {
      addViolation(
        violations,
        'expired-acceptance',
        `acceptances[${index}] expired on ${record.expiresOn}`,
      );
      record.eligible = false;
    }

    if (
      record.disposition === 'upstream-mirror' &&
      (record.images.length !== 1 || record.images[0] !== 'subwave-analyzer-cuda')
    ) {
      addViolation(
        violations,
        'incompatible-disposition',
        `acceptances[${index}] may use upstream-mirror only for subwave-analyzer-cuda`,
      );
      record.eligible = false;
    }

    for (const image of uniqueImages) {
      const scopeKey = acceptanceScopeKey(record, image);
      if (seenScopes.has(scopeKey)) {
        addViolation(
          violations,
          'duplicate-acceptance',
          `acceptances[${index}] duplicates acceptances[${seenScopes.get(scopeKey)}] for ${record.vulnerabilityId} ${image} ${record.package}@${record.installedVersion}`,
        );
        record.eligible = false;
      } else {
        seenScopes.set(scopeKey, index);
      }
    }

    records.push(record);
  }

  return records;
}

export function validateReports({ reports, acceptance, expectedImages, tag, now }) {
  const violations = [];
  const reportMap = isObject(reports) ? reports : {};
  const imageList = Array.isArray(expectedImages) ? [...expectedImages] : [];
  const expectedImageSet = new Set(imageList);
  const validationNow = now instanceof Date ? new Date(now) : new Date(now);

  if (
    imageList.length === 0 ||
    expectedImageSet.size !== imageList.length ||
    imageList.some((image) => !isNonEmptyString(image))
  ) {
    throw new TypeError('expectedImages must be a non-empty array of unique image names');
  }
  if (Number.isNaN(validationNow.getTime())) throw new TypeError('now must be a valid date');
  parseForkTag(tag);
  const pinnedCudaDigest = PINNED_CUDA_IMAGE_DIGESTS[tag];
  if (!pinnedCudaDigest) {
    addViolation(
      violations,
      'unsupported-cuda-release',
      `subwave-analyzer-cuda: no pinned repository digest for ${tag}`,
    );
  }
  if (!isObject(reports)) {
    addViolation(violations, 'malformed-reports', 'reports must be an object keyed by image');
  }

  for (const image of Object.keys(reportMap).sort()) {
    if (!expectedImageSet.has(image)) {
      addViolation(violations, 'unknown-report-image', `report supplied for unknown image ${image}`);
    }
  }

  const findings = [];
  for (const image of imageList) {
    if (!Object.hasOwn(reportMap, image)) {
      addViolation(violations, 'missing-report', `${image}: required report is missing`);
      continue;
    }
    findings.push(
      ...normalizeReport(
        image,
        reportMap[image],
        canonicalImageRef(image, tag),
        pinnedCudaDigest,
        violations,
      ),
    );
  }

  const uniqueFindings = [
    ...new Map(findings.map((currentFinding) => [normalizedFindingKey(currentFinding), currentFinding])).values(),
  ].sort((left, right) => normalizedFindingKey(left).localeCompare(normalizedFindingKey(right)));

  const acceptanceRecords = validateAcceptanceManifest(
    acceptance,
    imageList,
    validationNow,
    violations,
  );
  const matchedAcceptanceScopes = new Set();

  for (const currentFinding of uniqueFindings) {
    const scopedRecords = acceptanceRecords.filter((record) =>
      record.images.some((image) => acceptanceMatches(record, image, currentFinding)),
    );
    for (const record of scopedRecords) {
      for (const image of record.images) {
        if (acceptanceMatches(record, image, currentFinding)) {
          matchedAcceptanceScopes.add(`${record.index}\u0000${image}`);
        }
      }
    }

    const compatibleRecords = scopedRecords.filter((record) => {
      if (!record.eligible) return false;
      if (record.disposition === 'no-fix' && currentFinding.fixedVersion !== '') {
        addViolation(
          violations,
          'incompatible-disposition',
          `acceptances[${record.index}] uses no-fix for ${currentFinding.vulnerabilityId} ${currentFinding.image} ${currentFinding.package}@${currentFinding.installedVersion}, but Trivy reports fix ${currentFinding.fixedVersion}`,
        );
        return false;
      }
      return true;
    });

    currentFinding.accepted = compatibleRecords.length > 0;
    if (!currentFinding.accepted) {
      addViolation(
        violations,
        'unaccepted-finding',
        `${currentFinding.vulnerabilityId} ${currentFinding.image} ${currentFinding.target} ${currentFinding.package}@${currentFinding.installedVersion} (${currentFinding.severity}, fix: ${currentFinding.fixedVersion || 'none'})`,
      );
    }
  }

  for (const record of acceptanceRecords) {
    for (const image of record.images) {
      if (!matchedAcceptanceScopes.has(`${record.index}\u0000${image}`)) {
        addViolation(
          violations,
          'orphaned-acceptance',
          `acceptances[${record.index}] image scope ${image} matches no current finding (${record.vulnerabilityId} ${record.package}@${record.installedVersion})`,
        );
      }
    }
  }

  const acceptedCount = uniqueFindings.filter(({ accepted }) => accepted).length;
  const summary = {
    imageCount: imageList.length,
    findingCount: uniqueFindings.length,
    acceptedCount,
    unacceptedCount: uniqueFindings.length - acceptedCount,
    acceptanceCount: acceptanceRecords.length,
    bySeverity: {
      CRITICAL: uniqueFindings.filter(({ severity }) => severity === 'CRITICAL').length,
      HIGH: uniqueFindings.filter(({ severity }) => severity === 'HIGH').length,
    },
    findings: uniqueFindings,
  };

  if (violations.length > 0) throw new PolicyValidationError(violations, summary);
  return summary;
}

async function readJsonFile(path) {
  try {
    return { value: JSON.parse(await readFile(path, 'utf8')) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadReports({ reportsDirectory, expectedImages, tag }) {
  if (!isNonEmptyString(reportsDirectory)) {
    throw new TypeError('reportsDirectory must be a non-empty path');
  }
  parseForkTag(tag);

  const directoryEntries = await readdir(reportsDirectory, { withFileTypes: true });
  const discoveredImages = new Set();
  for (const entry of directoryEntries) {
    if (!entry.isFile()) continue;
    const match = /^(subwave-[a-z0-9-]+?)(?:\.status)?\.json$/.exec(entry.name);
    if (match) discoveredImages.add(match[1]);
  }

  const images = [...new Set([...expectedImages, ...discoveredImages])].sort();
  const reports = {};
  for (const image of images) {
    const expectedImageRef = canonicalImageRef(image, tag);
    const reportPath = resolve(reportsDirectory, `${image}.json`);
    const statusPath = resolve(reportsDirectory, `${image}.status.json`);
    const [reportRead, statusRead] = await Promise.all([
      readJsonFile(reportPath),
      readJsonFile(statusPath),
    ]);

    const reportMissing = reportRead.error?.includes('ENOENT');
    const statusMissing = statusRead.error?.includes('ENOENT');
    if (reportMissing && statusMissing && !discoveredImages.has(image)) continue;

    const reportEntry = {};
    if (reportRead.error) {
      reportEntry.reportError = `cannot read ${image}.json (${reportRead.error})`;
    } else {
      reportEntry.report = reportRead.value;
      if (reportRead.value?.ArtifactName !== expectedImageRef) {
        reportEntry.reportError =
          `${image}.json does not describe canonical requested image ${expectedImageRef} ` +
          `(ArtifactName: ${String(reportRead.value?.ArtifactName)})`;
      }
    }

    if (!statusMissing) {
      if (statusRead.error) {
        reportEntry.status = {};
        reportEntry.reportError = [
          reportEntry.reportError,
          `cannot read ${image}.status.json (${statusRead.error})`,
        ].filter(Boolean).join('; ');
      } else {
        reportEntry.status = statusRead.value;
        if (statusRead.value?.imageRef !== expectedImageRef) {
          reportEntry.status = {
            ...statusRead.value,
            outcome: 'failure',
            error:
              `${image}.status.json does not describe canonical requested image ${expectedImageRef} ` +
              `(imageRef: ${String(statusRead.value?.imageRef)})`,
          };
        }
      }
    }

    reports[image] = reportEntry;
  }

  return reports;
}

function parseCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--reports', '--acceptance', '--tag'].includes(flag) || !isNonEmptyString(value)) {
      throw new Error(
        'Usage: node scripts/security/trivy-policy.mjs --reports <directory> --acceptance <file> --tag <fork-tag>',
      );
    }
    if (Object.hasOwn(options, flag)) throw new Error(`Duplicate argument: ${flag}`);
    options[flag] = value;
  }
  if (argv.length !== 6 || !options['--reports'] || !options['--acceptance'] || !options['--tag']) {
    throw new Error(
      'Usage: node scripts/security/trivy-policy.mjs --reports <directory> --acceptance <file> --tag <fork-tag>',
    );
  }
  parseForkTag(options['--tag']);
  return {
    reportsDirectory: options['--reports'],
    acceptancePath: options['--acceptance'],
    tag: options['--tag'],
  };
}

async function runCli(argv) {
  const { reportsDirectory, acceptancePath, tag } = parseCliArguments(argv);
  const [reports, acceptanceRead] = await Promise.all([
    loadReports({ reportsDirectory, expectedImages: EXPECTED_IMAGES, tag }),
    readJsonFile(acceptancePath),
  ]);
  if (acceptanceRead.error) {
    throw new Error(`cannot read acceptance manifest ${acceptancePath} (${acceptanceRead.error})`);
  }

  const summary = validateReports({
    reports,
    acceptance: acceptanceRead.value,
    expectedImages: EXPECTED_IMAGES,
    tag,
    now: new Date(),
  });
  process.stdout.write(`${JSON.stringify({ result: 'pass', tag, ...summary }, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

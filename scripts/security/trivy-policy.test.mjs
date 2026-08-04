import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import {
  EXPECTED_IMAGES,
  loadReports,
  PolicyValidationError,
  validateReports,
} from './trivy-policy.mjs';

const execFileAsync = promisify(execFile);

const NOW = new Date('2026-08-04T12:00:00.000Z');
const TAG = 'v1.3.0-obiwave.1';

function scanStatus(image, overrides = {}) {
  return {
    schemaVersion: 1,
    image,
    imageRef: `ghcr.io/perminder-klair/${image}:${TAG}`,
    scanner: 'trivy',
    scannerVersion: '0.67.2',
    scanners: ['vuln'],
    severities: ['CRITICAL', 'HIGH'],
    outcome: 'success',
    ...overrides,
  };
}

function trivyReport(image, vulnerabilities = [], overrides = {}) {
  return {
    SchemaVersion: 2,
    ArtifactName: `ghcr.io/perminder-klair/${image}:${TAG}`,
    ArtifactType: 'container_image',
    Results: [
      {
        Target: 'debian 12',
        Class: 'os-pkgs',
        Type: 'debian',
        Vulnerabilities: vulnerabilities,
      },
    ],
    ...overrides,
  };
}

function finding(overrides = {}) {
  return {
    VulnerabilityID: 'CVE-2026-1000',
    PkgName: 'libexample1',
    InstalledVersion: '1.0.0-1',
    FixedVersion: '',
    Severity: 'HIGH',
    ...overrides,
  };
}

function reportEntry(image, vulnerabilities = []) {
  return {
    status: scanStatus(image),
    report: trivyReport(image, vulnerabilities),
  };
}

function cleanReports() {
  return Object.fromEntries(EXPECTED_IMAGES.map((image) => [image, reportEntry(image)]));
}

function manifest(acceptances = [], overrides = {}) {
  return {
    schemaVersion: 1,
    acceptances,
    ...overrides,
  };
}

function acceptance(overrides = {}) {
  return {
    vulnerabilityId: 'CVE-2026-1000',
    images: ['subwave-controller'],
    package: 'libexample1',
    installedVersion: '1.0.0-1',
    disposition: 'no-fix',
    justification: 'The installed distribution package has no published compatible fix.',
    owner: 'SUB/WAVE maintainers',
    approvedOn: '2026-08-04',
    expiresOn: '2026-11-02',
    tracking: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1000',
    ...overrides,
  };
}

function validationError(options) {
  try {
    validateReports(options);
    assert.fail('expected policy validation to fail');
  } catch (error) {
    assert.ok(error instanceof PolicyValidationError, `unexpected error: ${error}`);
    return error;
  }
}

function violationCodes(error) {
  return error.violations.map(({ code }) => code);
}

test('clean ten-image matrix returns a deterministic empty summary', () => {
  const summary = validateReports({
    reports: cleanReports(),
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(summary, {
    imageCount: 10,
    findingCount: 0,
    acceptedCount: 0,
    unacceptedCount: 0,
    acceptanceCount: 0,
    bySeverity: { CRITICAL: 0, HIGH: 0 },
    findings: [],
  });
});

test('a clean Trivy result may omit the Vulnerabilities property', () => {
  const reports = cleanReports();
  delete reports['subwave-caddy'].report.Results[0].Vulnerabilities;

  const summary = validateReports({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.equal(summary.findingCount, 0);
  assert.equal(summary.unacceptedCount, 0);
});

test('a finding is accepted only at its exact image, package, and installed version scope', () => {
  const reports = cleanReports();
  reports['subwave-controller'] = reportEntry('subwave-controller', [finding()]);

  const summary = validateReports({
    reports,
    acceptance: manifest([acceptance()]),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.unacceptedCount, 0);
  assert.deepEqual(summary.findings, [
    {
      vulnerabilityId: 'CVE-2026-1000',
      image: 'subwave-controller',
      target: 'debian 12',
      package: 'libexample1',
      installedVersion: '1.0.0-1',
      fixedVersion: '',
      severity: 'HIGH',
      accepted: true,
    },
  ]);
});

test('an unaccepted Critical or High occurrence fails with its normalized scope', () => {
  const reports = cleanReports();
  reports['subwave-web'] = reportEntry('subwave-web', [
    finding({
      VulnerabilityID: 'CVE-2026-2000',
      PkgName: 'openssl',
      InstalledVersion: '3.0.0',
      FixedVersion: '3.0.1',
      Severity: 'CRITICAL',
    }),
  ]);

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['unaccepted-finding']);
  assert.match(error.message, /CVE-2026-2000/);
  assert.match(error.message, /subwave-web/);
  assert.match(error.message, /openssl@3\.0\.0/);
  assert.equal(error.summary.unacceptedCount, 1);
});

test('expired, over-90-day, malformed, and duplicate acceptance records are all rejected together', () => {
  const malformed = acceptance({ owner: '', tracking: 'not-a-url' });
  delete malformed.justification;

  const error = validationError({
    reports: cleanReports(),
    acceptance: manifest([
      acceptance({ approvedOn: '2026-01-01', expiresOn: '2026-02-01' }),
      acceptance({ vulnerabilityId: 'CVE-2026-3000', approvedOn: '2026-08-04', expiresOn: '2026-11-03' }),
      malformed,
      acceptance(),
      acceptance(),
    ]),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  const codes = violationCodes(error);
  assert.ok(codes.includes('expired-acceptance'));
  assert.ok(codes.includes('acceptance-over-90-days'));
  assert.ok(codes.includes('malformed-acceptance'));
  assert.ok(codes.includes('duplicate-acceptance'));
  assert.ok(codes.includes('orphaned-acceptance'));
  assert.ok(error.violations.length >= 8, 'all manifest defects should be aggregated');
});

test('reports and acceptance scopes cannot name an image outside the required matrix', () => {
  const reports = cleanReports();
  reports['subwave-surprise'] = reportEntry('subwave-surprise');

  const error = validationError({
    reports,
    acceptance: manifest([acceptance({ images: ['subwave-surprise'] })]),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.ok(violationCodes(error).includes('unknown-report-image'));
  assert.ok(violationCodes(error).includes('unknown-acceptance-image'));
});

test('package or installed-version mismatches leave the finding unaccepted and the record orphaned', () => {
  const reports = cleanReports();
  reports['subwave-controller'] = reportEntry('subwave-controller', [finding()]);

  for (const scopedAcceptance of [
    acceptance({ package: 'libother1' }),
    acceptance({ installedVersion: '1.0.0-2' }),
  ]) {
    const error = validationError({
      reports,
      acceptance: manifest([scopedAcceptance]),
      expectedImages: EXPECTED_IMAGES,
      now: NOW,
    });

    assert.ok(violationCodes(error).includes('unaccepted-finding'));
    assert.ok(violationCodes(error).includes('orphaned-acceptance'));
  }
});

test('an acceptance that matches no current finding is rejected as orphaned', () => {
  const error = validationError({
    reports: cleanReports(),
    acceptance: manifest([acceptance()]),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['orphaned-acceptance']);
});

test('every required image must have one report', () => {
  const reports = cleanReports();
  delete reports['subwave-aio-heavy'];

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['missing-report']);
  assert.match(error.message, /subwave-aio-heavy/);
});

test('an unreadable report is a policy failure rather than an empty result', () => {
  const reports = cleanReports();
  reports['subwave-caddy'] = {
    status: scanStatus('subwave-caddy'),
    reportError: 'Unexpected token at byte 14',
  };

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['unreadable-report']);
  assert.match(error.message, /Unexpected token at byte 14/);
});

test('a scanner error marker fails even when a parseable report exists', () => {
  const reports = cleanReports();
  reports['subwave-broadcast'].status = scanStatus('subwave-broadcast', {
    outcome: 'failure',
    error: 'database download failed',
  });

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['scanner-error']);
  assert.match(error.message, /database download failed/);
});

test('missing scan status and scan metadata that omits Critical or High fail closed', () => {
  const reports = cleanReports();
  delete reports['subwave-web'].status;
  reports['subwave-analyzer'].status = scanStatus('subwave-analyzer', {
    severities: ['MEDIUM', 'HIGH'],
  });

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.ok(violationCodes(error).includes('missing-scan-status'));
  assert.ok(violationCodes(error).includes('incomplete-severity-scan'));
});

test('a malformed Trivy result cannot masquerade as a clean scan', () => {
  const reports = cleanReports();
  reports['subwave-tts-heavy'].report = {
    SchemaVersion: 2,
    ArtifactName: `ghcr.io/perminder-klair/subwave-tts-heavy:${TAG}`,
    ArtifactType: 'container_image',
  };

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['malformed-report']);
});

test('no-fix cannot accept a finding for which the scanner reports a fix', () => {
  const reports = cleanReports();
  reports['subwave-controller'] = reportEntry('subwave-controller', [
    finding({ FixedVersion: '1.0.1-1' }),
  ]);

  const error = validationError({
    reports,
    acceptance: manifest([acceptance()]),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.ok(violationCodes(error).includes('incompatible-disposition'));
  assert.ok(violationCodes(error).includes('unaccepted-finding'));
});

test('upstream-mirror is restricted to the exact mirrored CUDA image', () => {
  const reports = cleanReports();
  reports['subwave-controller'] = reportEntry('subwave-controller', [finding()]);

  const error = validationError({
    reports,
    acceptance: manifest([acceptance({ disposition: 'upstream-mirror' })]),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.ok(violationCodes(error).includes('incompatible-disposition'));
  assert.ok(violationCodes(error).includes('unaccepted-finding'));
});

test('findings are sorted by a stable normalized key', () => {
  const reports = cleanReports();
  reports['subwave-web'] = reportEntry('subwave-web', [
    finding({ VulnerabilityID: 'CVE-2026-9000', PkgName: 'z-last', Severity: 'HIGH' }),
    finding({ VulnerabilityID: 'CVE-2026-1000', PkgName: 'a-first', Severity: 'CRITICAL' }),
  ]);

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(
    error.summary.findings.map(({ vulnerabilityId }) => vulnerabilityId),
    ['CVE-2026-1000', 'CVE-2026-9000'],
  );
});

test('the report loader requires matching raw JSON and status files for the requested tag', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-trivy-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  for (const image of EXPECTED_IMAGES) {
    await writeFile(join(directory, `${image}.json`), JSON.stringify(trivyReport(image)));
    await writeFile(join(directory, `${image}.status.json`), JSON.stringify(scanStatus(image)));
  }

  const reports = await loadReports({
    reportsDirectory: directory,
    expectedImages: EXPECTED_IMAGES,
    tag: TAG,
  });
  const summary = validateReports({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });
  assert.equal(summary.imageCount, 10);

  await writeFile(
    join(directory, 'subwave-caddy.json'),
    JSON.stringify(trivyReport('subwave-caddy', [], {
      ArtifactName: 'ghcr.io/perminder-klair/subwave-caddy:v1.3.0-obiwave.0',
    })),
  );
  const mismatchedReports = await loadReports({
    reportsDirectory: directory,
    expectedImages: EXPECTED_IMAGES,
    tag: TAG,
  });
  const error = validationError({
    reports: mismatchedReports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });
  assert.ok(violationCodes(error).includes('unreadable-report'));
  assert.match(error.message, /requested tag v1\.3\.0-obiwave\.1/);
});

test('the CLI emits a machine-readable summary and exits nonzero on a missing report', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-trivy-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const acceptancePath = join(directory, 'acceptance.json');
  await writeFile(acceptancePath, JSON.stringify(manifest()));

  for (const image of EXPECTED_IMAGES) {
    await writeFile(join(directory, `${image}.json`), JSON.stringify(trivyReport(image)));
    await writeFile(join(directory, `${image}.status.json`), JSON.stringify(scanStatus(image)));
  }

  const script = new URL('./trivy-policy.mjs', import.meta.url);
  const passing = await execFileAsync(process.execPath, [
    script.pathname,
    '--reports', directory,
    '--acceptance', acceptancePath,
    '--tag', TAG,
  ]);
  const passingSummary = JSON.parse(passing.stdout);
  assert.equal(passingSummary.result, 'pass');
  assert.equal(passingSummary.imageCount, 10);
  assert.equal(passingSummary.unacceptedCount, 0);

  await rm(join(directory, 'subwave-web.json'));
  await assert.rejects(
    execFileAsync(process.execPath, [
      script.pathname,
      '--reports', directory,
      '--acceptance', acceptancePath,
      '--tag', TAG,
    ]),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /subwave-web/);
      assert.match(error.stderr, /missing|unreadable/i);
      return true;
    },
  );
});

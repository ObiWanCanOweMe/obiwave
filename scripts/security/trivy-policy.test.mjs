import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const V13_TAG = 'v1.3.0-obiwave.2';
const V15_TAG = 'v1.5.0-obiwave.1';
const V16_TAG = 'v1.6.0-obiwave.1';
const V16_REVISION_2_TAG = 'v1.6.0-obiwave.2';
const V16_REVISION_3_TAG = 'v1.6.0-obiwave.3';
const TAG = V13_TAG;
const IMAGE_NAMESPACE = 'ghcr.io/obiwancanoweme';
const V13_CUDA_DIGEST = 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72';
const V15_CUDA_DIGEST = 'sha256:a69d2f866eb9d991a69212b5605c15a3631d4d21cec8c4608a6cb29f9d7c9cc2';
const V16_CUDA_DIGEST = 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341';
const V16_REVISION_2_CUDA_DIGEST = 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341';
const V16_REVISION_3_CUDA_DIGEST = 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341';
const CUDA_PLATFORM_IMAGE_ID = 'sha256:e18b84e364d5168189966097d629eddccc94cf9c5b7e73a443e0b1e8fcd3e7f2';
const checkedInAcceptance = JSON.parse(
  await readFile(new URL('../../security/trivy-acceptance.json', import.meta.url), 'utf8'),
);
const CUDA_ACCEPTANCE_JUSTIFICATION =
  'This image is an exact immutable upstream CUDA mirror; the checked-in release-aware CUDA digest policy binds each supported fork release to its reviewed repository manifest digest, and SUB/WAVE does not rebuild or mutate the mirrored contents.';
const CURL_8458_ID = 'CVE-2026-8458';
const CURL_8458_TRACKING = 'https://curl.se/docs/CVE-2026-8458.html';
const CURL_8458_UNREACHABLE =
  'The upstream advisory requires libcurl HTTP Negotiate connection reuse with different service names on the same host, port, and credentials; SUB/WAVE configures neither Negotiate nor CURLOPT_SERVICE_NAME/CURLOPT_PROXY_SERVICE_NAME, and the curl command-line tool used by the station is explicitly unaffected.';
const FFMPEG_2026_IDS = [
  'CVE-2026-64830',
  'CVE-2026-64832',
  'CVE-2026-64833',
  'CVE-2026-70628',
  'CVE-2026-70632',
];
const FFMPEG_BINARY_PACKAGES = [
  'ffmpeg',
  'libavcodec59',
  'libavdevice59',
  'libavfilter8',
  'libavformat59',
  'libavutil57',
  'libpostproc56',
  'libswresample4',
  'libswscale6',
];
const FFMPEG_IMAGES = [
  'subwave-controller',
  'subwave-analyzer',
  'subwave-analyzer-heavy',
  'subwave-analyzer-cuda',
];

function imageRef(image, tag = V13_TAG) {
  return `${IMAGE_NAMESPACE}/${image}:${tag}`;
}

function scanStatus(image, overrides = {}, tag = V13_TAG) {
  return {
    schemaVersion: 1,
    image,
    imageRef: imageRef(image, tag),
    scanner: 'trivy',
    scannerVersion: '0.67.2',
    scanners: ['vuln'],
    severities: ['CRITICAL', 'HIGH'],
    outcome: 'success',
    ...overrides,
  };
}

function trivyReport(image, vulnerabilities = [], overrides = {}, options = {}) {
  const tag = options.tag ?? V13_TAG;
  const cudaDigest = options.cudaDigest ?? V13_CUDA_DIGEST;
  return {
    SchemaVersion: 2,
    ArtifactName: imageRef(image, tag),
    ArtifactType: 'container_image',
    Metadata: {
      ImageID: image === 'subwave-analyzer-cuda'
        ? CUDA_PLATFORM_IMAGE_ID
        : `sha256:${'a'.repeat(64)}`,
      RepoTags: [imageRef(image, tag)],
      RepoDigests: [
        `${IMAGE_NAMESPACE}/${image}@${image === 'subwave-analyzer-cuda'
          ? cudaDigest
          : `sha256:${'b'.repeat(64)}`}`,
      ],
    },
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

function reportEntry(image, vulnerabilities = [], options = {}) {
  return {
    status: scanStatus(image, {}, options.tag),
    report: trivyReport(image, vulnerabilities, {}, options),
  };
}

function cleanReports(options = {}) {
  return Object.fromEntries(
    EXPECTED_IMAGES.map((image) => [image, reportEntry(image, [], options)]),
  );
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
    validateReports({ tag: TAG, ...options });
    assert.fail('expected policy validation to fail');
  } catch (error) {
    assert.ok(error instanceof PolicyValidationError, `unexpected error: ${error}`);
    return error;
  }
}

function violationCodes(error) {
  return error.violations.map(({ code }) => code);
}

test('checked-in CUDA mirror acceptances carry the reviewed release-aware statement', () => {
  const records = checkedInAcceptance.acceptances.filter((record) =>
    record.disposition === 'upstream-mirror' &&
    record.vulnerabilityId !== CURL_8458_ID &&
    record.images.length === 1 &&
    record.images[0] === 'subwave-analyzer-cuda');

  assert.equal(records.length, 160);
  for (const record of records) {
    assert.equal(record.justification, CUDA_ACCEPTANCE_JUSTIFICATION);
    assert.equal(record.approvedOn, '2026-08-05');
    assert.equal(record.expiresOn, '2026-11-03');
  }
  assert.equal(
    checkedInAcceptance.acceptances.filter((record) => record.disposition === 'upstream-mirror').length,
    162,
  );
});

test('checked-in CVE-2026-8458 acceptances are time-bounded to the reviewed curl scopes', () => {
  const records = checkedInAcceptance.acceptances.filter((record) =>
    record.vulnerabilityId === CURL_8458_ID);

  assert.equal(records.length, 7);
  assert.deepEqual(
    records.map(({ package: packageName, installedVersion, disposition, images }) => ({
      package: packageName,
      installedVersion,
      disposition,
      images,
    })),
    [
      { package: 'curl', installedVersion: '8.14.1-2+deb13u4', disposition: 'unreachable', images: ['subwave-broadcast', 'subwave-aio', 'subwave-aio-heavy'] },
      { package: 'libcurl3t64-gnutls', installedVersion: '8.14.1-2+deb13u4', disposition: 'unreachable', images: ['subwave-broadcast', 'subwave-aio', 'subwave-aio-heavy'] },
      { package: 'libcurl4t64', installedVersion: '8.14.1-2+deb13u4', disposition: 'unreachable', images: ['subwave-broadcast', 'subwave-aio', 'subwave-aio-heavy'] },
      { package: 'curl', installedVersion: '7.88.1-10+deb12u15', disposition: 'unreachable', images: ['subwave-controller', 'subwave-tts-heavy', 'subwave-analyzer', 'subwave-analyzer-heavy'] },
      { package: 'libcurl4', installedVersion: '7.88.1-10+deb12u15', disposition: 'unreachable', images: ['subwave-controller', 'subwave-tts-heavy', 'subwave-analyzer', 'subwave-analyzer-heavy'] },
      { package: 'curl', installedVersion: '7.88.1-10+deb12u15', disposition: 'upstream-mirror', images: ['subwave-analyzer-cuda'] },
      { package: 'libcurl4', installedVersion: '7.88.1-10+deb12u15', disposition: 'upstream-mirror', images: ['subwave-analyzer-cuda'] },
    ],
  );

  for (const record of records) {
    assert.equal(record.owner, 'SUB/WAVE maintainers');
    assert.equal(record.approvedOn, '2026-08-07');
    assert.equal(record.expiresOn, '2026-11-05');
    assert.equal(record.tracking, CURL_8458_TRACKING);
    assert.equal(
      record.justification,
      record.disposition === 'unreachable'
        ? CURL_8458_UNREACHABLE
        : CUDA_ACCEPTANCE_JUSTIFICATION,
    );
  }
});

test('checked-in 2026 FFmpeg acceptances are exact, short-lived, and limited to media-processing images', () => {
  const records = checkedInAcceptance.acceptances.filter((record) =>
    FFMPEG_2026_IDS.includes(record.vulnerabilityId));

  assert.equal(records.length, FFMPEG_2026_IDS.length * FFMPEG_BINARY_PACKAGES.length);
  assert.deepEqual(
    [...new Set(records.map((record) => record.vulnerabilityId))],
    FFMPEG_2026_IDS,
  );

  for (const vulnerabilityId of FFMPEG_2026_IDS) {
    assert.deepEqual(
      records
        .filter((record) => record.vulnerabilityId === vulnerabilityId)
        .map((record) => record.package),
      FFMPEG_BINARY_PACKAGES,
    );
  }

  for (const record of records) {
    assert.deepEqual(record.images, FFMPEG_IMAGES);
    assert.equal(record.installedVersion, '7:5.1.9-0+deb12u1');
    assert.equal(record.disposition, 'no-fix');
    assert.equal(record.owner, 'SUB/WAVE maintainers');
    assert.equal(record.approvedOn, '2026-08-07');
    assert.equal(record.expiresOn, '2026-09-06');
    assert.equal(
      record.tracking,
      `https://security-tracker.debian.org/tracker/${record.vulnerabilityId}`,
    );
    assert.match(record.justification, /no public media-upload surface/);
    assert.match(record.justification, /short-lived pending a Debian security update/);
  }
});

test('clean ten-image matrix returns a deterministic empty summary', () => {
  const summary = validateReports({
    tag: TAG,
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
    tag: TAG,
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
    tag: TAG,
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

test('every image scope in a multi-image acceptance must match a current finding', () => {
  const reports = cleanReports();
  reports['subwave-controller'] = reportEntry('subwave-controller', [finding()]);
  reports['subwave-web'] = reportEntry('subwave-web', [finding()]);

  const error = validationError({
    reports,
    acceptance: manifest([acceptance({
      images: ['subwave-controller', 'subwave-web', 'subwave-caddy'],
    })]),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['orphaned-acceptance']);
  assert.match(error.message, /subwave-caddy/);
  assert.equal(error.summary.acceptedCount, 2);
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
    ArtifactName: imageRef('subwave-tts-heavy'),
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

test('a null Trivy Results value cannot masquerade as a clean scan', () => {
  const reports = cleanReports();
  reports['subwave-caddy'].report.Results = null;

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['malformed-report']);
});

test('an empty Trivy Results array cannot masquerade as a clean scan', () => {
  const reports = cleanReports();
  reports['subwave-caddy'].report.Results = [];

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['malformed-report']);
});

test('a vulnerability with missing Severity is rejected as malformed', () => {
  const reports = cleanReports();
  const malformedFinding = finding();
  delete malformedFinding.Severity;
  reports['subwave-controller'] = reportEntry('subwave-controller', [malformedFinding]);

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['malformed-report']);
  assert.match(error.message, /Severity/);
});

test('a vulnerability with non-string Severity is rejected as malformed', () => {
  const reports = cleanReports();
  reports['subwave-controller'] = reportEntry('subwave-controller', [
    finding({ Severity: 7 }),
  ]);

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['malformed-report']);
  assert.match(error.message, /Severity/);
});

test('a foreign registry cannot impersonate the canonical release image', () => {
  const reports = cleanReports();
  const foreignRef = `ghcr.io/perminder-klair/subwave-caddy:${TAG}`;
  reports['subwave-caddy'].status.imageRef = foreignRef;
  reports['subwave-caddy'].report.ArtifactName = foreignRef;

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.ok(violationCodes(error).includes('malformed-scan-status'));
  assert.ok(violationCodes(error).includes('malformed-report'));
  assert.match(error.message, /ghcr\.io\/obiwancanoweme/);
});

test('scan status identity must equal the report artifact identity', () => {
  const reports = cleanReports();
  reports['subwave-caddy'].status.imageRef = `ghcr.io/perminder-klair/subwave-caddy:${TAG}`;

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.ok(violationCodes(error).includes('report-status-identity-mismatch'));
  assert.match(error.message, /status.*report/i);
});

test('the CUDA mirror report must carry the policy-pinned repository digest', () => {
  const reports = cleanReports();
  reports['subwave-analyzer-cuda'].report.Metadata.RepoDigests = [
    `${IMAGE_NAMESPACE}/subwave-analyzer-cuda@sha256:${'f'.repeat(64)}`,
  ];

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['cuda-digest-mismatch']);
  assert.match(error.message, new RegExp(V13_CUDA_DIGEST));
});

test('a CUDA platform image ID cannot substitute for the pinned repository digest', () => {
  const reports = cleanReports();
  reports['subwave-analyzer-cuda'].report.Metadata.ImageID = V13_CUDA_DIGEST;
  reports['subwave-analyzer-cuda'].report.Metadata.RepoDigests = [];

  const error = validationError({
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });

  assert.deepEqual(violationCodes(error), ['cuda-digest-mismatch']);
  assert.match(error.message, /repository digest/);
});

test('each supported release accepts only its pinned CUDA repository digest', () => {
  for (const [tag, cudaDigest] of [
    [V13_TAG, V13_CUDA_DIGEST],
    [V15_TAG, V15_CUDA_DIGEST],
    [V16_TAG, V16_CUDA_DIGEST],
    [V16_REVISION_2_TAG, V16_REVISION_2_CUDA_DIGEST],
    [V16_REVISION_3_TAG, V16_REVISION_3_CUDA_DIGEST],
  ]) {
    const summary = validateReports({
      tag,
      reports: cleanReports({ tag, cudaDigest }),
      acceptance: manifest(),
      expectedImages: EXPECTED_IMAGES,
      now: NOW,
    });
    assert.equal(summary.imageCount, 10);
  }
});

test('cross-release CUDA digests fail closed', () => {
  for (const [tag, cudaDigest] of [
    [V13_TAG, V15_CUDA_DIGEST],
    [V13_TAG, V16_CUDA_DIGEST],
    [V15_TAG, V13_CUDA_DIGEST],
    [V15_TAG, V16_CUDA_DIGEST],
    [V16_TAG, V13_CUDA_DIGEST],
    [V16_TAG, V15_CUDA_DIGEST],
    [V16_REVISION_2_TAG, V13_CUDA_DIGEST],
    [V16_REVISION_2_TAG, V15_CUDA_DIGEST],
    [V16_REVISION_3_TAG, V13_CUDA_DIGEST],
    [V16_REVISION_3_TAG, V15_CUDA_DIGEST],
  ]) {
    const error = validationError({
      tag,
      reports: cleanReports({ tag, cudaDigest }),
      acceptance: manifest(),
      expectedImages: EXPECTED_IMAGES,
      now: NOW,
    });
    assert.ok(violationCodes(error).includes('cuda-digest-mismatch'));
  }
});

test('an unknown fork release tag cannot bypass CUDA identity policy', () => {
  const tag = 'v9.9.9-obiwave.9';
  const error = validationError({
    tag,
    reports: cleanReports({ tag, cudaDigest: V15_CUDA_DIGEST }),
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });
  assert.ok(violationCodes(error).includes('unsupported-cuda-release'));
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
    tag: TAG,
    reports,
    acceptance: manifest(),
    expectedImages: EXPECTED_IMAGES,
    now: NOW,
  });
  assert.equal(summary.imageCount, 10);

  await writeFile(
    join(directory, 'subwave-caddy.json'),
    JSON.stringify(trivyReport('subwave-caddy', [], {
      ArtifactName: 'ghcr.io/obiwancanoweme/subwave-caddy:v1.3.0-obiwave.0',
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
  assert.match(
    error.message,
    /canonical requested image ghcr\.io\/obiwancanoweme\/subwave-caddy:v1\.3\.0-obiwave\.2/,
  );
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

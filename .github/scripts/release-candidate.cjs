'use strict';

// OCI candidate handling follows NestJS; the vulnerability policy is shared
// with Express's base-CI runtime scanner, rather than duplicated here.
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { evaluate } = require('./release-check.cjs');
const policyPath = path.resolve(
  __dirname,
  '../../security/container-vulnerability-exceptions.json',
);
const scannerDefault = 'aquasec/trivy:latest';
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}
function run(command, args, capture = false) {
  const executable =
    command === 'bash'
      ? process.env.RELEASE_BASH ||
        (process.platform === 'win32'
          ? path.join(
              process.env.ProgramFiles || 'C:/Program Files',
              'Git/bin/bash.exe',
            )
          : 'bash')
      : command;
  const result = spawnSync(executable, args, {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed${result.status === null ? '' : ` (exit ${result.status})`}${capture ? `: ${result.stderr?.trim() ?? ''}` : ''}`,
    );
  return capture ? result.stdout.trim() : '';
}
function readTarEntry(filename, wanted) {
  const fd = fs.openSync(filename, 'r');
  try {
    const header = Buffer.alloc(512);
    let offset = 0;
    while (
      fs.readSync(fd, header, 0, 512, offset) === 512 &&
      header.some((byte) => byte !== 0)
    ) {
      const string = (start, size) =>
        header
          .subarray(start, start + size)
          .toString('utf8')
          .split('\0')[0];
      const prefix = string(345, 155);
      const name = `${prefix ? `${prefix}/` : ''}${string(0, 100)}`.replace(
        /^\.\//,
        '',
      );
      const sizeText = string(124, 12).trim();
      if (!/^[0-7]+$/.test(sizeText))
        throw new Error('Unsupported OCI tar size');
      const size = Number.parseInt(sizeText, 8);
      if (name === wanted) {
        if (size > 16 * 1024 * 1024)
          throw new Error('OCI metadata is too large');
        const body = Buffer.alloc(size);
        if (fs.readSync(fd, body, 0, size, offset + 512) !== size)
          throw new Error('Truncated OCI metadata');
        return body;
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    throw new Error(`OCI archive lacks ${wanted}`);
  } finally {
    fs.closeSync(fd);
  }
}
function candidateDigest(archive) {
  const index = JSON.parse(
    readTarEntry(archive, 'index.json').toString('utf8'),
  );
  if (
    index.schemaVersion !== 2 ||
    !Array.isArray(index.manifests) ||
    index.manifests.length !== 1
  )
    throw new Error('Expected exactly one OCI release candidate');
  const digest = index.manifests[0].digest;
  if (typeof digest !== 'string' || !/^sha256:[a-f\d]{64}$/.test(digest))
    throw new Error('Invalid candidate digest');
  const content = readTarEntry(archive, `blobs/sha256/${digest.slice(7)}`);
  if (
    `sha256:${nodeCrypto.createHash('sha256').update(content).digest('hex')}` !==
    digest
  )
    throw new Error('Candidate manifest digest mismatch');
  return digest;
}
function inspectCandidate(archive, source) {
  const digest = candidateDigest(archive);
  const readBlob = (reference) => {
    if (
      typeof reference !== 'string' ||
      !/^sha256:[a-f\d]{64}$/.test(reference)
    )
      throw new Error('Invalid OCI blob digest');
    const content = readTarEntry(archive, `blobs/sha256/${reference.slice(7)}`);
    if (
      `sha256:${nodeCrypto.createHash('sha256').update(content).digest('hex')}` !==
      reference
    )
      throw new Error('OCI metadata digest mismatch');
    return JSON.parse(content.toString('utf8'));
  };
  const index = readBlob(digest);
  if (!Array.isArray(index.manifests))
    throw new Error('Candidate must retain its OCI index and attestations');
  const runtime = index.manifests.filter(
    (item) => item.platform?.os !== 'unknown',
  );
  if (
    runtime.length !== 1 ||
    runtime[0].platform?.os !== 'linux' ||
    runtime[0].platform?.architecture !== 'amd64'
  )
    throw new Error('Gate scans exactly one linux/amd64 runtime image');
  if (
    index.manifests.some(
      (item) =>
        item !== runtime[0] &&
        (item.platform?.os !== 'unknown' ||
          item.annotations?.['vnd.docker.reference.type'] !==
            'attestation-manifest'),
    )
  )
    throw new Error('Unrecognized candidate manifest');
  const image = readBlob(runtime[0].digest);
  if (!/^sha256:[a-f\d]{64}$/.test(image.config?.digest ?? ''))
    throw new Error('Candidate lacks an image config digest');
  const config = readBlob(image.config.digest);
  if (config.os !== 'linux' || config.architecture !== 'amd64')
    throw new Error('Runtime config platform differs');
  if (source) {
    validateSource(source);
    if (
      config.config?.Labels?.['org.opencontainers.image.revision'] !==
        source.sha ||
      config.config?.Labels?.['org.opencontainers.image.source'] !==
        source.repository
    )
      throw new Error(
        'Candidate source labels do not match the selected commit/repository',
      );
  }
  const attestations = {};
  for (const descriptor of index.manifests.filter(
    (item) =>
      item.annotations?.['vnd.docker.reference.type'] ===
      'attestation-manifest',
  )) {
    if (
      descriptor.annotations['vnd.docker.reference.digest'] !==
      runtime[0].digest
    )
      throw new Error('Attestation is not bound to the scanned runtime');
    for (const layer of readBlob(descriptor.digest).layers ?? []) {
      const predicate = layer.annotations?.['in-toto.io/predicate-type'];
      const statement = readBlob(layer.digest);
      if (
        statement._type !== 'https://in-toto.io/Statement/v0.1' &&
        statement._type !== 'https://in-toto.io/Statement/v1'
      )
        throw new Error('Unsupported attestation statement');
      if (
        statement.predicateType !== predicate ||
        !Array.isArray(statement.subject) ||
        (statement.subject.length > 0 &&
          !statement.subject.some(
            (subject) => subject.digest?.sha256 === runtime[0].digest.slice(7),
          ))
      )
        throw new Error('Attestation subject differs from runtime manifest');
      if (predicate === 'https://spdx.dev/Document') {
        if (
          attestations.sbom ||
          typeof statement.predicate?.spdxVersion !== 'string'
        )
          throw new Error('Missing or ambiguous SPDX SBOM');
        attestations.sbom = statement;
      }
      if (
        [
          'https://slsa.dev/provenance/v0.2',
          'https://slsa.dev/provenance/v1',
        ].includes(predicate)
      ) {
        if (attestations.provenance || !statement.predicate)
          throw new Error('Missing or ambiguous provenance');
        attestations.provenance = statement;
      }
    }
  }
  if (!attestations.sbom || !attestations.provenance)
    throw new Error(
      'Candidate must include SPDX SBOM and provenance attestations',
    );
  if (source) {
    const materials =
      attestations.provenance.predicate?.materials ??
      attestations.provenance.predicate?.buildDefinition
        ?.resolvedDependencies ??
      [];
    const vcs =
      attestations.provenance.predicate?.runDetails?.metadata?.buildkit_metadata
        ?.vcs ??
      attestations.provenance.predicate?.metadata?.[
        'https://mobyproject.org/buildkit@v1#metadata'
      ]?.vcs;
    const boundMaterial = materials.some(
      (item) =>
        Object.values(item.digest ?? {}).includes(source.sha) &&
        item.uri?.includes(source.repository.replace('https://', '')),
    );
    const boundVcs =
      vcs?.revision === source.sha &&
      vcs?.source?.replace(/\.git$/, '') === source.repository;
    if (!boundMaterial && !boundVcs)
      throw new Error(
        'Provenance does not identify the selected source commit/repository',
      );
  }
  return {
    digest,
    runtimeDigest: runtime[0].digest,
    imageId: image.config.digest,
    ...attestations,
  };
}
async function hashFile(filename) {
  const hash = nodeCrypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
async function scanCandidate(
  archive,
  output,
  { scanner = scannerDefault, runner = run, source } = {},
) {
  fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, 'vulnerabilities.json');
  if (
    fs.existsSync(reportPath) ||
    fs.existsSync(path.join(output, 'gate.json'))
  )
    throw new Error(
      'Use a fresh evidence directory; existing scan evidence cannot be reused',
    );
  const candidateInfo = inspectCandidate(archive, source);
  const digest = candidateInfo.digest;
  const archiveHash = await hashFile(archive);
  runner('docker', ['pull', scanner]);
  const scannerId = runner(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', scanner],
    true,
  );
  if (!/^sha256:[a-f\d]{64}$/.test(scannerId))
    throw new Error('Invalid scanner image ID');
  const cache = path.resolve(
    process.env.RELEASE_SCAN_CACHE || '.release-check/trivy-cache',
  );
  fs.mkdirSync(cache, { recursive: true });
  const mount = [
    'run',
    '--rm',
    '--mount',
    `type=bind,source=${output},target=/evidence`,
    '--mount',
    `type=bind,source=${cache},target=/root/.cache/trivy`,
  ];
  const scannerVersion = runner(
    'docker',
    ['run', '--rm', scannerId, '--version'],
    true,
  );
  // Trivy reads Docker tar archives or OCI layout directories, not OCI tar
  // archives. Unpack with the scanner's own tar utility in an isolated container.
  const layout = path.join(
    path.dirname(archive),
    `scan-layout-${nodeCrypto.randomUUID()}`,
  );
  const target = path.resolve(layout);
  if (
    path.dirname(target) !== path.resolve(path.dirname(archive)) ||
    !/^scan-layout-[a-f\d-]{36}$/.test(path.basename(target))
  )
    throw new Error('Unsafe scratch cleanup path');
  fs.mkdirSync(layout);
  try {
    const extractUser =
      typeof process.getuid === 'function'
        ? `${process.getuid()}:${process.getgid()}`
        : '0:0';
    runner('docker', [
      'run',
      '--rm',
      '--user',
      extractUser,
      '--network',
      'none',
      '--entrypoint',
      'tar',
      '--mount',
      `type=bind,source=${archive},target=/archive/image.tar,readonly`,
      '--mount',
      `type=bind,source=${layout},target=/layout`,
      scannerId,
      '--no-same-owner',
      '-xf',
      '/archive/image.tar',
      '-C',
      '/layout',
    ]);
    if (
      !fs
        .readFileSync(path.join(layout, 'index.json'))
        .equals(readTarEntry(archive, 'index.json'))
    )
      throw new Error('Extracted OCI index differs from candidate');
    runner('docker', [
      ...mount,
      '--mount',
      `type=bind,source=${layout},target=/image,readonly`,
      scannerId,
      'image',
      '--input',
      '/image',
      '--scanners',
      'vuln',
      '--list-all-pkgs',
      '--timeout',
      '5m',
      '--ignorefile',
      '/dev/null',
      '--format',
      'json',
      '--output',
      '/evidence/vulnerabilities.json',
      '--exit-code',
      '0',
    ]);
  } finally {
    // Delete only this run's newly created layout, never the input archive.
    fs.rmSync(target, { recursive: true, force: true });
  }
  if (archiveHash !== (await hashFile(archive)))
    throw new Error('Release candidate changed during scanning');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.Metadata?.ImageID !== candidateInfo.imageId)
    throw new Error('Scanner report does not identify the candidate runtime');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const gate = evaluate(report, policy);
  fs.writeFileSync(
    path.join(output, 'sbom.spdx.json'),
    JSON.stringify(candidateInfo.sbom.predicate, null, 2),
  );
  fs.writeFileSync(
    path.join(output, 'provenance.json'),
    JSON.stringify(candidateInfo.provenance, null, 2),
  );
  fs.writeFileSync(
    path.join(output, 'candidate.json'),
    JSON.stringify(
      {
        digest,
        source,
        imageId: candidateInfo.imageId,
        runtimeDigest: candidateInfo.runtimeDigest,
        archiveSha256: archiveHash,
        sbomSha256: await hashFile(path.join(output, 'sbom.spdx.json')),
        provenanceSha256: await hashFile(path.join(output, 'provenance.json')),
        reportSha256: await hashFile(reportPath),
        scannerId,
        scannerVersion,
        policySha256: nodeCrypto
          .createHash('sha256')
          .update(fs.readFileSync(policyPath))
          .digest('hex'),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(output, 'gate.json'),
    JSON.stringify(gate, null, 2),
  );
  // Conversion uses the pinned scanner instance, not a newly pulled tag.
  runner('docker', [
    'run',
    '--rm',
    '--mount',
    `type=bind,source=${output},target=/evidence`,
    scannerId,
    'convert',
    '--format',
    'sarif',
    '--output',
    '/evidence/vulnerabilities.sarif',
    '/evidence/vulnerabilities.json',
  ]);
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'sarif=true\n');
  const lines = [
    '# Release vulnerability gate',
    '',
    `Candidate: \`${digest}\``,
    '',
    `Gate: **${gate.allowed ? 'PASS' : 'BLOCKED'}**`,
    '',
    `Critical blockers: ${gate.blocked.length}; total findings: ${gate.findings.length}.`,
    '',
    '| Severity | Vulnerability | Package | Installed | Fixed | Exception |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const escape = (value) => String(value ?? 'none').replace(/[|\r\n`]/g, ' ');
  for (const finding of gate.findings.filter((item) =>
    ['HIGH', 'CRITICAL'].includes(item.severity),
  ))
    lines.push(
      `| ${[finding.severity, finding.vulnerabilityId, finding.packageName, finding.installedVersion, finding.fixedVersion, finding.exception ? `${finding.exception.owner}; expires ${finding.exception.expiresOn}` : 'none'].map(escape).join(' | ')} |`,
    );
  fs.writeFileSync(path.join(output, 'summary.md'), `${lines.join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  console.log(
    `Release gate ${gate.allowed ? 'passed' : 'BLOCKED'}; evidence: ${output}`,
  );
  if (!gate.allowed)
    throw new Error(
      `${gate.blocked.length} unexcepted critical finding(s) block publication`,
    );
  return gate;
}

async function verify(archive, output, { source } = {}) {
  if (fs.existsSync(path.join(output, 'failure.json')))
    throw new Error(
      'Release verification previously failed; use fresh evidence',
    );
  const candidate = object(
    JSON.parse(fs.readFileSync(path.join(output, 'candidate.json'), 'utf8')),
    'candidate evidence',
  );
  validateSource(source ?? candidate.source);
  const info = inspectCandidate(archive, source ?? candidate.source);
  if (
    candidate.imageId !== info.imageId ||
    candidate.runtimeDigest !== info.runtimeDigest
  )
    throw new Error('Candidate runtime evidence changed');
  if (source && JSON.stringify(source) !== JSON.stringify(candidate.source))
    throw new Error('Source evidence changed');
  {
    const smoke = JSON.parse(
      fs.readFileSync(path.join(output, 'smoke.json'), 'utf8'),
    );
    if (
      smoke.passed !== true ||
      smoke.archiveSha256 !== candidate.archiveSha256 ||
      smoke.digest !== candidate.digest ||
      smoke.imageId !== info.imageId ||
      JSON.stringify(smoke.source) !== JSON.stringify(candidate.source)
    )
      throw new Error('Smoke evidence does not match candidate');
  }
  for (const [file, hash] of [
    ['sbom.spdx.json', candidate.sbomSha256],
    ['provenance.json', candidate.provenanceSha256],
  ]) {
    if (!hash || hash !== (await hashFile(path.join(output, file))))
      throw new Error('Attestation evidence changed');
  }
  const policy = fs.readFileSync(policyPath);
  const reportPath = path.join(output, 'vulnerabilities.json');
  if (
    candidate.archiveSha256 !== (await hashFile(archive)) ||
    candidate.digest !== candidateDigest(archive)
  )
    throw new Error('Candidate does not match the scanned artifact');
  if (
    JSON.parse(fs.readFileSync(reportPath, 'utf8')).Metadata?.ImageID !==
    info.imageId
  )
    throw new Error('Scan runtime identity differs');
  if (candidate.reportSha256 !== (await hashFile(reportPath)))
    throw new Error('Scan evidence changed');
  if (
    candidate.policySha256 !==
    nodeCrypto.createHash('sha256').update(policy).digest('hex')
  )
    throw new Error('Exception policy changed; rescan before publication');
  if (
    !evaluate(
      JSON.parse(fs.readFileSync(reportPath, 'utf8')),
      JSON.parse(policy),
    ).allowed
  )
    throw new Error(
      'Critical findings or expired exceptions block publication',
    );
  return candidate.digest;
}

async function scan(archive, output, options) {
  try {
    return await scanCandidate(archive, output, options);
  } catch (error) {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, 'failure.json'),
      JSON.stringify({ allowed: false, error: error.message }, null, 2) + '\n',
    );
    const summary = `# Release candidate blocked\n\n${error.message}\n`;
    fs.writeFileSync(path.join(output, 'failure.md'), summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    throw error;
  }
}
function validateSource(source) {
  if (
    !/^[a-f0-9]{40}$/.test(source?.sha ?? '') ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
      source?.repository ?? '',
    )
  )
    throw new Error('Expected full source SHA and GitHub repository URL');
}
async function smoke(archive, output, { runner = run, source } = {}) {
  validateSource(source);
  fs.mkdirSync(output, { recursive: true });
  const record = path.join(output, 'smoke.json');
  fs.writeFileSync(record, JSON.stringify({ passed: false, source }) + '\n');
  const info = inspectCandidate(archive, source);
  const archiveSha256 = await hashFile(archive);
  // The original OCI archive is retained for publication with its attestations.
  // A containerd image store is required; the workflow configures it explicitly.
  runner('docker', ['load', '--input', archive]);
  const loaded = runner(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', info.digest],
    true,
  );
  if (loaded !== info.digest && loaded !== info.imageId)
    throw new Error('Loaded image differs from candidate');
  runner('bash', [
    '-c',
    'export SMOKE_IMAGE="$1"; bash .github/scripts/ci-smoke.sh',
    '_',
    loaded,
  ]);
  if (archiveSha256 !== (await hashFile(archive)))
    throw new Error('Candidate changed during smoke testing');
  const evidence = {
    passed: true,
    source,
    digest: info.digest,
    imageId: info.imageId,
    archiveSha256,
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(record, JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}
async function main(args) {
  const [mode, archive, output] = args;
  if (!['smoke', 'scan', 'verify'].includes(mode) || args.length !== 3)
    throw new Error(
      'Usage: release-candidate.cjs <smoke|scan|verify> <OCI archive> <evidence directory>',
    );
  const source = {
    sha: process.env.RELEASE_SHA,
    repository: process.env.RELEASE_SOURCE,
  };
  validateSource(source);
  const options = {
    source,
    scanner: process.env.TRIVY_SCANNER_IMAGE || scannerDefault,
  };
  if (mode === 'smoke')
    return smoke(path.resolve(archive), path.resolve(output), options);
  if (mode === 'scan')
    return scan(path.resolve(archive), path.resolve(output), options);
  console.log(
    await verify(path.resolve(archive), path.resolve(output), options),
  );
}
module.exports = {
  run,
  readTarEntry,
  candidateDigest,
  inspectCandidate,
  hashFile,
  scan,
  verify,
  smoke,
  validateSource,
  main,
};
if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Release candidate blocked: ${error.message}`);
    process.exitCode = 1;
  });

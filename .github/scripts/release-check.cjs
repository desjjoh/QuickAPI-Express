'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const severities = new Set(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048)
    throw new Error(`${label} must be a bounded non-empty string`);
  return value;
}
function key(value) {
  return JSON.stringify([
    value.vulnerabilityId,
    value.packageName,
    value.installedVersion,
    value.packagePath,
    value.target,
    value.type,
  ]);
}
function evaluate(report, policy, now = new Date()) {
  object(report, 'scan report');
  if (
    report.SchemaVersion !== 2 ||
    report.ArtifactType !== 'container_image' ||
    !Array.isArray(report.Results)
  )
    throw new Error('Unsupported or incomplete Trivy image report');
  const metadata = object(report.Metadata, 'image metadata');
  text(metadata.ImageID, 'image ID');
  const os = object(metadata.OS, 'detected image OS');
  text(os.Family, 'OS family');
  text(os.Name, 'OS version');
  if (
    !report.Results.some(
      (result) =>
        result.Class === 'os-pkgs' &&
        Array.isArray(result.Packages) &&
        result.Packages.length > 0,
    )
  )
    throw new Error('Image OS packages were not scanned');
  if (
    !report.Results.some(
      (result) =>
        result.Class === 'lang-pkgs' &&
        result.Type === 'node-pkg' &&
        Array.isArray(result.Packages) &&
        result.Packages.length > 0,
    )
  )
    throw new Error('Node packages were not scanned');
  if (os.EOSL === true || os.Family === 'unknown')
    throw new Error('Image OS is unsupported or end-of-life');
  object(policy, 'exception policy');
  if (policy.version !== 1 || !Array.isArray(policy.exceptions))
    throw new Error('Unsupported exception policy');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error('Invalid gate clock');
  const rules = new Map();
  for (const entry of policy.exceptions) {
    object(entry, 'exception');
    for (const field of [
      'vulnerabilityId',
      'packageName',
      'installedVersion',
      'target',
      'type',
      'owner',
      'reason',
      'review',
    ]) {
      text(entry[field], `exception ${field}`);
      if (
        [
          'vulnerabilityId',
          'packageName',
          'installedVersion',
          'target',
          'type',
        ].includes(field) &&
        entry[field].includes('*')
      )
        throw new Error('Exception scopes cannot contain wildcards');
    }
    if (entry.packagePath !== null) {
      text(entry.packagePath, 'exception packagePath');
      if (entry.packagePath.includes('*'))
        throw new Error('Exception scopes cannot contain wildcards');
    }
    if (
      typeof entry.expiresOn !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn)
    )
      throw new Error('Invalid exception expiry');
    const expiry = new Date(`${entry.expiresOn}T00:00:00.000Z`);
    if (
      !Number.isFinite(expiry.getTime()) ||
      expiry.toISOString().slice(0, 10) !== entry.expiresOn
    )
      throw new Error('Invalid exception expiry');
    if (expiry <= now) throw new Error('Expired exception');
    if (expiry.getTime() - now.getTime() > 30 * 86400000)
      throw new Error('Exception expiry exceeds 30 days');
    if (rules.has(key(entry))) throw new Error('Duplicate exception scope');
    rules.set(key(entry), { ...entry, expired: expiry <= now });
  }
  const findings = [];
  for (const result of report.Results) {
    object(result, 'scan result');
    text(result.Target, 'result target');
    text(result.Type, 'result type');
    if (
      result.Vulnerabilities !== undefined &&
      !Array.isArray(result.Vulnerabilities)
    )
      throw new Error('Malformed vulnerability list');
    for (const vulnerability of result.Vulnerabilities ?? []) {
      object(vulnerability, 'vulnerability');
      for (const field of ['VulnerabilityID', 'PkgName', 'InstalledVersion'])
        text(vulnerability[field], field);
      if (!severities.has(vulnerability.Severity))
        throw new Error('Invalid vulnerability severity');
      const finding = {
        vulnerabilityId: vulnerability.VulnerabilityID,
        packageName: vulnerability.PkgName,
        installedVersion: vulnerability.InstalledVersion,
        target: result.Target,
        type: result.Type,
        packagePath: vulnerability.PkgPath ?? null,
        severity: vulnerability.Severity,
        fixedVersion: vulnerability.FixedVersion ?? null,
      };
      if (finding.packagePath !== null)
        text(finding.packagePath, 'package path');
      const exception = rules.get(key(finding));
      findings.push({
        ...finding,
        exception: exception && !exception.expired ? exception : null,
      });
    }
  }
  const blocked = findings.filter(
    (finding) => finding.severity === 'CRITICAL' && !finding.exception,
  );
  return {
    allowed: blocked.length === 0,
    blocked,
    findings,
    expiredExceptions: [...rules.values()].filter((rule) => rule.expired),
    evaluatedAt: now.toISOString(),
  };
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

function archiveIdentity(archive, imageId) {
  if (!digestPattern.test(imageId))
    throw new Error('Invalid immutable image ID');
  const manifests = JSON.parse(
    readTarEntry(archive, 'manifest.json').toString('utf8'),
  );
  if (!Array.isArray(manifests) || manifests.length !== 1)
    throw new Error('Expected exactly one exported runtime image');
  const configPath = manifests[0].Config;
  if (
    typeof configPath !== 'string' ||
    !/^(?:blobs\/sha256\/)?[a-f0-9]{64}(?:\.json)?$/.test(configPath)
  )
    throw new Error('Invalid exported config path');
  const config = readTarEntry(archive, configPath);
  const configId = `sha256:${nodeCrypto.createHash('sha256').update(config).digest('hex')}`;
  if (!configPath.includes(configId.slice(7)))
    throw new Error('Exported config digest mismatch');
  const runtime = JSON.parse(config.toString('utf8'));
  if (runtime.os !== 'linux' || runtime.architecture !== 'amd64')
    throw new Error('Expected a linux/amd64 runtime image');

  // Classic Docker IDs identify the config; modern stores may identify an OCI index.
  function reachesConfig(digest, depth = 0) {
    if (!digestPattern.test(digest) || depth > 3)
      throw new Error('Invalid exported image descriptor');
    const body = readTarEntry(archive, `blobs/sha256/${digest.slice(7)}`);
    if (
      `sha256:${nodeCrypto.createHash('sha256').update(body).digest('hex')}` !==
      digest
    )
      throw new Error('Exported manifest digest mismatch');
    const value = JSON.parse(body.toString('utf8'));
    if (value.config) return value.config.digest === configId;
    const images = value.manifests?.filter(
      (entry) => entry.platform?.os !== 'unknown',
    );
    return images?.length === 1 && reachesConfig(images[0].digest, depth + 1);
  }
  if (imageId !== configId && !reachesConfig(imageId))
    throw new Error('Archive does not match the selected image');
  return configId;
}

function fileHash(filename) {
  const hash = nodeCrypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(filename, 'r');
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    timeout: 7 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0)
    throw new Error(
      `${command} failed or timed out${result.status === null ? '' : ` (exit ${result.status})`}`,
    );
  return capture ? result.stdout.trim() : '';
}

function scan(
  image,
  output,
  {
    runner = run,
    root = path.resolve(__dirname, '../..'),
    scanner = process.env.TRIVY_SCANNER_IMAGE || 'aquasec/trivy:latest',
    now = new Date(),
  } = {},
) {
  output = path.resolve(output);
  fs.mkdirSync(output, { recursive: true });
  const archive = path.join(output, 'image.tar');
  const reportPath = path.join(output, 'vulnerabilities.json');
  const resultPath = path.join(output, 'result.json');
  const summaryPath = path.join(output, 'summary.md');
  fs.writeFileSync(
    resultPath,
    JSON.stringify({ allowed: false, error: 'Scan did not complete' }) + '\n',
  );
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ error: 'Scan did not complete' }) + '\n',
  );
  fs.writeFileSync(
    path.join(output, 'image.json'),
    JSON.stringify({ imageId: image, verified: false }) + '\n',
  );
  let gate;
  let identity;
  try {
    if (!digestPattern.test(image))
      throw new Error(
        'Scan requires the immutable image ID used by smoke testing',
      );
    const inspected = JSON.parse(
      runner(
        'docker',
        ['image', 'inspect', '--format', '{{json .}}', image],
        true,
      ),
    );
    if (inspected.Id !== image)
      throw new Error('Inspected image identity changed');
    runner('docker', ['image', 'save', '--output', archive, image]);
    const configId = archiveIdentity(archive, image);
    const archiveHash = fileHash(archive);
    runner('docker', ['pull', scanner]);
    const scannerId = runner(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', scanner],
      true,
    );
    if (!digestPattern.test(scannerId))
      throw new Error('Scanner identity unavailable');
    const scannerVersion = runner(
      'docker',
      ['run', '--rm', scannerId, '--version'],
      true,
    );
    text(scannerVersion, 'scanner version');
    const cache = path.join(root, '.release-check/trivy-cache');
    fs.mkdirSync(cache, { recursive: true });
    identity = {
      imageId: image,
      configId,
      archiveHash,
      scannerId,
      scannerVersion,
      sourceCommit: process.env.GITHUB_SHA ?? null,
    };
    fs.writeFileSync(
      path.join(output, 'image.json'),
      JSON.stringify(identity, null, 2) + '\n',
    );
    runner('docker', [
      'run',
      '--rm',
      '--mount',
      `type=bind,src=${archive},dst=/input/image.tar,readonly`,
      '--mount',
      `type=bind,src=${output},dst=/evidence`,
      '--mount',
      `type=bind,src=${cache},dst=/cache`,
      scannerId,
      'image',
      '--input',
      '/input/image.tar',
      '--cache-dir',
      '/cache',
      '--scanners',
      'vuln',
      '--list-all-pkgs',
      '--format',
      'json',
      '--output',
      '/evidence/vulnerabilities.json',
      '--exit-code',
      '0',
      '--timeout',
      '5m',
    ]);
    if (fileHash(archive) !== archiveHash)
      throw new Error('Image archive changed during scanning');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.Metadata?.ImageID !== configId)
      throw new Error('Scanner report identifies another runtime image');
    const policy = JSON.parse(
      fs.readFileSync(
        path.join(root, 'security/container-vulnerability-exceptions.json'),
        'utf8',
      ),
    );
    gate = { ...evaluate(report, policy, now), ...identity };
    fs.writeFileSync(resultPath, JSON.stringify(gate, null, 2) + '\n');
    const counts = Object.fromEntries(
      [...severities].map((severity) => [
        severity,
        gate.findings.filter((finding) => finding.severity === severity).length,
      ]),
    );
    const summary = [
      '# Runtime image security',
      '',
      `Gate: **${gate.allowed ? 'passed' : 'BLOCKED'}**. Only unexcepted critical findings block by severity.`,
      `Image: \`${image}\``,
      `Config: \`${configId}\``,
      `Findings: ${JSON.stringify(counts)}`,
      '',
      ...gate.findings.map(
        (finding) =>
          `- ${finding.exception ? 'EXCEPTED' : finding.severity === 'CRITICAL' ? 'BLOCKED' : 'REPORTED'} ${finding.severity}: ${finding.vulnerabilityId} ${finding.packageName}@${finding.installedVersion}; fix: ${finding.fixedVersion ?? 'unavailable'}`,
      ),
      '',
    ].join('\n');
    fs.writeFileSync(summaryPath, summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    console.log(
      `Image security ${gate.allowed ? 'passed' : 'BLOCKED'}: ${gate.blocked.length} critical blocker(s); ${gate.findings.length} total finding(s).`,
    );
    return gate;
  } catch (error) {
    fs.writeFileSync(
      resultPath,
      JSON.stringify(
        { ...identity, ...gate, allowed: false, error: error.message },
        null,
        2,
      ) + '\n',
    );
    fs.writeFileSync(
      summaryPath,
      `# Runtime image security\n\nBLOCKED: ${error.message}\n`,
    );
    throw error;
  } finally {
    fs.rmSync(archive, { force: true });
  }
}

if (require.main === module) {
  try {
    const [mode, image, output] = process.argv.slice(2);
    if (mode !== 'image' || !image || !output || process.argv.length !== 5)
      throw new Error(
        'Usage: release-check.cjs image <immutable image ID> <evidence directory>',
      );
    if (!scan(image, output).allowed) process.exitCode = 1;
  } catch (error) {
    console.error(`Image security blocked: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { evaluate, archiveIdentity, scan };

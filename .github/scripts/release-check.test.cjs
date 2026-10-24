'use strict';

const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { evaluate, archiveIdentity, scan } = require('./release-check.cjs');

const now = new Date('2026-10-24T12:00:00Z');
const emptyPolicy = { version: 1, exceptions: [] };
const scannerId = `sha256:${'a'.repeat(64)}`;
const config = Buffer.from(
  JSON.stringify({ os: 'linux', architecture: 'amd64' }),
);
const digest = (value) =>
  `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const configId = digest(config);

function finding(severity = 'CRITICAL', changes = {}) {
  return {
    VulnerabilityID: 'CVE-2026-0001',
    PkgName: 'fixture',
    InstalledVersion: '1.0.0',
    Severity: severity,
    ...changes,
  };
}

function report(findings = []) {
  return {
    SchemaVersion: 2,
    ArtifactType: 'container_image',
    Metadata: { ImageID: configId, OS: { Family: 'alpine', Name: '3.22' } },
    Results: [
      {
        Target: 'fixture (alpine 3.22)',
        Class: 'os-pkgs',
        Type: 'alpine',
        Packages: [{ Name: 'musl' }],
        Vulnerabilities: findings,
      },
      {
        Target: 'app/package-lock.json',
        Class: 'lang-pkgs',
        Type: 'node-pkg',
        Packages: [{ Name: 'fixture' }],
      },
    ],
  };
}

function exception(changes = {}) {
  return {
    vulnerabilityId: 'CVE-2026-0001',
    packageName: 'fixture',
    installedVersion: '1.0.0',
    packagePath: null,
    target: 'fixture (alpine 3.22)',
    type: 'alpine',
    owner: 'reviewer',
    reason: 'Reviewed mitigation with an update scheduled',
    review: 'issue-123',
    expiresOn: '2026-11-01',
    ...changes,
  };
}

nodeTest(
  'only critical image findings block; every severity remains visible',
  () => {
    for (const severity of ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
      const result = evaluate(report([finding(severity)]), emptyPolicy, now);
      assert.equal(result.allowed, severity !== 'CRITICAL');
      assert.equal(result.findings[0].severity, severity);
    }
    assert.equal(
      evaluate(
        report([finding('CRITICAL', { FixedVersion: undefined })]),
        emptyPolicy,
        now,
      ).allowed,
      false,
    );
  },
);

nodeTest('critical Node package findings block as well as OS findings', () => {
  const value = report();
  value.Results[1].Vulnerabilities = [finding()];
  assert.equal(evaluate(value, emptyPolicy, now).allowed, false);
});

nodeTest('an exact reviewed exception retains the critical finding', () => {
  const result = evaluate(
    report([finding()]),
    { version: 1, exceptions: [exception()] },
    now,
  );
  assert.equal(result.allowed, true);
  assert.equal(result.findings[0].exception.owner, 'reviewer');
});

for (const field of [
  'vulnerabilityId',
  'packageName',
  'installedVersion',
  'packagePath',
  'target',
  'type',
]) {
  nodeTest(`image exceptions cannot exempt another ${field}`, () => {
    const result = evaluate(
      report([finding()]),
      { version: 1, exceptions: [exception({ [field]: 'different' })] },
      now,
    );
    assert.equal(result.allowed, false);
  });
}

nodeTest(
  'malformed, expired, wildcard, duplicate, or overlong exceptions fail closed',
  () => {
    for (const change of [
      { owner: '' },
      { reason: '' },
      { review: '' },
      { packageName: '*' },
      { packagePath: '*' },
      { expiresOn: '2026-10-24' },
      { expiresOn: '2026-12-01' },
      { expiresOn: '2026-02-30' },
    ]) {
      assert.throws(() =>
        evaluate(
          report(),
          { version: 1, exceptions: [exception(change)] },
          now,
        ),
      );
    }
    assert.throws(
      () =>
        evaluate(
          report(),
          { version: 1, exceptions: [exception(), exception()] },
          now,
        ),
      /Duplicate/,
    );
  },
);

nodeTest(
  'missing OS/Node package inventories, unsupported reports, and EOL OS fail',
  () => {
    const missingPackages = report();
    missingPackages.Results[1].Packages = [];
    for (const value of [
      null,
      {},
      { ...report(), SchemaVersion: 1 },
      { ...report(), Results: [report().Results[0]] },
      { ...report(), Results: [report().Results[1]] },
      missingPackages,
      {
        ...report(),
        Metadata: {
          ImageID: configId,
          OS: { Family: 'alpine', Name: '3.1', EOSL: true },
        },
      },
      report([finding('NOT_REAL')]),
    ]) {
      assert.throws(() => evaluate(value, emptyPolicy, now));
    }
  },
);

function fixtureArchive(filename, modern = false) {
  const configPath = `blobs/sha256/${configId.slice(7)}`;
  const entries = [[configPath, config]];
  const blob = (value) => {
    const body = Buffer.from(JSON.stringify(value));
    const id = digest(body);
    entries.push([`blobs/sha256/${id.slice(7)}`, body]);
    return id;
  };
  let imageId = configId;
  if (modern) {
    const runtime = blob({ schemaVersion: 2, config: { digest: configId } });
    imageId = blob({
      schemaVersion: 2,
      manifests: [
        { digest: runtime, platform: { os: 'linux', architecture: 'amd64' } },
      ],
    });
  }
  entries.push([
    'manifest.json',
    Buffer.from(JSON.stringify([{ Config: configPath, Layers: [] }])),
  ]);
  const tar = [];
  for (const [name, body] of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100, 8);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257, 6);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    tar.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  tar.push(Buffer.alloc(1024));
  fs.writeFileSync(filename, Buffer.concat(tar));
  return imageId;
}

function withFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'express-image-gate-'));
  try {
    fs.mkdirSync(path.join(root, 'security'));
    fs.writeFileSync(
      path.join(root, 'security/container-vulnerability-exceptions.json'),
      JSON.stringify(emptyPolicy),
    );
    callback(root);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
}

nodeTest(
  'classic and OCI-index Docker identities bind to the exported runtime config',
  () =>
    withFixture((root) => {
      const filename = path.join(root, 'fixture.tar');
      for (const modern of [false, true]) {
        const imageId = fixtureArchive(filename, modern);
        assert.equal(archiveIdentity(filename, imageId), configId);
        assert.throws(() =>
          archiveIdentity(filename, `sha256:${'b'.repeat(64)}`),
        );
      }
    }),
);

function fakeRunner(root, value = report(), fault = '') {
  const output = path.join(root, 'evidence');
  const calls = [];
  const runner = (_command, args) => {
    calls.push(args);
    if (args[0] === 'image' && args[1] === 'inspect') {
      return args.at(-1) === configId
        ? JSON.stringify({ Id: configId })
        : scannerId;
    }
    if (args[0] === 'image' && args[1] === 'save') fixtureArchive(args[3]);
    if (args.includes('--version')) return 'Trivy fixture';
    if (args.includes('--input')) {
      if (fault === 'scanner') throw new Error('scanner unavailable');
      if (fault === 'tamper')
        fs.appendFileSync(path.join(output, 'image.tar'), 'changed');
      fs.writeFileSync(
        path.join(output, 'vulnerabilities.json'),
        fault === 'json' ? 'invalid-json' : JSON.stringify(value),
      );
    }
    return '';
  };
  return { output, calls, runner };
}

nodeTest(
  'the pinned image is exported once; reports bind identity and retain every finding',
  () =>
    withFixture((root) => {
      const mock = fakeRunner(root, report([finding('HIGH')]));
      const result = scan(configId, mock.output, {
        root,
        now,
        runner: mock.runner,
      });
      assert.equal(result.allowed, true);
      assert.equal(result.imageId, configId);
      assert.equal(result.scannerId, scannerId);
      assert.equal(result.findings.length, 1);
      assert.equal(mock.calls.filter((args) => args[1] === 'save').length, 1);
      assert.equal(
        mock.calls.some((args) => args.includes('--ignore-unfixed')),
        false,
      );
      assert.equal(
        mock.calls.some(
          (args) => args.includes('--input') && args.includes(scannerId),
        ),
        true,
      );
      assert.equal(fs.existsSync(path.join(mock.output, 'image.tar')), false);
      assert.match(
        fs.readFileSync(path.join(mock.output, 'summary.md'), 'utf8'),
        /REPORTED HIGH/,
      );
    }),
);

nodeTest('critical blockers retain raw reports and a failing decision', () =>
  withFixture((root) => {
    const mock = fakeRunner(root, report([finding()]));
    const result = scan(configId, mock.output, {
      root,
      now,
      runner: mock.runner,
    });
    assert.equal(result.allowed, false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(mock.output, 'result.json')))
        .allowed,
      false,
    );
    assert.match(
      fs.readFileSync(path.join(mock.output, 'vulnerabilities.json'), 'utf8'),
      /CRITICAL/,
    );
  }),
);

for (const fault of ['scanner', 'tamper', 'json']) {
  nodeTest(
    `${fault} failure prevents approval and removes only the temporary archive`,
    () =>
      withFixture((root) => {
        const mock = fakeRunner(root, report(), fault);
        assert.throws(() =>
          scan(configId, mock.output, { root, now, runner: mock.runner }),
        );
        assert.equal(
          JSON.parse(fs.readFileSync(path.join(mock.output, 'result.json')))
            .allowed,
          false,
        );
        assert.equal(fs.existsSync(path.join(mock.output, 'image.tar')), false);
      }),
  );
}

nodeTest('a scanner report for another runtime image cannot pass', () =>
  withFixture((root) => {
    const value = report();
    value.Metadata.ImageID = scannerId;
    const mock = fakeRunner(root, value);
    assert.throws(
      () => scan(configId, mock.output, { root, now, runner: mock.runner }),
      /another runtime/,
    );
  }),
);

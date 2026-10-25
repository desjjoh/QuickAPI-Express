'use strict';
const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const {
  candidateDigest,
  inspectCandidate,
  scan: scanCandidate,
  verify,
  run,
  main,
  smoke,
} = require('./release-candidate.cjs');
const { publish } = require('./release-publish.cjs');
delete process.env.GITHUB_OUTPUT;
delete process.env.GITHUB_STEP_SUMMARY;
const source = {
  sha: 'a'.repeat(40),
  repository: 'https://github.com/fixture/app',
};
const config = {
  os: 'linux',
  architecture: 'amd64',
  config: {
    Labels: {
      'org.opencontainers.image.revision': source.sha,
      'org.opencontainers.image.source': source.repository,
    },
  },
};
const imageId = `sha256:${nodeCrypto.createHash('sha256').update(JSON.stringify(config)).digest('hex')}`;
function finding(severity = 'CRITICAL') {
  return {
    VulnerabilityID: 'CVE-2026-0001',
    PkgName: 'fixture',
    InstalledVersion: '1.0.0',
    Severity: severity,
  };
}
function report(vulnerabilities = []) {
  return {
    SchemaVersion: 2,
    ArtifactType: 'container_image',
    Metadata: { ImageID: imageId, OS: { Family: 'alpine', Name: '3.24' } },
    Results: [
      {
        Target: 'fixture (alpine 3.24)',
        Class: 'os-pkgs',
        Type: 'alpine',
        Packages: [{ Name: 'musl' }],
        Vulnerabilities: vulnerabilities,
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
async function scan(archive, output, options) {
  if (!fs.existsSync(path.join(output, 'smoke.json')))
    await smoke(archive, output, { ...options, source });
  return scanCandidate(archive, output, { ...options, source });
}
function archiveFixture(
  directory,
  {
    noProvenance = false,
    secondRuntime = false,
    noSbom = false,
    wrongSubject = false,
    wrongBinding = false,
    wrongSource = false,
    modern = false,
  } = {},
) {
  const entries = [];
  const blob = (value) => {
    const body = Buffer.from(JSON.stringify(value));
    const digest = `sha256:${nodeCrypto.createHash('sha256').update(body).digest('hex')}`;
    entries.push([`blobs/sha256/${digest.slice(7)}`, body]);
    return digest;
  };
  blob(config);
  const runtime = blob({
    schemaVersion: 2,
    config: { digest: imageId },
    layers: [],
  });
  const statement = {
    _type: 'https://in-toto.io/Statement/v0.1',
    subject: modern
      ? []
      : [
          {
            name: 'fixture',
            digest: {
              sha256: wrongSubject ? 'f'.repeat(64) : runtime.slice(7),
            },
          },
        ],
  };
  const sbom = blob({
    ...statement,
    predicateType: 'https://spdx.dev/Document',
    predicate: { spdxVersion: 'SPDX-2.3', name: 'fixture' },
  });
  const provenance = blob({
    ...statement,
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildType: 'fixture',
      ...(modern
        ? {
            runDetails: {
              metadata: {
                buildkit_metadata: {
                  vcs: {
                    revision: source.sha,
                    source: source.repository + '.git',
                  },
                },
              },
            },
          }
        : {}),
      materials: [
        {
          uri: 'git+https://github.com/fixture/app',
          digest: { sha1: wrongSource ? 'f'.repeat(40) : source.sha },
        },
      ],
    },
  });
  const layers = [
    {
      digest: sbom,
      annotations: { 'in-toto.io/predicate-type': 'https://spdx.dev/Document' },
    },
  ];
  if (noSbom) layers.length = 0;
  if (!noProvenance)
    layers.push({
      digest: provenance,
      annotations: {
        'in-toto.io/predicate-type': 'https://slsa.dev/provenance/v1',
      },
    });
  const attestation = blob({ schemaVersion: 2, layers });
  const manifests = [
    { digest: runtime, platform: { os: 'linux', architecture: 'amd64' } },
    {
      digest: attestation,
      platform: { os: 'unknown', architecture: 'unknown' },
      annotations: {
        'vnd.docker.reference.type': 'attestation-manifest',
        'vnd.docker.reference.digest': wrongBinding
          ? `sha256:${'e'.repeat(64)}`
          : runtime,
      },
    },
  ];
  if (secondRuntime)
    manifests.push({
      digest: runtime,
      platform: { os: 'linux', architecture: 'arm64' },
    });
  const digest = blob({ schemaVersion: 2, manifests });
  const index = Buffer.from(
    JSON.stringify({ schemaVersion: 2, manifests: [{ digest }] }),
  );
  entries.push(['index.json', index]);
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
  const archive = path.join(directory, 'candidate.tar');
  fs.writeFileSync(archive, Buffer.concat(tar));
  return { archive, digest, index };
}
function temporary(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'quickapi-release-test-'),
  );
  t.after(() => {
    if (
      path.dirname(directory) !== path.resolve(os.tmpdir()) ||
      !path.basename(directory).startsWith('quickapi-release-test-')
    )
      throw new Error('Unsafe test cleanup path');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function fakeScanner(fixture, output, vulnerabilities = [], failure = null) {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args.includes('--entrypoint')) {
      const layout = args
        .find((value) => value.includes('target=/layout'))
        .match(/source=(.*),target=/)[1];
      fs.writeFileSync(path.join(layout, 'index.json'), fixture.index);
    }
    if (args.includes('--version')) return 'Trivy fixture';
    if (args[0] === 'image' && args[1] === 'inspect')
      return args.at(-1) === fixture.digest
        ? fixture.digest
        : `sha256:${'b'.repeat(64)}`;
    if (args[0] === 'run' && args.includes('--input')) {
      if (failure) throw new Error(failure);
      fs.writeFileSync(
        path.join(output, 'vulnerabilities.json'),
        JSON.stringify(report(vulnerabilities)),
      );
    }
    return '';
  };
  return { runner, calls };
}

nodeTest(
  'validates OCI digest, single-platform scan coverage, and both attestations',
  (t) => {
    const directory = temporary(t);
    const fixture = archiveFixture(directory);
    assert.equal(candidateDigest(fixture.archive), fixture.digest);
    assert.equal(inspectCandidate(fixture.archive).imageId, imageId);
    assert.throws(
      () =>
        inspectCandidate(
          archiveFixture(directory, { noProvenance: true }).archive,
        ),
      /provenance/,
    );
    assert.throws(
      () =>
        inspectCandidate(
          archiveFixture(directory, { secondRuntime: true }).archive,
        ),
      /exactly one/,
    );
  },
);
nodeTest(
  'complete scan passes without publication and records bound evidence/SBOM',
  async (t) => {
    const directory = temporary(t);
    const fixture = archiveFixture(directory);
    const output = path.join(directory, 'evidence');
    const fake = fakeScanner(fixture, output);
    await scan(fixture.archive, output, { runner: fake.runner });
    assert.equal(await verify(fixture.archive, output), fixture.digest);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(output, 'sbom.spdx.json')))
        .spdxVersion,
      'SPDX-2.3',
    );
    const invocation = fake.calls.find(([, args]) =>
      args.includes('--input'),
    )[1];
    assert.equal(invocation.includes('--ignore-unfixed'), false);
    assert.equal(
      fake.calls.some(([, args]) => args.includes('push')),
      false,
    );
    await assert.rejects(
      scan(fixture.archive, output, { runner: fake.runner }),
      /fresh evidence/,
    );
  },
);
nodeTest(
  'scanner failure cannot yield passing gate evidence or publication',
  async (t) => {
    const directory = temporary(t);
    const fixture = archiveFixture(directory);
    const output = path.join(directory, 'evidence');
    const fake = fakeScanner(fixture, output, [], 'scanner unavailable');
    await assert.rejects(
      scan(fixture.archive, output, { runner: fake.runner }),
      /scanner unavailable/,
    );
    assert.equal(fs.existsSync(path.join(output, 'gate.json')), false);
  },
);
nodeTest(
  'critical scan retains reports before failing and publisher never runs',
  async (t) => {
    const directory = temporary(t);
    const fixture = archiveFixture(directory);
    const output = path.join(directory, 'evidence');
    await assert.rejects(
      scan(fixture.archive, output, {
        runner: fakeScanner(fixture, output, [finding()]).runner,
      }),
      /block publication|previously failed/,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(output, 'gate.json'))).allowed,
      false,
    );
    let invoked = false;
    await assert.rejects(
      publish(fixture.archive, output, {
        runner: () => {
          invoked = true;
        },
      }),
      /block publication|previously failed/,
    );
    assert.equal(invoked, false);
  },
);
for (const tamper of ['archive', 'report'])
  nodeTest(`changed ${tamper} cannot be published`, async (t) => {
    const directory = temporary(t);
    const fixture = archiveFixture(directory);
    const output = path.join(directory, 'evidence');
    await scan(fixture.archive, output, {
      runner: fakeScanner(fixture, output).runner,
    });
    fs.appendFileSync(
      tamper === 'archive'
        ? fixture.archive
        : path.join(output, 'vulnerabilities.json'),
      ' ',
    );
    await assert.rejects(
      verify(fixture.archive, output),
      /changed|does not match/,
    );
  });
nodeTest(
  'publication imports only the approved archive and copies tags by its immutable digest',
  async (t) => {
    const directory = temporary(t);
    const fixture = archiveFixture(directory);
    const output = path.join(directory, 'evidence');
    await scan(fixture.archive, output, {
      runner: fakeScanner(fixture, output).runner,
    });
    const dockerConfig = path.join(directory, 'docker-config.json');
    fs.writeFileSync(dockerConfig, '{}');
    const calls = [];
    const runner = (command, args) => {
      calls.push([command, args]);
      return args.includes('inspect')
        ? `sha256:${'c'.repeat(64)}`
        : args.includes('digest')
          ? fixture.digest
          : '';
    };
    await publish(fixture.archive, output, {
      image: 'registry.test/quickapi',
      tags: ['registry.test/quickapi:commit', 'registry.test/quickapi:1.3.0'],
      expectedDigest: fixture.digest,
      dockerConfig,
      runner,
    });
    assert.equal(calls.filter(([, args]) => args.includes('import')).length, 1);
    assert.equal(
      calls.some(([, args]) =>
        args.includes(`${'registry.test/quickapi'}@${fixture.digest}`),
      ),
      true,
    );
    assert.equal(
      calls.some(([, args]) => args.includes('build')),
      false,
    );
    assert.match(
      fs.readFileSync(path.join(output, 'release-image.env'), 'utf8'),
      new RegExp(fixture.digest),
    );
    let invoked = false;
    await assert.rejects(
      publish(fixture.archive, output, {
        expectedDigest: `sha256:${'d'.repeat(64)}`,
        runner: () => {
          invoked = true;
        },
      }),
      /digests differ/,
    );
    assert.equal(invoked, false);
  },
);
nodeTest(
  'registry digest mismatch prevents deployment reference and subsequent tags',
  async (t) => {
    const directory = temporary(t);
    const fixture = archiveFixture(directory);
    const output = path.join(directory, 'evidence');
    await scan(fixture.archive, output, {
      runner: fakeScanner(fixture, output).runner,
    });
    const dockerConfig = path.join(directory, 'docker-config.json');
    fs.writeFileSync(dockerConfig, '{}');
    await assert.rejects(
      publish(fixture.archive, output, {
        image: 'registry.test/app',
        tags: ['registry.test/app:sha'],
        expectedDigest: fixture.digest,
        dockerConfig,
        runner: (_command, args) =>
          args.includes('inspect') ? `sha256:${'c'.repeat(64)}` : 'different',
      }),
      /changed the approved/,
    );
    assert.equal(fs.existsSync(path.join(output, 'release-image.env')), false);
  },
);
nodeTest('process failures fail closed', () => {
  assert.throws(
    () => run(process.execPath, ['-e', 'process.exit(2)']),
    /exit 2/,
  );
});
nodeTest('unknown CLI modes fail before any Docker operation', async () => {
  await assert.rejects(main(['unknown']), /Usage/);
});
nodeTest(
  'workflow keeps publishing after the shared scan, without a second build or broad suppressions',
  () => {
    const workflow = fs.readFileSync(
      path.resolve(__dirname, '../workflows/release-image.yml'),
      'utf8',
    );
    assert.equal(
      (workflow.match(/docker\/build-push-action/g) ?? []).length,
      1,
    );
    assert.match(workflow, /push: false/);
    assert.match(workflow, /provenance: mode=max/);
    assert.match(workflow, /sbom: true/);
    assert.ok(
      workflow.indexOf('release-candidate.cjs scan') <
        workflow.indexOf('docker/login-action'),
    );
    assert.ok(
      workflow.indexOf('release-candidate.cjs scan') <
        workflow.indexOf('release-publish.cjs'),
    );
    assert.equal(workflow.includes('--ignore-unfixed'), false);
  },
);

nodeTest(
  'source labels and provenance cannot be rebound to a different commit',
  (t) => {
    const fixture = archiveFixture(temporary(t));
    assert.throws(
      () =>
        inspectCandidate(fixture.archive, { ...source, sha: 'b'.repeat(40) }),
      /source labels/,
    );
  },
);
nodeTest('failed smoke test cannot approve publication', async (t) => {
  const dir = temporary(t);
  const fixture = archiveFixture(dir);
  const output = path.join(dir, 'evidence');
  const fake = fakeScanner(fixture, output);
  await assert.rejects(
    smoke(fixture.archive, output, {
      source,
      runner: (cmd, args, capture) => {
        if (cmd === 'bash') throw Error('smoke failed');
        return fake.runner(cmd, args, capture);
      },
    }),
    /smoke failed/,
  );
  await scanCandidate(fixture.archive, output, { source, runner: fake.runner });
  await assert.rejects(verify(fixture.archive, output), /Smoke evidence/);
});
nodeTest('missing smoke evidence blocks even a clean scan', async (t) => {
  const dir = temporary(t);
  const fixture = archiveFixture(dir);
  const output = path.join(dir, 'evidence');
  await scanCandidate(fixture.archive, output, {
    source,
    runner: fakeScanner(fixture, output).runner,
  });
  await assert.rejects(verify(fixture.archive, output), /ENOENT/);
});
nodeTest('changed smoke identity cannot approve publication', async (t) => {
  const dir = temporary(t);
  const fixture = archiveFixture(dir);
  const output = path.join(dir, 'evidence');
  await scan(fixture.archive, output, {
    runner: fakeScanner(fixture, output).runner,
  });
  const file = path.join(output, 'smoke.json');
  const value = JSON.parse(fs.readFileSync(file));
  value.imageId = `sha256:${'f'.repeat(64)}`;
  fs.writeFileSync(file, JSON.stringify(value));
  await assert.rejects(verify(fixture.archive, output), /Smoke evidence/);
});

for (const [option, error] of [
  ['noSbom', /SBOM/],
  ['wrongSubject', /subject/],
  ['wrongBinding', /not bound/],
  ['wrongSource', /Provenance/],
]) {
  nodeTest(`invalid candidate ${option} is rejected before Docker`, (t) => {
    const fixture = archiveFixture(temporary(t), { [option]: true });
    assert.throws(() => inspectCandidate(fixture.archive, source), error);
  });
}
nodeTest(
  'modern BuildKit empty subjects remain bound through OCI references and VCS metadata',
  (t) => {
    const fixture = archiveFixture(temporary(t), { modern: true });
    assert.equal(
      inspectCandidate(fixture.archive, source).digest,
      fixture.digest,
    );
  },
);
for (const file of ['sbom.spdx.json', 'provenance.json']) {
  nodeTest(`changed ${file} cannot approve publication`, async (t) => {
    const dir = temporary(t);
    const fixture = archiveFixture(dir);
    const output = path.join(dir, 'evidence');
    await scan(fixture.archive, output, {
      runner: fakeScanner(fixture, output).runner,
    });
    fs.appendFileSync(path.join(output, file), ' ');
    await assert.rejects(
      verify(fixture.archive, output),
      /Attestation evidence changed/,
    );
  });
}
nodeTest(
  'a loaded image mismatch fails before running the smoke topology',
  async (t) => {
    const dir = temporary(t);
    const fixture = archiveFixture(dir);
    let ran = false;
    await assert.rejects(
      smoke(fixture.archive, path.join(dir, 'evidence'), {
        source,
        runner: (command, args) => {
          if (command === 'bash') ran = true;
          return args.includes('inspect') ? `sha256:${'d'.repeat(64)}` : '';
        },
      }),
      /Loaded image differs/,
    );
    assert.equal(ran, false);
  },
);
nodeTest(
  'a changed archive during smoke cannot produce a successful record',
  async (t) => {
    const dir = temporary(t);
    const fixture = archiveFixture(dir);
    const output = path.join(dir, 'evidence');
    const fake = fakeScanner(fixture, output);
    await assert.rejects(
      smoke(fixture.archive, output, {
        source,
        runner: (cmd, args, capture) => {
          if (cmd === 'bash') fs.appendFileSync(fixture.archive, ' ');
          return fake.runner(cmd, args, capture);
        },
      }),
      /changed during smoke/,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(output, 'smoke.json'))).passed,
      false,
    );
  },
);
nodeTest(
  'a later promotion digest mismatch removes stale deployment references',
  async (t) => {
    const dir = temporary(t);
    const fixture = archiveFixture(dir);
    const output = path.join(dir, 'evidence');
    await scan(fixture.archive, output, {
      runner: fakeScanner(fixture, output).runner,
    });
    const dockerConfig = path.join(dir, 'auth.json');
    fs.writeFileSync(dockerConfig, '{}');
    fs.writeFileSync(path.join(output, 'release-image.env'), 'stale');
    let checks = 0;
    await assert.rejects(
      publish(fixture.archive, output, {
        image: 'registry.test/app',
        tags: ['registry.test/app:sha', 'registry.test/app:version'],
        dockerConfig,
        expectedDigest: fixture.digest,
        runner: (_cmd, args) =>
          args.includes('inspect')
            ? `sha256:${'c'.repeat(64)}`
            : args.includes('digest')
              ? ++checks === 1
                ? fixture.digest
                : 'different'
              : '',
      }),
      /Release tag/,
    );
    assert.equal(fs.existsSync(path.join(output, 'release-image.env')), false);
  },
);

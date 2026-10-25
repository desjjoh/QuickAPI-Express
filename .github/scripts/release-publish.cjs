'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verify, run } = require('./release-candidate.cjs');

async function publish(
  archive,
  evidence,
  {
    image,
    tags,
    source,
    expectedDigest,
    dockerConfig = path.join(
      process.env.DOCKER_CONFIG || path.join(process.env.HOME || '', '.docker'),
      'config.json',
    ),
    helper = 'ghcr.io/regclient/regctl:latest',
    runner = run,
  } = {},
) {
  fs.rmSync(path.join(evidence, 'release-image.env'), { force: true });
  const digest = await verify(archive, evidence, { source });
  if (
    !/^sha256:[a-f\d]{64}$/.test(expectedDigest ?? '') ||
    digest !== expectedDigest
  )
    throw new Error('Build and scanned candidate digests differ');
  if (
    typeof image !== 'string' ||
    !/^[a-z\d][a-z\d.:-]*\/[a-z\d][a-z\d._/-]*$/.test(image)
  )
    throw new Error('Invalid registry/repository');
  if (
    !Array.isArray(tags) ||
    !tags.length ||
    tags.some(
      (tag) =>
        typeof tag !== 'string' ||
        !tag.startsWith(`${image}:`) ||
        !/^[A-Za-z\d_][A-Za-z\d_.-]{0,127}$/.test(tag.slice(image.length + 1)),
    )
  )
    throw new Error('Invalid release tags');
  if (!fs.statSync(dockerConfig).isFile())
    throw new Error('Registry login configuration is missing');
  runner('docker', ['pull', helper]);
  const helperId = runner(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', helper],
    true,
  );
  if (!/^sha256:[a-f0-9]{64}$/.test(helperId))
    throw new Error('Invalid publisher image ID');
  const args = [
    'run',
    '--rm',
    '--user',
    '0:0',
    '--env',
    'HOME=/root',
    '--mount',
    `type=bind,source=${dockerConfig},target=/root/.docker/config.json,readonly`,
    '--mount',
    `type=bind,source=${path.dirname(archive)},target=/candidate,readonly`,
    helperId,
  ];
  fs.writeFileSync(
    path.join(evidence, 'publisher-image-id.txt'),
    `${helperId}\n`,
  );
  // Import the full OCI index, including its provenance/SBOM manifests, without rebuilding.
  runner('docker', [
    ...args,
    'image',
    'import',
    tags[0],
    `/candidate/${path.basename(archive)}`,
  ]);
  if (runner('docker', [...args, 'image', 'digest', tags[0]], true) !== digest)
    throw new Error('Registry changed the approved manifest digest');
  for (const tag of [...new Set(tags)].slice(1)) {
    runner('docker', [...args, 'image', 'copy', `${image}@${digest}`, tag]);
    if (runner('docker', [...args, 'image', 'digest', tag], true) !== digest)
      throw new Error('Release tag does not resolve to the approved digest');
  }
  fs.writeFileSync(
    path.join(evidence, 'publication.json'),
    JSON.stringify(
      {
        image,
        digest,
        tags: [...new Set(tags)],
        source:
          source ??
          JSON.parse(fs.readFileSync(path.join(evidence, 'candidate.json')))
            .source,
        publishedAt: new Date().toISOString(),
        publisherImageId: helperId,
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(evidence, 'release-image.env'),
    `QUICKAPI_IMAGE=${image}@${digest}\n`,
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `quickapi-image=${image}@${digest}\n`,
    );
  return digest;
}

module.exports = { publish };
if (require.main === module) {
  const [archive, evidence] = process.argv.slice(2);
  if (!archive || !evidence) {
    console.error(
      'Usage: release-publish.cjs <OCI archive> <evidence directory>',
    );
    process.exitCode = 1;
  } else
    publish(path.resolve(archive), path.resolve(evidence), {
      image: process.env.RELEASE_IMAGE,
      source: {
        sha: process.env.RELEASE_SHA,
        repository: process.env.RELEASE_SOURCE,
      },
      tags: (process.env.RELEASE_TAGS || '').split('\n').filter(Boolean),
      expectedDigest: process.env.RELEASE_DIGEST,
      helper: process.env.REGCTL_IMAGE,
    }).catch((error) => {
      console.error(`Release publication failed: ${error.message}`);
      process.exitCode = 1;
    });
}

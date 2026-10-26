# Immutable releases and rollback

[Documentation index](../README.md#documentation)

## Release lifecycle

The `Release image` workflow follows successful push CI on `main`. PRs continue
through `dev`; neither PRs nor pushes to `dev` publish images. Manual dispatch
must run from `main`, selects a full commit SHA already on `main`, and defaults
to a dry run. The latest push CI run for that exact SHA must have succeeded.
An older successful run cannot excuse a newer failed or incomplete run.

1. Check out the selected commit without persisted Git credentials. Build one
   unpublished `linux/amd64` OCI archive using BuildKit, with SPDX SBOM and maximum
   provenance. Additional architectures require their own runtime evidence.
2. Validate the OCI index, runtime configuration, source labels, and both
   attestations. Their manifest references must identify the runtime being tested;
   provenance must identify the selected Git revision and repository. BuildKit
   versions with empty statement subjects are supported through the binding in
   their OCI attestation-manifest annotations. A nonempty subject must match.
3. Load this archive into a containerd image store. Run the existing production
   smoke topology against its immutable local identity, without another build:
   isolated MySQL, explicit compiled migrations, readiness, API operations,
   favicon content/type, non-root runtime, and SIGTERM shutdown. Teardown owns
   only disposable smoke infrastructure; it never accesses the development DB.
4. Scan the original archive's OS and Node packages using the shared critical-only
   policy. Retain lower severities. Missing evidence, scanner failures, invalid
   exceptions, and critical blockers prevent publication.
5. Recheck archive, report, policy, and extracted-attestation hashes and the
   successful smoke record. Only then authenticate and import the original OCI
   archive into the registry, retaining its attestations. No rebuild occurs.
6. Verify the published index digest equals the build/scanned candidate digest.
   Copy commit and application-version tags from that digest and verify each tag.
   Write `release-image.env` only after every publication check passes.

The local Docker image ID/config digest, runtime manifest digest, and release OCI
index digest identify different objects. The verifier checks their relationship;
they are not interchangeable. Deploy the published **index digest**.

The workflow publishes artifacts; it does not deploy a running environment or
apply migrations to a deployment database. Base CI and release verification build
separate candidates. Successful base CI alone cannot approve the release image.

## Hosted verification evidence

Reviewed on 2026-10-25 against source commit
`c555c550ed096492dfeebcbfa6451aba1a5d6d79`:

- [Main push CI run 40233825512](https://github.com/desjjoh/QuickAPI-Express/actions/runs/40233825512) succeeded for that exact commit.
- [Release run 40233956753](https://github.com/desjjoh/QuickAPI-Express/actions/runs/40233956753) succeeded automatically after CI. Its job completed candidate smoke, scanning, evidence verification, disposable-registry verification, real registry login, and publication; publication was not skipped.
- The retained `release-evidence-40233956753-1` artifact contains matching source and build/published digest records in `workflow.json`, `candidate.json`, and `publication.json`. Its `release-image.env` records:

```dotenv
QUICKAPI_IMAGE=ghcr.io/desjjoh/quickapi-express@sha256:cde2c153eb9c6a5f51236967d7e84a1aa294db23c21793b99c153509a0e4bc92
```

This establishes successful hosted publication and effective push permissions for
that run. It does not independently audit environment reviewer/branch policies,
prove a running deployment, or exercise manual dispatch. The available release
history contains automatic `workflow_run` runs; the manual dry-run path remains
unverified. Evidence is time-specific; verify a future candidate and its release
record independently.

## Registry and permissions

The defaults are GHCR and the lowercase GitHub repository name. Optional repository
variables `CONTAINER_REGISTRY` and `CONTAINER_REPOSITORY` select another compatible
OCI registry. For a separate registry, configure `REGISTRY_USERNAME` and
`REGISTRY_PASSWORD` in the `release` GitHub environment. Its credential needs only
pull/push access to the selected repository, not repository administration.

Create/configure the `release` environment and select any required reviewers
before enabling publication. GitHub evaluates environment branch restrictions
against the workflow ref: `workflow_run` uses the repository default branch
(currently `dev`), whereas manual runs here use `main`. Allow these trusted
workflow refs in the environment policy and protect both branches; the workflow
separately restricts the **candidate source** to commits on `main`. The workflow requests
`contents: read`, `actions: read`, and job-scoped `packages: write`; it needs no Git
write permission. GHCR uses the job's `GITHUB_TOKEN`. Keep package creation/access
permissions consistent with that repository. Registry login follows verification,
and PR jobs receive no release credentials. Serialize releases to avoid tag races.

Attestations are BuildKit-generated OCI metadata, preserved by digest; this is not
a claim of independently signed GitHub attestations or a particular SLSA level.
The trusted workflow, source restrictions, environment controls, and registry
access are the publication boundary. Do not pass secrets as build arguments:
maximum provenance may record build parameters. Use BuildKit secret mounts if a
future build needs a secret.

Tags are discoverable aliases and may move; digests are deployment identities.
The SHA/version tags can be updated by a later approved publication. There is no
automatic `latest` tag or automatic environment deployment.

## Evidence and retention

Each run retains `release-evidence-<run>-<attempt>` for 90 days, subject to the
repository/organization retention limit. It includes:

- `workflow.json`: source SHA, repository, successful CI run ID, release workflow
  run/attempt, and build digest;
- `smoke.json` and `smoke.log`: successful runtime identity, source and archive
  hash, completion time, and production topology output;
- `candidate.json`: release/runtime/config identities, source, archive/report/
  attestation/policy hashes, scanner image ID and version;
- `sbom.spdx.json` and `provenance.json`: extracted candidate attestations;
- raw JSON/SARIF vulnerabilities, `gate.json`, readable summary, and exception
  policy; failure evidence remains available when verification fails;
- after publication, `publication.json`, publisher image ID, and
  `release-image.env` containing the verified `QUICKAPI_IMAGE=...@sha256:...`.

The OCI archive stays local until approved and is not uploaded as a GitHub
artifact. After publication, its manifests/attestations are in the registry.
Preserve verified release records outside short-lived CI retention when needed
for your rollback horizon, and retain their registry digests against garbage
collection. Do not interpret an expired CI artifact as a deleted registry image.

If publication fails partway through, some tags may already exist. Treat the run
as failed; no verified deployment reference is produced. Inspect retained
evidence before retrying. Rerunning the workflow builds a new candidate; it must
pass verification again and may have a different digest.

## Promotion and rollback

Use the verified `QUICKAPI_IMAGE` reference from the release record in the
deployment platform. Promotion between environments selects that same digest;
it never builds the source again. Verify the reference against the release record
and confirm its attestations and scan/smoke evidence before deployment. This
repository does not currently automate environment promotion.

For rollback, select the previous successful release's verified digest, confirm
it remains available and is compatible with the **current** database schema,
then update the deployment platform's image reference and roll out normally.
Verify readiness, public API behavior, and logs afterward. Keep the replaced
digest in the deployment record for diagnosis.

Application rollback does not reverse migrations or cancel running SQL. Prefer
backward-compatible additive schema changes; a destructive migration may require
a forward repair or a separately rehearsed restore. Never run an automatic
database reset or migration revert as part of image rollback.

## Local verification

Use Node 24, Docker with the containerd image store, Buildx, Compose v2, and Bash.
On Windows, the candidate helper selects Git Bash at its default installation;
set `RELEASE_BASH` to override that executable. Use fresh evidence directories.

```bash
export RELEASE_SHA="$(git rev-parse HEAD)"
export RELEASE_SOURCE=https://github.com/desjjoh/QuickAPI-Express
mkdir -p .release-check/local-candidate
docker buildx build --platform linux/amd64 --provenance=mode=max --sbom=true \
  --label "org.opencontainers.image.revision=$RELEASE_SHA" \
  --label "org.opencontainers.image.source=$RELEASE_SOURCE" \
  --output type=oci,dest=.release-check/local-candidate/image.tar .
node .github/scripts/release-candidate.cjs smoke .release-check/local-candidate/image.tar .release-check/local-evidence
node .github/scripts/release-candidate.cjs scan .release-check/local-candidate/image.tar .release-check/local-evidence
node .github/scripts/release-candidate.cjs verify .release-check/local-candidate/image.tar .release-check/local-evidence
npm run test:release
```

The release helper refuses publication without successful smoke/scan evidence.
Local verification does not establish remote CI success, environment approvals,
or registry authorization. Use the manual workflow's dry run to verify those
GitHub execution boundaries without publication.

Implementation references: [Docker build attestations](https://docs.docker.com/build/metadata/attestations/),
[GitHub workflow-run refs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
and [environment branch restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

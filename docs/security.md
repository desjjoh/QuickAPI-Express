# Dependency and image security

[Documentation index](../README.md#documentation)

Security tooling follows the NestJS structure: dependency audit and image-check
scripts under `.github/scripts/`, separate exact exception registers under
`security/`, and retained evidence. Express blocks **critical** production
dependency/image findings by severity; high and lower findings remain visible.
Development-only dependency findings are reported separately and are nonblocking.

## Pull request and branch CI lifecycle

1. `Dependency security` installs the lockfile with implicit npm auditing disabled,
   runs the dependency/image gate regressions, and invokes `security:audit`.
2. The audit reads production and full-tree npm reports. It validates command
   status, schema/counts, installed versions, advisory chains, and exception scope.
   Only package findings whose full set of paths is marked `dev` in the lockfile
   enter the development-only summary. Mixed-scope packages are not relabeled.
3. `Production image smoke test` builds the runtime image once and resolves its
   immutable Docker image ID. Both migration and API containers use that ID. Smoke also verifies the runtime
   is non-root and excludes bundled package managers and Corepack caches.
4. After smoke succeeds, `release-check.cjs image` exports that same ID, binds the
   archive to its runtime config, and invokes Trivy for OS and Node packages.
   The scanner container reads the archive; it has no Docker socket mount.
5. Scan evidence must identify the bound runtime config. The input archive hash
   must remain unchanged, and both package inventories must be present/nonempty.
   Temporary image exports are removed after success or failure; reports remain.
6. Audit and image reports are uploaded with `if: always()` and 14-day retention.
   The unchanged `Deployment gate` requires both jobs to succeed; failure,
   cancellation, or skipped prerequisites cannot approve a candidate.

Malformed, expired, or overlong exceptions and unavailable/invalid scan evidence
block independently of vulnerability severity. Unsupported/end-of-life image OS
also fails validation. Neither audit nor image scan ignores unfixed findings.
An exception never authorizes missing evidence or scanner failure.

## Local commands

```bash
npm run test:security
npm run security:audit
npm run smoke:production
```

`test:security` uses dependency-free Node tests with synthetic npm/Trivy reports
and fake command runners. It does not contact a registry, start Docker, or access
a database. `security:audit` contacts the configured npm registry without updating
packages. It needs neither Docker nor Bash.

After smoke succeeds, scan its recorded image from Git Bash:

```bash
image_id="$(node -p "require('./.release-check/smoke-image.json').imageId")"
npm run security:image -- "$image_id" .release-check/image-security
```

Or from PowerShell, using Git Bash for the existing smoke script:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' .github/scripts/ci-smoke.sh
if ($LASTEXITCODE -ne 0) { throw 'Production smoke failed' }
$image = Get-Content .release-check/smoke-image.json -Raw | ConvertFrom-Json
npm.cmd run security:image -- $image.imageId .release-check/image-security
if ($LASTEXITCODE -ne 0) { throw 'Image security blocked or unavailable' }
```

Always select the image produced by the successful smoke run. Merely having a
local record does not prove that a subsequent smoke attempt succeeded. For a
release candidate, smoke can accept `SMOKE_IMAGE=sha256:...` and use that
existing image without rebuilding. Mutable tags are rejected for this override.

Trivy defaults to `aquasec/trivy:latest`, matching Nest's scanner-update approach.
`TRIVY_SCANNER_IMAGE` may explicitly select another scanner image for CI/local
tooling; this is not application runtime configuration and is not read from `.env`.
Each run pulls the selected reference, resolves its immutable ID, and records the
actual scanner ID/version used. Cached vulnerability databases live under ignored
`.release-check/trivy-cache/`. Docker and network access are required; failure to
obtain usable scanner evidence fails the gate rather than skipping it.

## Policy, reports, and release boundary

- [Dependency exceptions](../security/dependency-audit-exceptions.md): exact GHSA,
  package and installed versions, owner, justification, UTC expiry within 30 days.
- [Image exceptions](../security/container-vulnerability-exceptions.md): exact
  vulnerability/package/version/path/target/type, owner, reason, review reference,
  and UTC expiry within 30 days. Registers start empty.
- `.release-check/dependency-audit/` contains production/full audit JSON, the gate
  result with development-only findings, and a readable summary.
- `.release-check/image-security/` contains full Trivy JSON, `result.json`,
  `image.json`, and a readable summary. `.release-check/smoke-image.json` records
  the immutable image selected by smoke testing.

High/lower findings still require triage. Excepted critical findings stay visible;
updates and remediation are preferable to risk acceptance. Scan results are
time-specific and do not establish application exploitability.

These base-CI checks approve the PR/branch candidate only. The [release workflow](releases.md)
builds a separate candidate once, attaches SBOM/provenance, repeats smoke/scanning
on that artifact, and publishes/promotes its verified digest without rebuilding.
PR success does not automatically approve a later release image. Release-time
verification reuses the same critical-only vulnerability evaluator and exception
register, including fresh validation before publication.

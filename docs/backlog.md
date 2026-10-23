# Technical backlog

[Documentation index](../README.md#documentation)

These are code-reviewed gaps, not completed changes. Documentation and formatting alignment does not resolve them.

| Area                | Current gap and follow-up                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proxy compatibility | The app trusts one proxy hop, but header sanitization rejects standard forwarded headers. Define the trusted ingress boundary and test forwarded requests.                                      |
| Request timeouts    | Each request adds a socket timeout listener without removing it. The total timer ends with body receipt rather than response completion. Add cleanup and define the full request deadline.      |
| Rate limiting       | Inactive client keys are never removed; rejected requests also add timestamps. Bound storage and test sustained and varied-client traffic.                                                      |
| HTTP startup        | Server registration returns before the listening event and does not reject on a bind error. Await listener startup before reporting readiness.                                                  |
| Database wrappers   | The Bash wrapper runs Vitest twice for integration/E2E and selects a nonexistent `migration` project before migration validation. Correct dispatch while preserving safety checks and teardown. |
| Local commands      | `clean` invokes `rimraf` without declaring it directly. Use an explicitly supported cleanup implementation.                                                                                     |

Protect these paths with focused regression tests when implementing each fix. Verify deployment-specific CORS, ingress, and operational endpoint exposure separately from the repository's fixture and container checks.

# Dependency Security Baseline

This document records the initial dependency audit and triage for STE-59.

## Audit Run

- Date: 2026-02-16
- Command: `npm audit --audit-level=high`
- Result: 0 critical, 0 high, 5 moderate, 1 low

## Findings and Triage

1. `@esbuild-kit/core-utils` (moderate, transitive)
2. `@esbuild-kit/esm-loader` (moderate, transitive)
3. `drizzle-kit` (moderate, direct dev dependency)
4. `esbuild` (moderate, transitive, `GHSA-67mh-4wv8-2f99`)
5. `lodash` (moderate, transitive via `recharts`, `GHSA-xxjr-mmjv-4gpg`)
6. `qs` (low, transitive via `express` / `body-parser` and `superagent`, `GHSA-w7fw-mjwx-w883`)

### Triage Notes

- The first four moderate findings are one development-tooling chain rooted at `drizzle-kit`.
- This tooling chain is not on the production request path, so current treatment is monitor + patch via Dependabot and upgrade when a safe upstream path is available.
- `lodash` and `qs` are transitive runtime dependencies; they remain monitored and should be updated through upstream package releases.
- Advisory IDs are taken directly from `npm audit` output to avoid ambiguity when CVE aliases differ.

## Current Security Gate

- CI now runs `npm audit --audit-level=high` in the GitHub Actions pipeline.
- Any future `high` or `critical` dependency vulnerability will fail CI.

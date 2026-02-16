# Dependency Security Baseline

This document records the initial dependency audit and triage for STE-59.

## Audit Run

- Date: 2026-02-16
- Command: `npm audit --audit-level=high`
- Result: 0 critical, 0 high, 5 moderate, 1 low

## Findings and Triage

1. `drizzle-kit` / `@esbuild-kit/*` / `esbuild` (moderate)
   - Risk context: Development tooling chain (`drizzle-kit`), not runtime production API code.
   - Current action: Keep pinned current versions for compatibility, monitor via Dependabot, and upgrade as soon as a non-breaking patch path is available.
   - Notes: Advisory includes `GHSA-67mh-4wv8-2f99` for `esbuild`.

2. `lodash` (moderate)
   - Risk context: Transitive via `recharts`.
   - Current action: Track upstream updates with Dependabot and apply once available.
   - Notes: Advisory includes `GHSA-xxjr-mmjv-4gpg`.

3. `qs` (low)
   - Risk context: Transitive via `express` / `body-parser` and `superagent`.
   - Current action: Track upstream updates with Dependabot and apply once available.
   - Notes: Advisory includes `GHSA-w7fw-mjwx-w883`.

## Current Security Gate

- CI now runs `npm audit --audit-level=high` in the GitHub Actions pipeline.
- Any future `high` or `critical` dependency vulnerability will fail CI.

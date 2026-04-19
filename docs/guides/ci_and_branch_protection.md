# CI Gates and Branch Protection

**Last updated:** 2026-04-18
**Owner:** Stephanie Figas

## Required status-check name

GitHub branch protection must reference the exact job name as it appears in the CI workflow:

```
Quality Gates
```

This is the `jobs.quality-gates.name` value in `.github/workflows/ci.yml`.

## CI gates (all required, all blocking)

| Step                    | Command                                | Notes                                         |
| ----------------------- | -------------------------------------- | --------------------------------------------- |
| Agent manual sync check | `cmp -s AGENTS.md CLAUDE.md replit.md` | Fails if the three shared agent files diverge |
| TypeScript type-check   | `npm run check`                        | Runs `tsc` with no emit                       |
| ESLint                  | `npm run lint`                         | Zero-warning policy                           |
| Tests                   | `npm test`                             | Vitest suite                                  |
| Dependency audit        | `npm audit --audit-level=high`         | Fails on any high or critical finding         |
| Build                   | `npm run build`                        | Production bundle must compile clean          |

All steps run in a single job named **Quality Gates** on `ubuntu-latest` with Node 20.

## Dependency audit policy

The audit gate uses `--audit-level=high`, meaning any vulnerability rated **high** or **critical** blocks the merge.

**Moderate and lower findings** are logged but do not block CI. They should be triaged in follow-up issues.

**Known exceptions as of 2026-04-18:**

| Package                                                           | Advisory            | Severity | Reason not auto-fixed                                                        |
| ----------------------------------------------------------------- | ------------------- | -------- | ---------------------------------------------------------------------------- |
| `drizzle-kit` (via `@esbuild-kit/esm-loader` → `esbuild ≤0.24.2`) | GHSA-67mh-4wv8-2f99 | Moderate | Fix requires breaking `drizzle-kit` major version bump; tracked as follow-up |

## Branch protection settings for `main`

The following settings must be applied manually by the repo owner in **GitHub → Settings → Branches → Branch protection rules** for the `main` branch.

> **Note:** Applying or changing these settings requires repo-owner access. Agents cannot apply branch protection via the API without explicit authorization.

### Required settings

| Setting                                                            | Value                    |
| ------------------------------------------------------------------ | ------------------------ |
| Require a pull request before merging                              | ✅ Enabled               |
| — Required approving reviews                                       | 1 (minimum)              |
| — Dismiss stale pull request approvals when new commits are pushed | ✅ Enabled               |
| Require status checks to pass before merging                       | ✅ Enabled               |
| — Required status check name                                       | `Quality Gates`          |
| Require branches to be up to date before merging                   | ✅ Enabled               |
| Require conversation resolution before merging                     | ✅ Enabled               |
| Allow force pushes                                                 | ❌ Disabled              |
| Allow deletions                                                    | ❌ Disabled              |
| Include administrators                                             | ✅ Enabled (recommended) |

### How to apply

1. Go to the repository on GitHub.
2. Navigate to **Settings → Branches**.
3. Click **Add branch protection rule** (or edit the existing rule for `main`).
4. Set **Branch name pattern** to `main`.
5. Apply each setting from the table above.
6. Click **Save changes**.

Once enabled, every PR targeting `main` must have the `Quality Gates` job pass before it can be merged, and force-pushes and direct deletions of `main` are blocked.

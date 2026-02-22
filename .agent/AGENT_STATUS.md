# Agent Status Board

> **Purpose:** Coordination file for all AI agents working on this codebase.
> Before starting work on any issue, check this file. Before committing, update it.

---

## How to Use This File

1. **Before starting work:** Read this file to see what's claimed.
2. **Claim your task:** Add your agent name, the issue ID, and a timestamp.
3. **When done:** Move your entry to "Recently Completed" and update Linear.
4. **Conflicts:** If two agents claim the same issue, the earlier timestamp wins. The later agent should pick a different task.

**Agent names:** `Claude-Desktop`, `Claude-Web`, `Replit-Codex`, `Antigravity`, `Cowork`

---

## 🔴 Currently In Progress

| Issue  | Title                        | Agent          | Started    | Branch                            | Notes                         |
| ------ | ---------------------------- | -------------- | ---------- | --------------------------------- | ----------------------------- |
| STE-57 | Add pre-commit hooks (Husky) | Claude-Desktop | 2026-02-22 | `feature/STE-57-husky-pre-commit` | STE-56 dependency is complete |

## 🟡 Up Next (Unclaimed — Grab One!)

| Priority  | Issue  | Title                                   | Dependencies                     |
| --------- | ------ | --------------------------------------- | -------------------------------- |
| 🔴 Urgent | STE-53 | Rotate exposed LINEAR_API_KEY           | Needs Stephanie for key rotation |
| 🟡 High   | STE-58 | Add Sentry + Pino logging               | None                             |
| 🟡 High   | STE-60 | Add Dockerfile                          | None                             |
| 🟡 High   | STE-65 | Update CLAUDE.md for multi-agent DevOps | Update as each issue completes   |
| 🟡 High   | STE-67 | Close test gaps (API, schema, data)     | None                             |
| 🟢 Medium | STE-61 | Database backup strategy                | None                             |
| 🟢 Medium | STE-62 | Rate limiting + CORS                    | None                             |
| 🟢 Medium | STE-64 | Semantic versioning                     | None                             |

## ✅ Recently Completed

| Issue  | Title                       | Agent          | Completed  | PR                                 |
| ------ | --------------------------- | -------------- | ---------- | ---------------------------------- |
| STE-63 | Branch protection rules     | Claude-Desktop | 2026-02-22 | N/A (GitHub API — no code changes) |
| STE-59 | Add Dependabot              | —              | 2026-02-16 | —                                  |
| STE-56 | Add ESLint + Prettier       | —              | 2026-02-16 | —                                  |
| STE-54 | Set up GitHub Actions CI/CD | Cowork         | 2026-02-15 | —                                  |

---

## Rules for Agents

1. **Check this file before starting any STE-xx issue.**
2. **Update Linear status** to "In Progress" when you start, "Done" when you finish.
3. **One agent per issue** — don't duplicate work. If it's claimed, pick something else.
4. **STE-57 depends on STE-56** — don't start Husky until ESLint/Prettier is merged.
5. **STE-65 is incremental** — update CLAUDE.md as part of each issue, not as a standalone task.
6. **Always branch from `main`** using the naming convention: `feature/STE-XX-description` or `fix/STE-XX-description`.
7. **Never use `--no-verify`** to skip pre-commit hooks.

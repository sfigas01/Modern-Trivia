# Agent Status Board

> **Purpose:** Coordination file for all AI agents working on this codebase.
> Before starting work on any issue, check this file. Before committing, update it.

---

## How to Use This File

1. **Before starting work:** Read this file to see what's claimed.
2. **Claim your task:** Add your agent name, the issue ID, and a timestamp.
3. **When done:** Move your entry to "Recently Completed" and update Linear.
4. **Conflicts:** If two agents claim the same issue, the earlier timestamp wins. The later agent should pick a different task.

**Agent names:** `Claude-Code`, `Replit-Agent`, `Codex`, `Antigravity`, `Cowork`

---

## 🔴 Currently In Progress

| Issue                | Title | Agent | Started | Branch | Notes |
| -------------------- | ----- | ----- | ------- | ------ | ----- |
| _(no active claims)_ | —     | —     | —       | —      | —     |

## 🟡 Up Next (Unclaimed — Grab One!)

> Check [Linear](https://linear.app/stephs-vibe-coding) for current priority queue. This table is not guaranteed to be current.

| Priority       | Issue | Title | Dependencies |
| -------------- | ----- | ----- | ------------ |
| _(see Linear)_ | —     | —     | —            |

## ✅ Recently Completed (STE-66 DevOps Sprint)

| Issue  | Title                        | Agent       | Completed  | PR  |
| ------ | ---------------------------- | ----------- | ---------- | --- |
| STE-57 | Add pre-commit hooks (Husky) | Claude-Code | 2026-02-22 | —   |
| STE-63 | Branch protection rules      | Claude-Code | 2026-02-22 | N/A |
| STE-59 | Add Dependabot               | —           | 2026-02-16 | —   |
| STE-56 | Add ESLint + Prettier        | —           | 2026-02-16 | —   |
| STE-54 | Set up GitHub Actions CI/CD  | Cowork      | 2026-02-15 | —   |

---

## Rules for Agents

1. **Check this file before starting any STE-xx issue.**
2. **Update Linear status** to "In Progress" when you start, "Done" when you finish.
3. **One agent per issue** — don't duplicate work. If it's claimed, pick something else.
4. **Always branch from `main`** using the naming convention: `feature/STE-XX-description` or `fix/STE-XX-description`.
5. **Never use `--no-verify`** to skip pre-commit hooks.

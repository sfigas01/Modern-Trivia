# Modern Trivia - Product Roadmap

This document serves as the high-level roadmap for Modern Trivia, tracking active work, upcoming priorities, and future vision.

> **⚠️ Current Focus: Professionalise the App.** Feature development is paused while we establish DevOps, security, and operational maturity. See STE-66 in Linear.

## 🗺️ Roadmap Status

| ID          | Status     | Timeline | Focus Area            | Description                       | Relative Link                                                        |
| :---------- | :--------- | :------- | :-------------------- | :-------------------------------- | :------------------------------------------------------------------- |
| **STE-66**  | **NOW**    | Q1 2026  | **DevOps & Security** | Implement Modern DevOps Practices | [View in Linear](https://linear.app/stephs-vibe-coding/issue/STE-66) |
| **EPIC-01** | **PAUSED** | Q1 2026  | **Trust & Quality**   | Interactive Dispute Resolution    | [View Epic](epics/EPIC-01_dispute_resolution.md)                     |
| **FT-01**   | **DONE**   | Q1 2026  | **Support**           | Reference Support for Q&A         | [View Feature](features/FT-01_reference_support.md)                  |
| **FT-02**   | **PAUSED** | Q1 2026  | **Scale**             | Content Inventory & CMS           | [View Feature](features/FT-02_content_inventory.md)                  |
| **FT-03**   | **NEXT**   | Q2 2026  | **Maintenance**       | AI Quality Sweep                  | [View Feature](features/FT-03_ai_quality_sweep.md)                   |
| **EPIC-03** | **NEXT**   | Q2 2026  | **AI Core**           | AI QA "Guardian" Agent            | [View Epic](epics/EPIC-03_qa_agent.md)                               |
| **FT-05**   | **NEXT**   | Q2 2026  | **AI Core**           | Agent Core & Rules Engine         | _(Spec Pending)_                                                     |
| **FT-06**   | **NEXT**   | Q2 2026  | **AI Core**           | Search Tool Integration           | _(Spec Pending)_                                                     |
| **FT-07**   | **NEXT**   | Q2 2026  | **AI Core**           | Test Harness / Playground         | _(Spec Pending)_                                                     |
| **EPIC-02** | **NEXT**   | Q2 2026  | **Scale**             | Backstage Content Pipeline        | [View Epic](epics/EPIC-02_backstage_pipeline.md)                     |
| **EPIC-04** | **LATER**  | 2026+    | **Expansion**         | On-Demand Generation              | _(Planned)_                                                          |

---

## 🔧 Active Development (NOW): DevOps & Security

### STE-66: Implement Modern DevOps Practices

**Goal:** Establish CI/CD, testing, linting, monitoring, and operational best practices before resuming feature work.
**Status:** 🏗️ In Progress
**Tracked in:** [Linear — Modern Trivia project](https://linear.app/stephs-vibe-coding/issue/STE-66)

**Why now:** The app is worked on by 4 AI agents (Claude Code Desktop, Claude Code Web, Replit Codex, Antigravity) with no automated quality gates, no testing, no CI/CD, and a security incident (exposed API key). The codebase needs guardrails before it can scale safely.

**Key workstreams:**

- 🔴 **Security:** Rotate exposed secrets, establish secrets management (STE-53)
- 🔴 **CI/CD:** GitHub Actions pipeline with type-check, lint, test, build (STE-54)
- 🔴 **Testing:** Vitest framework with initial test suite (STE-55)
- 🟡 **Code Quality:** ESLint + Prettier + pre-commit hooks (STE-56, STE-57)
- 🟡 **Observability:** Sentry error tracking + Pino structured logging (STE-58)
- 🟡 **Dependency Security:** Dependabot + npm audit in CI (STE-59)
- 🟡 **Portability:** Dockerfile for local dev outside Replit (STE-60)
- 🟡 **Agent Docs:** Keep AGENTS.md + CLAUDE.md + replit.md aligned for all active agents (STE-65)
- 🟢 **Process:** Branch protection, PR workflow, semantic versioning (STE-61–64)

**Completion criteria:** CI/CD pipeline is green, tests exist, linting enforced, secrets secured, all agents have clear DevOps instructions.

---

## ⏸️ Paused (Resume After DevOps)

### EPIC-01: Interactive Dispute Resolution

**Goal:** Enable Admins to resolve user-flagged errors efficiently with AI assistance.
**Status:** ⏸️ Paused (Code Complete, Pending Infra)

- **Problem:** Players dispute answers, and fixing them requires manual fact-checking which spoils the questions for the Admin.
- **Solution:** A dashboard where AI pre-validates disputes, offering a "Fix" or "Reject" recommendation.
- **Reference Spec:** `docs/epics/EPIC-01_dispute_resolution.md`

### FT-01: Reference Support

**Goal:** Add rigorous reference tracking to all Q&A pairs for auditing and trust.
**Status:** ✅ Done

- **Reference Spec:** `docs/features/FT-01_reference_support.md`

### FT-02: Content Inventory & CMS

**Goal:** Scalable question management to search, filter, and edit the entire question database.
**Status:** ⏸️ Paused (was Requirements Gathering)

- **Reference Spec:** `docs/features/FT-02_content_inventory.md`

---

## 📅 Scheduled Priorities (NEXT — After DevOps Complete)

### FT-03: AI Quality Sweep (Maintenance)

**Goal:** Clean up existing database issues by repurposing the **AI Fact-Checker Agent**.
**Status:** 📋 Planned (Dependent on core Agent Spec)

- **Problem:** Users report "stupid questions" (bad tags, answer in text) that need bulk cleanup.
- **Solution:** A batch process that runs the _AI Fact-Checker Agent_ (from EPIC-01) across the entire inventory to identify and auto-fix low-quality data.
- **Reference Spec:** `docs/features/FT-03_ai_quality_sweep.md`

### EPIC-03: AI QA "Guardian" Agent

**Goal:** Create a centralized, versioned AI service to enforce editorial quality across the platform.
**Status:** 📋 Planned

- **Features:** Agent Core (FT-05), Search Tools (FT-06), Test Harness (FT-07).
- **Reference Spec:** `docs/epics/EPIC-03_qa_agent.md`

### Epic: Backstage Content Pipeline

**Goal:** Enable high-volume, "Spoiler-Free" import of new questions directly from AI generation.
**Status:** 📋 Planned

- **Problem:** Creating new questions currently requires reading them to verify accuracy, which ruins the game for the creator.
- **Solution:** A "Blind Import" system where an AI Gatekeeper rigorously validates new content before it enters the database.
- **Key Deliverables:**
  - `Staging Environment` (Temporary Question Store)
  - `The Gatekeeper` (Automated Verification Script)
  - `Bulk Import Tool` (CLI/UI)

---

## 🔮 Future Vision (LATER)

### Epic: On-Demand Generation

**Goal:** Real-time generation of reliable content during gameplay or immediate prep.
**Status:** 💡 Ideation

- _Generating custom rounds on the fly (e.g., "History of Canadian Hip Hop")._

### Epic: Multiplayer Lobbies

**Goal:** Streamline the "Party" experience.
**Status:** 💡 Ideation

- _Room codes, remote join, team avatars._

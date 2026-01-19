# FT-03: AI Quality Sweep (Maintenance)

> **Specification For:** `docs/features/FT-03_ai_quality_sweep.md`

## 1. SAFe Strategic Alignment

| Metric | Value | Notes |
| :--- | :--- | :--- |
| **Parent Epic** | [EPIC-01: Dispute Resolution](epics/EPIC-01_dispute_resolution.md) | *Reuses the AI Agent from Epic 01* |
| **Benefit Hypothesis** | As an **Admin**, I want to **batch-process the database with AI**, so that I can **fix thousands of "stupid questions"** (bad tags, embedded answers) without manual effort. | *Restores trust in the game data.* |
| **WSJF Score** | [High User Value] + [Low Time Criticality] / [Low Job Size] = **High** | *Quick win using existing tech.* |

### Acceptance Criteria
*   [ ] Script runs over all questions in `questions.json`.
*   [ ] Identifies "Bad Tags" (e.g. "Canadian" tag on non-Canadian content).
*   [ ] Identifies "Answer Leakage" (Answer text found in Question text).
*   [ ] Generates a report of "Proposed Fixes" for Admin review.

---

## 2. AI Implementation Spec (Spec-Driven Dev)

### Phase 1: Specify (Context & Outcomes)
*> **Goal:** Cleanse the database of low-quality data.*

**User Journey / Problem Context:**
Users are reporting questions that have the answer inside the question (e.g., "What year did... (1995)?") or have wrong tags. This makes the game feel cheap. We have an "AI Fact Checker" from Epic-01; we want to point it at the *entire* database in a loop to "Janitor" the data.

**Success Outcomes:**
*   Reduction of user disputes related to data quality.
*   Standardized tagging (e.g., all geography questions actually have Geography tag).

---

### Phase 2: Plan (Technical Design)
*> **Goal:** Define the stack, architecture, and constraints.*

**Architecture & Components:**
*   **Script:** `scripts/quality-sweep.ts` (CLI tool).
*   **AI Agent:** Reuse `server/lib/ai.ts` (The Fact Checker).
    *   *New Prompt:* "Analyze this question for quality issues: embedded answers, typos, wrong tags."
*   **Output:** Generates `quality-audit-report.json`.

**Constraints & Standards:**
*   **Cost:** Do not run continuously. One-off CLI execution.
*   **Safety:** Do NOT auto-apply changes unless confidence is > 99%. Default to "Report Only".

---

### Phase 3: Tasks (Work Breakdown)
*> **Goal:** Atomic, verifiable steps for the AI Agent to execute.*

- [ ] **Task 1:** Audit Prompt Design
    -   *Implementation:* Create a specific prompt for "Quality Control" (vs. Dispute Resolution).
    -   *Verification:* Run against 5 known "bad" questions and verify it catches them.
- [ ] **Task 2:** CLI Runner Script
    -   *Implementation:* TypeScript script to load DB, iterate, call AI (throttled), write JSON report.
    -   *Verification:* Run `npm run audit` and see a report file generated.
- [ ] **Task 3:** Review UI (Optional / Low Priority)
    -   *Implementation:* Simple page to load the JSON report and "Approve/Reject" fixes (similar to Disputes).
    -   *Verification:* Admin applies a fix.

# Documentation Standards & Naming Conventions

This document defines the rules for creating and maintaining documentation in the Modern Trivia project. All contributors (human and AI) must follow these standards.

## 1. Documentation Hierarchy (SAFe Aligned)

We follow a simplified Scaled Agile Framework (SAFe) hierarchy adapted for our team size ("Start-up 0-1").

### Level 1: Epics (Portfolio)

- **Scope:** Large, cross-cutting initiatives that deliver significant strategic value.
- **Duration:** 1-3 Quarters.
- **Location:** `docs/epics/`
- **Content:** Strategic value, "Definition of Done", and list of child Features.

### Level 2: Features (Program)

- **Scope:** Specific, shippable functionality that fulfills part of an Epic.
- **Duration:** 1-4 Weeks.
- **Location:** `docs/features/`
- **Content:**
  - **Strategic Alignment (SAFe):** Benefit Hypothesis, WSJF Score, Acceptance Criteria.
  - **AI Spec (Spec-Driven Dev):**
    - **Phase 1 - Specify:** User Journey, Problem Context, Success Outcomes (No tech details).
    - **Phase 2 - Plan:** Technical Architecture, Data Models, Component interactions.
    - **Phase 3 - Tasks:** Breakdown of work into atomic, verifiable steps.
  - Parent Epic Link.

### Level 3: Issues & Maintenance (Task Layer)

- **Scope:** Bug fixes, tech debt, and small chores that exist _outside_ of a Feature.
- **Location:** Tracked in `task.md` or GitHub Issues.
- **Note:** User functionality is always defined in a **Feature**. We do not use separate "Story" documents.

---

## 2. Directory Structure

| Directory        | Purpose                                  | Naming Convention       |
| :--------------- | :--------------------------------------- | :---------------------- |
| `docs/epics/`    | Epics (Strategic Goals).                 | `EPIC-XX_slug_name.md`  |
| `docs/features/` | Feature Specs (Shippable Units).         | `FT-XX_slug_name.md`    |
| `docs/guides/`   | Operational manuals and "How-To" guides. | `slug_name.md` (No ID)  |
| `docs/` (Root)   | High-level project maps (Roadmap).       | `UPPERCASE_FILENAME.md` |

## 3. Naming Rules

### IDs

- **Epics:** `EPIC-01`, `EPIC-02` (Sequential)
- **Features:** `FT-01`, `FT-02` (Sequential, Global counter)

### Filenames

- Use `snake_case` for the slug.
- **Correct:** `EPIC-01_dispute_resolution.md`
- **Incorrect:** `EPIC-01-DisputeResolution.md`

## 4. Roadmap Integration

Every new Epic or Feature **must** be added to `docs/PRODUCT_ROADMAP.md`.

1.  **Status Table:** Add a row with ID, Status, and Link.
2.  **Detail Section:** Add a header section with Goal, Status, and Reference Spec link.

## 5. Agent Behavior

- **Check IDs:** Always check existing IDs in the target directory to find the next available number.
- **Categorize:** Never create uncategorized files in the root `docs/` folder.

## 6. Documentation Maintenance Checklist

Run this checklist whenever file paths change, docs are renamed/moved, or agents are added/removed.

### File path references

- [ ] `README.md` — all links in Features, Project Structure, Game Flow, Admin Setup sections resolve
- [ ] `docs/guides/qa_instructions.md` — Key Files table paths resolve
- [ ] `docs/guides/quality_criteria.md` — Key Files for Review table paths resolve
- [ ] `docs/guides/ai_tool_setup.md` — instruction file names match root files

### Agent naming

Active agents: **Claude Code**, **Replit Agent**, **Codex**, **Antigravity**

- [ ] `docs/PRODUCT_ROADMAP.md` — agent list in STE-66 section matches active set
- [ ] `docs/guides/ai_tool_setup.md` — one section per active agent, none for retired tools
- [ ] `.agent/AGENT_STATUS.md` — Agent names row matches active set
- [ ] `AGENTS.md` / `CLAUDE.md` / `replit.md` — Sync Contract: all three files identical (CI enforces via `cmp -s`)

### Shared agent manifest sync

- [ ] After any edit to `AGENTS.md`, mirror the change in `CLAUDE.md` and `replit.md` in the same commit
- [ ] CI gate `cmp -s AGENTS.md CLAUDE.md replit.md` passes before merge

### Stale coordination files

- [ ] `AGENT_STATUS.md` (root) — clear completed/abandoned claims
- [ ] `.agent/AGENT_STATUS.md` — move finished issues to Recently Completed; remove stale Up Next rows

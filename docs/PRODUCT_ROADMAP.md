# Modern Trivia - Product Roadmap

This document serves as the high-level roadmap for Modern Trivia, tracking active work, upcoming priorities, and future vision.

## 🗺️ Roadmap Status

| ID | Status | Timeline | Focus Area | Description | Relative Link |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EPIC-01** | **NOW** | Q1 2026 | **Trust & Quality** | Interactive Dispute Resolution | [View Epic](epics/EPIC-01_dispute_resolution.md) |
| **FT-01** | **NOW** | Q1 2026 | **Support** | Reference Support for Q&A | [View Feature](feature_specs/FT-01_reference_support.md) |
| **FT-02** | **NOW** | Q1 2026 | **Scale** | Content Inventory & CMS | *(Spec Pending)* |

| **FT-03** | **NEXT** | Q2 2026 | **Quality** | Automated Quality Audit | *(Planned)* |
| **EPIC-02** | **NEXT** | Q2 2026 | **Scale** | Backstage Content Pipeline | [View Epic](epics/EPIC-02_backstage_pipeline.md) |
| **EPIC-03** | **LATER**| 2026+ | **Expansion** | On-Demand Generation | *(Planned)* |

---

## 🏗️ Active Development (NOW)

### EPIC-01: Interactive Dispute Resolution
**Goal:** Enable Admins to resolve user-flagged errors efficiently with AI assistance.
**Status:** 🏗️ Code Complete (Pending Infra)

*   **Problem:** Players dispute answers, and fixing them requires manual fact-checking which spoils the questions for the Admin.
*   **Solution:** A dashboard where AI pre-validates disputes, offering a "Fix" or "Reject" recommendation.
*   **Key Features:**
    *   `Dispute Dashboard` (Admin UI)
    *   `AI Fact-Checker Agent` (Backend Service)
    *   `Resolve/Reject Workflow` (Database Updates)
*   **Reference Spec:** `docs/epics/EPIC-01_dispute_resolution.md`

### FT-01: Reference Support
**Goal:** Add rigorous reference tracking to all Q&A pairs for auditing and trust.
**Status:** 🏗️ In Design
*   **Reference Spec:** `docs/feature_specs/FT-01_reference_support.md`

### FT-02: Content Inventory & CMS
**Goal:** Scalable question management to search, filter, and edit the entire question database.
**Status:** 📋 Requirements Gathering
*   **Problem:** As the database grows, finding specific questions (e.g., duplicates, typol) becomes impossible without a searchable inventory.
*   **Scope:** Searchable table, Filters (Category, Difficulty), Bulk Actions.

---

## 📅 Scheduled Priorities (NEXT)

### FT-03: Automated Quality Audit (The "Janitor")
**Goal:** Clean up existing database issues (bad tags, embedded answers, vague questions) using AI.
**Status:** 📋 Planned
*   **Problem:** Users report "stupid questions" (e.g., erroneous Canadian tags, answer in text, no clear answer).
*   **Solution:** An async agent that scans `questions.json` and flags items for review or auto-fixes tags.

### Epic: Backstage Content Pipeline
**Goal:** Enable high-volume, "Spoiler-Free" import of new questions directly from AI generation.
**Status:** 📋 Planned

*   **Problem:** Creating new questions currently requires reading them to verify accuracy, which ruins the game for the creator.
*   **Solution:** A "Blind Import" system where an AI Gatekeeper rigorously validates new content before it enters the database.
*   **Key Deliverables:**
    *   `Staging Environment` (Temporary Question Store)
    *   `The Gatekeeper` (Automated Verification Script)
    *   `Bulk Import Tool` (CLI/UI)

---

## 🔮 Future Vision (LATER)

### Epic: On-Demand Generation
**Goal:** Real-time generation of reliable content during gameplay or immediate prep.
**Status:** 💡 Ideation
*   *Generating custom rounds on the fly (e.g., "History of Canadian Hip Hop").*

### Epic: Multiplayer Lobbies
**Goal:** Streamline the "Party" experience.
**Status:** 💡 Ideation
*   *Room codes, remote join, team avatars.*

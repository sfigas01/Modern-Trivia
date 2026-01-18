# Modern Trivia - Product Roadmap

This document serves as the high-level roadmap for Modern Trivia, tracking active work, upcoming priorities, and future vision.

## 🗺️ Roadmap Status

| Status | Timeline | Focus Area | Description |
| :--- | :--- | :--- | :--- |
| **NOW** | Q1 2026 | **Trust & Quality** | Building the tools to verify and fix content without spoilers. |
| **NEXT** | Q2 2026 | **Scale & Automation** | Automating the content pipeline to support "infinite" trusted questions. |
| **LATER**| 2026+ | **Expansion** | New game modes, on-demand generation, and platform growth. |

---

## 🏗️ Active Development (NOW)

### Epic: Interactive Dispute Resolution
**Goal:** Enable Admins to resolve user-flagged errors efficiently with AI assistance.
**Status:** 🏗️ In Design/Planning

*   **Problem:** Players dispute answers, and fixing them requires manual fact-checking which spoils the questions for the Admin.
*   **Solution:** A dashboard where AI pre-validates disputes, offering a "Fix" or "Reject" recommendation.
*   **Key Deliverables:**
    *   `Dispute Dashboard` (Admin UI)
    *   `AI Fact-Checker Agent` (Backend Service)
    *   `Resolve/Reject Workflow` (Database Updates)
*   **Reference Spec:** `docs/DISPUTE_QA_USER_STORIES.md`

---

## 📅 Scheduled Priorities (NEXT)

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

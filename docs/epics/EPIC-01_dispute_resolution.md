# Epic-01: Interactive Dispute Resolution

**Goal:** Enable Admins to resolve user-flagged errors efficiently with AI assistance via an interactive dashboard.
**Status:** 🏗️ Code Complete (Pending Infra)
**Prerequisites:** Database Provisioning

## 🚧 Implementation Status (Jan 17, 2026)
The implementation for this epic is **Code Complete** but requires database infrastructure to function.

### Completed Work
- [x] **Database Schema:** Updated `shared/schema.ts` with `disputes` (status, analysis) and `app_config` tables.
- [x] **API Endpoints:** Implemented `server/routes.ts` for dispute management and AI analysis (`POST /api/disputes/:id/analyze`).
- [x] **AI Service:** Created `server/lib/ai.ts` to handle OpenAI interactions (currently mocking response).
- [x] **Admin UI:** Built `/admin/disputes` dashboard and `/admin/settings` page in React.

### ⚠️ Pending Actions (CRITICAL)
The following steps must be taken by a developer to finalize deployment:
1.  **Assess & Prepare Database:** Evaluate infrastructure requirements and ensure a Postgres instance is provisioned or accessible for connection.
2.  **Set Environment Variables:** Create a `.env` file with `DATABASE_URL=postgres://...`.
3.  **Push Schema:** Run `npm run db:push` to create the tables.
4.  **Configure Keys:** Log in to `/admin/settings` and add the OpenAI API Key.

### 🐛 Known Issues & Bugs (To Tackle)
1.  **Manual Question Editing:** Admin needs to be able to manually edit the *Question* text, not just the Answer.
2.  **AI Auto-Fill:** When AI suggests a source/citation, it should automatically update/fill the Answer field if it is missing or incomplete based on the findings.

---

## Workflow Overview

```mermaid
graph TD
    A[Player files Dispute] -->|Saved to DB| B(Dispute Table)
    B --> C{Admin Dashboard}
    C -->|Select Dispute| D[Review Panel]
    D -->|Click 'Analyze'| E[AI Agent]
    E -->|Fetch Context| F[(Questions DB)]
    E -->|Verification| G[LLM (Claude/OpenAI)]
    G -->|Recommendation| D
    D -->|Approve Fix| H[Update Question & Close Dispute]
    D -->|Reject| I[Close Dispute]
```

## User Stories

### Story 1: Admin Dispute Dashboard
**As an** Admin,
**I want** a centralized dashboard to view all player disputes,
**So that** I can track what needs attention without managing external files.

**Acceptance Criteria:**
*   **Route:** `/admin/disputes`
*   **List View:** Table showing correct/submitted answers, team name, and status.
*   **Filters:** "Pending" (Default), "Resolved", "Rejected", "All".
*   **Status Badges:** Visual indicators for dispute state.

### Story 2: AI Fact-Checker Integration
**As an** Admin,
**I want** to click "Analyze and Suggest" on a dispute to get an AI recommendation and source references,
**So that** I can save time on manual research while reviewing the facts.

**Acceptance Criteria:**
*   **Action:** "Analyze" button on the dispute detail view.
*   **Process:** System sends Question + Answer + Dispute to the configured LLM.
*   **Output:** The UI displays:
    *   **Verdict:** "Fix Required" or "Reject Dispute".
    *   **Confidence:** High/Medium/Low.
    *   **Reasoning:** Brief explanation with a citation URL.
    *   **Proposed Fix:** If valid, show the new Question/Answer text.

### Story 3: One-Click Resolution
**As an** Admin,
**I want** to apply the AI's "Proposed Fix" with a single click,
**So that** the database is updated instantly and the dispute is marked resolved.

**Acceptance Criteria:**
*   **Review Flow:** Admin sees a "Diff" view (Current vs. AI Proposed) and must click "Confirm & Apply" to finalize.
*   **Resolve (Fix):** Updates `questions.json` (or DB entry) with new content, sets dispute status to `RESOLVED`, saves resolution note.
*   **Reject:** Sets dispute status to `REJECTED` with a note (e.g., "Team was wrong").
*   **Manual Override:** Admin can edit the "Proposed Fix" before applying.

### Story 4: AI Provider Configuration
**As an** Admin,
**I want** to select my preferred LLM (e.g., Claude 3.5 Sonnet, GPT-4o) and securely manage API keys,
**So that** I can control cost and intelligence level.

**Acceptance Criteria:**
*   **Settings Page:** `/admin/settings` (or a modal).
*   **Provider Selector:** Dropdown for OpenAI / Anthropic.
*   **Secure Input:** Masked input field for API Keys.
*   **Storage:** Keys are **never** returned to the client. Stored securely on server (env vars or encrypted DB field).
*   **Validation:** "Test Connection" button to verify the key works.

## Technical Requirements

### Database Schema (`shared/schema.ts`)
*   Update `disputes` table:
    *   `status`: enum (`pending`, `resolved`, `rejected`)
    *   `resolution_note`: text
    *   `ai_analysis`: jsonb (stores the last AI recommendation)
*   New `app_config` table (optional, or use env vars):
    *   Stores provider preference (keys should ideally stay in ENV, but if user inputs them in UI, we need a secure vault strategy).

### API Endpoints (`server/routes.ts`)
*   `POST /api/ai/analyze`: Triggers the LLM check.
*   `POST /api/disputes/:id/resolve`: Applies fix and updates status.
*   `POST /api/admin/config`: Updates provider settings (requires strict auth).

### Security
*   All admin routes protected by `isAdmin` middleware.
*   API keys stored in server-side memory or encrypted database columns, never exposed to frontend.

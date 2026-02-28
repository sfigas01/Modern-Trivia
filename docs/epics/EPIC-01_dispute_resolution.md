# Epic-01: Interactive Dispute Resolution

**Goal:** Enable Admins to resolve user-flagged errors efficiently with AI assistance via an interactive dashboard.
**Status:** 🚧 In Progress
**Prerequisites:** Database Provisioning

## Child Features (Program Layer)

- **FT-04: Admin Dispute Dashboard** (In Progress)
- **[FT-01: Reference Support](../features/FT-01_reference_support.md)** (Done)
- **[FT-02: Content Inventory & CMS](../features/FT-02_content_inventory.md)** (Scale)
- **[FT-03: AI Quality Sweep](../features/FT-03_ai_quality_sweep.md)** (Maintenance)

## ✅ Definition of Done (Epic Level)

- All child features (FT-01, FT-02, FT-03, and FT-04) are implemented and verified.
- Dispute Resolution Dashboard is fully functional in Production.
- Database infrastructure is provisioned and stable.

## 🚧 Implementation Status (Feb 23, 2026)

The project is currently in the **Integration & Deployment** phase. While the core application logic and UI components (FT-01 through FT-04) are functionally complete in development, the epic remains "In Progress" pending database provisioning and environment configuration for production readiness.

### Completed Work

- [x] **Database Schema:** Updated `shared/schema.ts` with `disputes` (status, analysis) and `app_config` tables.
- [x] **API Endpoints:** Implemented `server/routes.ts` for dispute management and AI analysis (`POST /api/disputes/:id/analyze`).
- [x] **AI Service:** `server/lib/ai.ts` calls OpenAI (`gpt-4o`) and stores structured analysis in `ai_analysis`.
- [x] **Admin UI:** Built `/admin/disputes` dashboard and `/admin/settings` page in React.
- [x] **Manual Override Workflow:** Admin can edit question/answer/explanation before apply (`STE-16`, `STE-17`, `STE-78`).

### ✅ Recently Resolved (Feb 23, 2026)

- `STE-16`: Admin can edit question text during dispute resolution.
- `STE-17`: AI analysis auto-fills editable answer/explanation fields.
- `STE-78`: Editable proposed-fix panel with confirm/apply flow is live.

### ⚠️ Pending Actions (CRITICAL)

The following steps must be taken by a developer to finalize deployment:

1. **Assess & Prepare Database:** Ensure a production PostgreSQL instance is provisioned and reachable.
2. **Set Environment Variables:** Configure `DATABASE_URL` and `SESSION_SECRET`.
3. **Push Schema:** Run `npm run db:push` to create/verify tables in production.
4. **Configure AI Keys:** Set provider credentials in production and verify analysis requests succeed.
5. **Run Smoke Test:** Complete end-to-end dispute workflow validation in production.

### 🐛 Known Issues & Bugs (To Tackle)

1. **Provider Selector:** OpenAI/Anthropic provider selector is still pending in settings UX.
2. **Test Connection Button:** API key/provider connection test action is still pending.

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
**I want** a centralized dashboard to view and manage all player disputes,
**So that** I can resolve the issues.

**Acceptance Criteria:**

- **Route:** `/admin/disputes`
- **List View:** Table showing correct/submitted answers, team name, and status.
- **Filters:** "Pending" (Default), "Resolved", "Rejected", "All".
- **Status Badges:** Visual indicators for dispute state.

### Story 2: AI Fact-Checker Integration

**As an** Admin,
**I want** to click "Analyze and Suggest" on a dispute to get an AI recommendation and source references,
**So that** I can save time on manual research while reviewing the facts.

**Acceptance Criteria:**

- **Action:** "Analyze" button on the dispute detail view.
- **Process:** System sends Question + Answer + Dispute to the configured LLM.
- **Output:** The UI displays:
  - **Verdict:** "Fix Required" or "Reject Dispute".
  - **Confidence:** High/Medium/Low.
  - **Reasoning:** Brief explanation with a citation URL.
  - **Proposed Fix:** If valid, show the new Question/Answer text.

### Story 3: One-Click Resolution

**As an** Admin,
**I want** to apply the AI's "Proposed Fix" with a single click,
**So that** the database is updated instantly and the dispute is marked resolved.

**Acceptance Criteria:**

- **Review Flow:** Admin sees a "Diff" view (Current vs. AI Proposed) and must click "Confirm & Apply" to finalize.
- **Resolve (Fix):** Updates `questions.json` (or DB entry) with new content, sets dispute status to `RESOLVED`, saves resolution note.
- **Reject:** Sets dispute status to `REJECTED` with a note (e.g., "Team was wrong").
- **Manual Override:** Admin can edit the "Proposed Fix" before applying.

### Story 4: AI Provider Configuration

**As an** Admin,
**I want** to select my preferred LLM (e.g., Claude 3.5 Sonnet, GPT-4o) and securely manage API keys,
**So that** I can control cost and intelligence level.

**Acceptance Criteria:**

- **Settings Page:** `/admin/settings` (or a modal).
- **Provider Selector:** Dropdown for OpenAI / Anthropic.
- **Secure Input:** Masked input field for API Keys.
- **Storage:** Keys are **never** returned to the client. Stored securely on server (env vars or encrypted DB field).
- **Validation:** "Test Connection" button to verify the key works.

## Technical Requirements

### Database Schema (`shared/schema.ts`)

- Update `disputes` table:
  - `status`: enum (`pending`, `resolved`, `rejected`)
  - `resolution_note`: text
  - `ai_analysis`: jsonb (stores the last AI recommendation)
- New `app_config` table (optional, or use env vars):
  - Stores provider preference (keys should ideally stay in ENV, but if user inputs them in UI, we need a secure vault strategy).

### API Endpoints (`server/routes.ts`)

- `POST /api/ai/analyze`: Triggers the LLM check.
- `POST /api/disputes/:id/resolve`: Applies fix and updates status.
- `POST /api/admin/config`: Updates provider settings (requires strict auth).

### Security

- All admin routes protected by `isAdmin` middleware.
- API keys stored in server-side memory or encrypted database columns, never exposed to frontend.

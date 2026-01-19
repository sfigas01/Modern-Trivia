# FT-02: Content Inventory & CMS

> **Specification For:** `docs/features/FT-02_content_inventory.md`

## 1. SAFe Strategic Alignment

| Metric | Value | Notes |
| :--- | :--- | :--- |
| **Parent Epic** | [EPIC-01: Dispute Resolution](epics/EPIC-01_dispute_resolution.md) | *Technically supports Dispute Res but enables future Scale* |
| **Benefit Hypothesis** | As an **Admin**, I want to **search, filter, and mass-edit questions**, so that I can **manage data quality and find duplicates** as the database grows to 10k+ items. | *Critical for scalability.* |
| **WSJF Score** | [High User Value] + [Med Time Criticality] / [Med Job Size] = **High** | *Essential before we add more content.* |

### Acceptance Criteria
*   [ ] Admin can view a paginated table of all questions.
*   [ ] Admin can filter by Category, Difficulty, and Tag.
*   [ ] Admin can textual search for questions or answers.
*   [ ] Admin can edit a question directly from the inventory list.

---

## 2. AI Implementation Spec (Spec-Driven Dev)

### Phase 1: Specify (Context & Outcomes)
*> **Goal:** Enable Admins to manage the question lifecycle at scale.*

**User Journey / Problem Context:**
Currently, questions are a JSON file or simple list. Admins cannot find "that one question about fish" without scrolling. As we import thousands of AI-generated questions, we need a robust CMS interface to "manage the inventory."

**Success Outcomes:**
*   Admin can find any specific question in < 5 seconds.
*   Admin can visually identify "stub" or "bad" questions (empty fields).
*   Zero latency UI for < 5000 items (client-side sort/filter OK initially, server-side later).

---

### Phase 2: Plan (Technical Design)
*> **Goal:** Define the stack, architecture, and constraints.*

**Architecture & Components:**
*   **Frontend:** `InventoryPage` using `TanStack Table` (or similar React table).
    *   Columns: ID, Category, Question (truncated), Answer, Tags, Actions.
*   **Backend:** `GET /api/questions` with query params `?search=` and `?category=`.
*   **Database:** Ensure efficient indexing on `question` text for search.

**Constraints & Standards:**
*   Must reuse existing `AdminLayout`.
*   Mobile-responsive table (hide less important columns).

---

### Phase 3: Tasks (Work Breakdown)
*> **Goal:** Atomic, verifiable steps for the AI Agent to execute.*

- [ ] **Task 1:** Backend Search API
    -   *Implementation:* Create/Update `GET /api/questions` to accept filters.
    -   *Verification:* `curl` request with search term returns filtered subset.
- [ ] **Task 2:** Inventory Table UI
    -   *Implementation:* Build React table page with search bar and difficulty dropdown.
    -   *Verification:* Verify sorting works on headers.
- [ ] **Task 3:** Edit Modal Integration
    -   *Implementation:* Reuse "Edit Question" form in a modal when clicking a row.
    -   *Verification:* Saving updates the list row immediately.

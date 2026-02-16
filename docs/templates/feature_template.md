# FT-XX: Feature Title

> **Use this template for all new Feature Specifications.**
> **Filename:** `FT-XX_snake_case_name.md`
> **Location:** `docs/features/`

## 1. SAFe Strategic Alignment

| Metric                 | Value                                                                         | Notes                         |
| :--------------------- | :---------------------------------------------------------------------------- | :---------------------------- |
| **Parent Epic**        | [Link to Epic]                                                                |                               |
| **Benefit Hypothesis** | As a [role], I want [action], so that [benefit].                              | _Why is this valuable?_       |
| **WSJF Score**         | [User-Business Value] + [Time Criticality] + [RR/OE] / [Job Size] = **SCORE** | _Weighted Shortest Job First_ |

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

---

## 2. AI Implementation Spec (Spec-Driven Dev)

### Phase 1: Specify (Context & Outcomes)

_> **Goal:** Describe the user journey and success state. Avoid technical implementation details here._

**User Journey / Problem Context:**
[Describe the problem and how the user resolves it with this feature.]

**Success Outcomes:**

- Outcome 1
- Outcome 2

---

### Phase 2: Plan (Technical Design)

_> **Goal:** Define the stack, architecture, and constraints. Agent uses this to understand "HOW"._

**Architecture & Components:**

- **Frontend:** [Components to create/modify]
- **Backend:** [API endpoints, Services]
- **Database:** [Schema changes]

**Constraints & Standards:**

- [e.g., maintain accessibility, use existing UI library]

---

### Phase 3: Tasks (Work Breakdown)

_> **Goal:** Atomic, verifiable steps for the AI Agent to execute._

- [ ] **Task 1:** [Task Name]
  - _Implementation:_ [Brief details]
  - _Verification:_ [How to verify]
- [ ] **Task 2:** [Task Name]

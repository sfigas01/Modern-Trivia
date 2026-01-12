# Dispute QA User Stories

> **Objective:** Enable an AI QA agent to review player disputes and help admins make corrections through a file-based batch workflow, while maintaining one-by-one review capability.

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     BATCH REVIEW WORKFLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. EXPORT                                                      │
│     Admin downloads disputes-export-2026-01-12.json             │
│                           │                                     │
│                           ▼                                     │
│  2. AI REVIEW                                                   │
│     Admin + AI QA agent review disputes together                │
│     AI adds recommendations, reasoning, sources                 │
│     Admin marks each: approved / rejected                       │
│                           │                                     │
│                           ▼                                     │
│  3. IMPORT                                                      │
│     Admin uploads reviewed file                                 │
│     System shows preview of changes                             │
│     Admin confirms → questions updated                          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                    ONE-BY-ONE WORKFLOW                          │
├─────────────────────────────────────────────────────────────────┤
│     Admin reviews single dispute in panel                       │
│     Edits question directly OR marks rejected                   │
│     Dispute status updated immediately                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## User Stories

### User Story 1: Export Disputes for Batch Review

**As an** admin,
**I want** to download all pending disputes as a structured file,
**So that** I can review them in batch with an AI QA agent outside the app.

**Acceptance Criteria:**
- "Export Disputes" button in Admin panel downloads a JSON file containing:
  - All dispute records with full context
  - The associated question object for each dispute (answer, tags, explanation, acceptableAnswers)
  - Export timestamp and metadata
- File naming convention: `disputes-export-YYYY-MM-DD.json`
- Export includes a `status` field per dispute defaulted to `pending`
- Option to export "all" or "unresolved only"

**Example Export Structure:**
```json
{
  "exportedAt": "2026-01-12T10:30:00Z",
  "totalDisputes": 5,
  "disputes": [
    {
      "id": "dispute-123",
      "status": "pending",
      "teamName": "Quiz Lords",
      "teamExplanation": "The answer should be Ricky, not Julian",
      "submittedAnswer": "Ricky",
      "timestamp": "2026-01-10T19:45:00Z",
      "question": {
        "id": "q128",
        "question": "Who plays the character Julian in Trailer Park Boys?",
        "answer": "John Paul Tremblay",
        "acceptableAnswers": [],
        "explanation": "John Paul Tremblay portrays Julian in the Canadian mockumentary series.",
        "category": "Entertainment",
        "difficulty": "Medium",
        "tags": ["CA", "Entertainment", "TimeCapsule"]
      }
    }
  ]
}
```

---

### User Story 2: AI-Assisted Dispute Review File Format

**As an** admin working with an AI QA agent,
**I want** a standardized format for the AI to document its recommendations,
**So that** I can review suggestions and decide what to approve before importing.

**Acceptance Criteria:**
- Documented file format for AI recommendations (added to QA instructions)
- AI adds to each dispute object:
  - `aiRecommendation`: `update_answer` | `add_acceptable_answer` | `reject_dispute` | `needs_human_review`
  - `aiReasoning`: explanation with sources
  - `suggestedChanges`: proposed question updates (if any)
  - `confidence`: `high` | `medium` | `low`
  - `verificationSource`: URL or citation
- Admin reviews the file, changes `status` to `approved` or `rejected` for each
- Clear workflow documented in `docs/TRIVIA_QA_INSTRUCTIONS.md`

**Example After AI Review:**
```json
{
  "id": "dispute-123",
  "status": "approved",
  "teamName": "Quiz Lords",
  "teamExplanation": "The answer should be Ricky, not Julian",
  "submittedAnswer": "Ricky",
  "timestamp": "2026-01-10T19:45:00Z",
  "aiRecommendation": "reject_dispute",
  "aiReasoning": "The team misunderstood the question. The question asks who PLAYS Julian (the actor), not who Julian is. John Paul Tremblay is correct - he plays the character Julian. The team's answer 'Ricky' is a character name, not an actor.",
  "verificationSource": "https://en.wikipedia.org/wiki/Trailer_Park_Boys",
  "confidence": "high",
  "suggestedChanges": null,
  "question": {
    "id": "q128",
    "question": "Who plays the character Julian in Trailer Park Boys?",
    "answer": "John Paul Tremblay",
    "acceptableAnswers": ["Tremblay", "JP Tremblay"],
    "explanation": "John Paul Tremblay portrays Julian in the Canadian mockumentary series.",
    "category": "Entertainment",
    "difficulty": "Medium",
    "tags": ["CA", "Entertainment", "TimeCapsule"]
  }
}
```

**Example with Approved Changes:**
```json
{
  "id": "dispute-456",
  "status": "approved",
  "teamName": "Brainy Bunch",
  "teamExplanation": "Ottawa wasn't chosen in 1857, it was 1857 when Queen Victoria chose it but it became capital in 1867",
  "submittedAnswer": null,
  "timestamp": "2026-01-11T20:15:00Z",
  "aiRecommendation": "update_answer",
  "aiReasoning": "Team is partially correct. Queen Victoria chose Ottawa in 1857, but it officially became the capital when the Constitution Act took effect on July 1, 1867. The explanation should clarify this.",
  "verificationSource": "https://www.canada.ca/en/canadian-heritage/services/capital-canada.html",
  "confidence": "high",
  "suggestedChanges": {
    "explanation": "Queen Victoria chose Ottawa as the capital in 1857. It officially became the capital of the new Dominion of Canada on July 1, 1867, with Confederation."
  },
  "question": { ... }
}
```

---

### User Story 3: Import Reviewed Questions

**As an** admin,
**I want** to upload a reviewed disputes file to apply approved changes to questions,
**So that** I can batch-update the question database after AI-assisted review.

**Acceptance Criteria:**
- "Import Reviews" button in Admin panel accepts a JSON file
- System processes only disputes marked `status: "approved"` that have `suggestedChanges`
- For each approved dispute with `suggestedChanges`:
  - Updates the corresponding question in the database
  - Marks the original dispute as resolved
- Preview screen shows changes before applying (diff view):
  - Question ID
  - Field being changed
  - Current value → New value
- Confirmation step: "Apply X changes to Y questions?"
- Summary report after import:
  - Successfully applied: N
  - Skipped (no changes): N
  - Errors: N (with details)
- Rejected disputes are marked as resolved with no question changes
- Disputes marked `needs_human_review` remain pending

---

### User Story 4: Dispute Status Tracking

**As an** admin,
**I want** disputes to track their resolution status,
**So that** I know which disputes have been addressed (via batch or one-by-one).

**Acceptance Criteria:**
- Add fields to disputes table:
  - `status`: `pending` | `resolved` | `rejected` (default: `pending`)
  - `resolvedAt`: timestamp (nullable)
  - `resolutionNote`: text (nullable) - e.g., "Fixed typo in answer" or "Answer was correct"
- Admin panel shows status filter: "All" | "Pending" | "Resolved" | "Rejected"
- Default view shows "Pending" disputes
- One-by-one review in admin panel can:
  - Mark dispute as resolved (with optional note)
  - Mark dispute as rejected (with optional note)
- Batch import automatically updates status for processed disputes
- Visual indicators in dispute list:
  - Pending: no badge (default)
  - Resolved: green checkmark or "Resolved" badge
  - Rejected: red X or "Rejected" badge
- Resolved/rejected disputes show resolution note and timestamp

---

### User Story 5: QA Workflow Documentation

**As an** admin or AI QA agent,
**I want** clear documentation of the dispute review workflow,
**So that** the process is consistent and repeatable.

**Acceptance Criteria:**

**Update `docs/TRIVIA_QA_INSTRUCTIONS.md` with:**
- New section: "Dispute Review Workflow"
- Step-by-step instructions for batch review process
- File format specification (export and reviewed formats)
- AI review prompts/commands:
  - "Review disputes in [filename]"
  - "Verify dispute claim for question [id]"
  - "Add AI recommendations to disputes file"
- Decision criteria for each recommendation type:
  - `update_answer`: When the stored answer is factually wrong
  - `add_acceptable_answer`: When team's answer is valid but not in acceptableAnswers
  - `reject_dispute`: When the stored answer is correct and team is wrong
  - `needs_human_review`: When uncertain or requires subjective judgment
- Example session walkthrough

**Update `CLAUDE.md` quick reference with:**
- "Review disputes export file" command
- "Verify dispute [id] claim" command

**AI Agent Checklist for Dispute Review:**
- [ ] Web search to verify the factual claim
- [ ] Check if team's answer matches any acceptableAnswers
- [ ] Consider if question wording is ambiguous
- [ ] Cite verification source
- [ ] Assign confidence level
- [ ] Provide clear reasoning

---

## Priority & Effort Estimates

| Priority | Story | Effort | Notes |
|----------|-------|--------|-------|
| P0 | Story 4: Status Tracking | Small | Schema change + UI filter - foundation for tracking |
| P0 | Story 1: Export | Small | JSON download button - enables batch workflow |
| P1 | Story 5: Documentation | Small | Docs update - enables AI agent usage |
| P1 | Story 2: AI Review Format | Small | Format spec in docs - standardizes AI output |
| P2 | Story 3: Import | Medium | File upload + preview + apply logic - completes the loop |

**MVP (P0 + P1):** Stories 1, 2, 4, 5 - Admin can export, work with AI, and track status manually.

**Full Solution (+ P2):** Add Story 3 for automated import of approved changes.

---

## Future Considerations

Once this workflow is validated, consider:
- API endpoints to enable real-time AI agent access (removes export/import friction)
- Automated dispute triage (AI pre-reviews new disputes as they come in)
- Analytics dashboard for dispute patterns and AI accuracy
- Integration with CI/CD to auto-update `questions.json` from approved imports

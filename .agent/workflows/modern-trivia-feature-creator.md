---
name: modern-trivia-feature-creator
description: "Create and maintain feature specs for the Modern Trivia app. Use when (1) breaking down an epic into implementable features, (2) specifying a new piece of functionality, (3) updating feature status or tasks after work completes. Features use spec-driven development phases (Specify → Plan → Tasks) blended with SAFe practices for strategic alignment."
---

# Modern Trivia Feature Creator

Create feature specs that serve both humans (strategic value) and AI agents (implementation clarity). Features are the primary work unit - epics are containers, features are what gets built.

## Feature Structure

```markdown
# FT-XX: [Feature Name]

## Strategic Alignment (SAFe)
**Parent Epic:** [EPIC-XX](../epics/EPIC-XX_name.md)
**Status:** [emoji + label]
**Last Updated:** [date and brief note]

**Benefit Hypothesis:** If we [deliver this feature], then [expected outcome] for [users], measured by [metric].

**Acceptance Criteria:**
- [ ] [Testable condition 1]
- [ ] [Testable condition 2]
- [ ] [Testable condition 3]

---

## Phase 1: Specify (The What & Why)

### Problem Context
[What pain point or gap exists? Why does this matter now?]

### User Journey
[Walk through the experience from the user's perspective. No technical details.]

**Actor:** [Who is doing this?]
**Trigger:** [What initiates this flow?]
**Steps:**
1. User [does X]
2. System [responds with Y]
3. User [sees/experiences Z]

**End State:** [What does success look like for the user?]

### Success Outcomes
- [Measurable outcome 1]
- [Measurable outcome 2]

---

## Phase 2: Plan (The How)

### Technical Approach
[High-level architecture decision. 2-3 sentences max.]

### Data Model Changes
[Schema changes, new fields, migrations needed]

### Component Changes
[Which files/modules are affected]

### Constraints & Dependencies
- [Technical constraint or dependency 1]
- [External dependency if any]

---

## Phase 3: Tasks (The Work)

### Checklist
- [ ] **Task 1:** [Atomic, verifiable step]
- [ ] **Task 2:** [Atomic, verifiable step]
- [ ] **Task 3:** [Atomic, verifiable step]
- [ ] **Task 4:** [Atomic, verifiable step]

### Verification
[How to test that this feature works end-to-end]
```

## Status Vocabulary

Use consistent labels (matches epic-creator skill):

| Status | Emoji | Meaning |
|--------|-------|---------|
| Draft | 📝 | Spec in progress, not ready for implementation |
| Ready | 📋 | Spec complete, ready for an agent to pick up |
| In Progress | 🏗️ | Active development |
| Blocked | 🚫 | Cannot proceed (see notes) |
| Review | 👀 | Code complete, needs human review |
| Done | ✅ | Shipped and verified |

## Phase Guidelines

### Phase 1: Specify
**Purpose:** Capture intent without prescribing implementation.

**Do:**
- Focus on user experience and outcomes
- Use plain language a non-developer could understand
- Describe the problem before the solution
- Include edge cases in the user journey

**Don't:**
- Mention specific technologies, libraries, or code
- Jump to UI layouts or database schemas
- Assume implementation approach

**Validation checkpoint:** Could a product manager read this and understand what we're building and why?

---

### Phase 2: Plan
**Purpose:** Translate intent into technical decisions.

**Do:**
- Reference existing patterns in the codebase
- Specify data model changes explicitly
- List all files/components that will change
- Note constraints (performance, security, compatibility)

**Don't:**
- Write actual code (that's implementation)
- Over-specify - leave room for agent judgment
- Ignore existing architecture

**Validation checkpoint:** Could an AI agent read this and know which files to touch and what patterns to follow?

---

### Phase 3: Tasks
**Purpose:** Break work into atomic, verifiable steps.

**Do:**
- Make each task completable in isolation
- Make each task testable (how do you know it's done?)
- Order tasks logically (dependencies first)
- Keep tasks small (30 min - 2 hours of work each)

**Don't:**
- Combine multiple changes in one task
- Leave tasks vague ("implement the feature")
- Skip the verification step

**Validation checkpoint:** Could an AI agent pick up any single task and complete it without needing to ask clarifying questions?

## Workflow

### Creating a New Feature

1. **Check the parent epic** - Ensure the feature aligns with epic scope and goals

2. **Find the next ID** - Run `ls docs/features/` to find next available FT-XX number

3. **Start with Phase 1** - Write Specify section first, get validation before proceeding

4. **Complete Phase 2** - Only after Phase 1 is solid, add technical plan

5. **Break into Tasks** - Only after Phase 2 is approved, create task checklist

6. **Save the file** - `docs/features/FT-XX_slug_name.md`

7. **Link from parent epic** - Add row to epic's Features table

8. **Update roadmap** - Add entry to `docs/PRODUCT_ROADMAP.md`

### Updating Feature Status

When work progresses:

1. Update **Status** field with correct emoji + label
2. Update **Last Updated** with date and brief note
3. Check off completed **Tasks** in Phase 3
4. Check off met **Acceptance Criteria** in SAFe section
5. When all tasks and AC complete, mark as ✅ Done

### Agent Handoff Notes

After completing work, add a note:

```markdown
**Last Updated:** Jan 18, 2026 - Tasks 1-3 complete. Task 4 blocked on API key config.
```

## Writing Tips

### Benefit Hypothesis Formula
```
If we [deliver X], 
then [outcome Y] for [user group Z], 
measured by [metric W].
```

**Example:**
> If we add source citations to answers, then players will trust disputed answers more, measured by 50% reduction in repeat disputes on cited questions.

### Acceptance Criteria Formula
Write as testable conditions:
- ✅ "Source link appears below explanation on reveal screen"
- ✅ "Link opens in new tab"
- ❌ "Sources work correctly" (too vague)

### Task Granularity
Break down until each task is:
- **Atomic:** One logical change
- **Verifiable:** Clear done state
- **Independent:** Minimal dependencies on other tasks

**Too big:** "Add source support to the app"
**Right size:** "Add sourceUrl field to Question interface in store.tsx"

## Quality Checklist

Before marking a feature Ready:

- [ ] Benefit hypothesis uses If/Then/Measured-by format
- [ ] Acceptance criteria are testable (not vague)
- [ ] Phase 1 has no technical jargon
- [ ] Phase 2 references actual files in the codebase
- [ ] Phase 3 tasks are atomic and verifiable
- [ ] File follows naming: `FT-XX_slug_name.md`
- [ ] Linked from parent epic's Features table
- [ ] Added to PRODUCT_ROADMAP.md

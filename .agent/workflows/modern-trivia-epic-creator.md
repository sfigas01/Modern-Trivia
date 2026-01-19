---
name: modern-trivia-epic-creator
description: "Create and maintain epics for the Modern Trivia app. Use when (1) starting a new major initiative or feature set, (2) updating epic status after completing work, (3) reviewing what's blocked or ready for development. Epics are strategic containers linking to feature specs (FT-XX) where implementation details live."
---

# Modern Trivia Epic Creator

Create lightweight, AI-agent-optimized epics that balance SAFe principles with practical PRD elements.

## Epic Structure

Epics follow this structure, optimized for AI agents to quickly understand context and find actionable work:

```markdown
# EPIC-XX: [Name]

## Context
**Problem:** [1-2 sentences: what pain point or opportunity exists]
**Value:** [1 sentence: why this matters to users/business]
**Success Metrics:** [2-3 measurable outcomes]

## Current State
**Status:** [emoji + label from vocabulary below]
**Blockers:** [what's preventing progress, or "None"]
**Last Updated:** [date and brief note]

## Scope
**In Scope:**
- [boundary 1]
- [boundary 2]

**Out of Scope:**
- [explicit exclusion 1]

**Technical Constraints:**
- [dependency, environment requirement, or limitation]

## Features
| ID | Name | Status | Notes |
|----|------|--------|-------|
| FT-XX | [name] | [status] | [brief context] |

## Technical Notes
[Schema changes, API endpoints, key dependencies - keep brief, link to details]

## Workflow
[Mermaid diagram if helpful for complex flows]
```

## Status Vocabulary

Use consistent status labels so any agent can parse state:

| Status | Emoji | Meaning |
|--------|-------|---------|
| Planned | 📋 | Defined but not started |
| In Progress | 🏗️ | Active development |
| Blocked | 🚫 | Cannot proceed (see Blockers) |
| Code Complete | ✅ | Built, pending validation/infra |
| Done | 🎉 | Fully shipped and verified |

## Workflow

### Creating a New Epic

1. **Identify the problem first** - What user pain or business need drives this? Avoid solution-first thinking.

2. **Define success measurably** - Use specific metrics: "Reduce X by 30%" not "Improve X"

3. **Set boundaries early** - Explicit in/out of scope prevents scope creep and helps agents know their limits

4. **Check existing IDs** - Run `ls docs/epics/` to find the next available EPIC-XX number

5. **Create the file** - Save to `docs/epics/EPIC-XX_slug_name.md`

6. **Update the roadmap** - Add entry to `docs/PRODUCT_ROADMAP.md`

### Updating Epic Status

When work completes on an epic or blocker status changes:

1. Update the **Status** field with correct emoji + label
2. Update **Last Updated** with date and brief note
3. Update **Blockers** field (clear if resolved)
4. Update linked feature statuses in the Features table

### Agent Handoff Notes

When an agent completes work, add a brief note in this format:

```markdown
**Last Updated:** Jan 18, 2026 - Completed FT-02, API endpoints tested. Blocked on DB provisioning.
```

This helps the next agent (or human) understand current state without reading full history.

## Writing Guidelines

**For Context section:**
- Problem statement should be user/business focused, not technical
- Value connects to why someone would care about solving this
- Metrics should be verifiable (how will you know it worked?)

**For Scope section:**
- Be explicit about what's NOT included - prevents agents from gold-plating
- Technical constraints inform implementation choices

**For Features table:**
- Each feature should have its own FT-XX spec in `docs/feature_specs/`
- Epic stays thin; features contain implementation detail
- Status in table should match the feature spec's status

**For Technical Notes:**
- Keep brief - link to detailed docs where needed
- Focus on cross-cutting concerns (schema, APIs, dependencies)
- Include anything an agent needs before writing code

## Quality Checklist

Before finalizing an epic:

- [ ] Problem statement is user-focused, not solution-focused
- [ ] Success metrics are specific and measurable
- [ ] Scope boundaries are explicit
- [ ] At least one feature is identified (even if spec pending)
- [ ] Status uses standard vocabulary
- [ ] File follows naming convention: `EPIC-XX_slug_name.md`
- [ ] Added to PRODUCT_ROADMAP.md

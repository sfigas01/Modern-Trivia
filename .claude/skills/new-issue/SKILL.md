---
name: new-issue
description: Quickly capture a new idea, bug, or feature as a Linear issue for the Modern Trivia project. Use when the user says they have an idea, found a bug, or wants to log something for later.
argument-hint: [optional brief description of the idea]
---

# New Issue Capture

You are helping the user quickly capture an idea or issue into Linear without breaking their flow. Keep it lightweight — the goal is fast capture, not full specification.

## Team

- Team: **The Vibes** (key: STE)

## Steps

1. **Get the idea.** If the user provided arguments (`$ARGUMENTS`), use that as the starting point. Otherwise, ask: "What's the idea or issue?"

2. **Determine the type.** If it's obvious from context, assign it. If not, ask:
   - **Bug** — something is broken or wrong
   - **Feature** — a new capability or addition
   - **Improvement** — an enhancement to something that already exists

3. **Capture just enough detail.** Ask a few quick follow-up questions if needed to make the issue actionable for another agent later. Aim for:
   - A clear, concise title
   - A 2–4 sentence description covering: what it is, why it matters, and any known constraints or context
   - If the user mentioned specific files, components, or behavior, include those

4. **Determine readiness.** Based on what was captured, decide:
   - **Ready** — there's enough detail that an agent or developer could start working on it without further clarification
   - **Not Ready** — the idea needs more discussion, research, or specification before work can begin

5. **Create the issue in Linear** using the `save_issue` tool with:
   - `title`: concise, descriptive title
   - `team`: "The Vibes"
   - `description`: the captured detail in markdown. If **Not Ready**, append a section:
     ```
     ---
     **Status: Needs refinement before development can begin.**
     Open questions or areas to flesh out:
     - [list what's missing or uncertain]
     ```
   - `labels`: Apply the type label (`Bug`, `Feature`, or `Improvement`) AND the readiness label (`Ready` or `Not Ready`)
   - `priority`: Ask only if the user volunteers it or it's clearly urgent. Otherwise default to `3` (Normal).

6. **Confirm.** Tell the user the issue was created, show the identifier (e.g., STE-123), and mention whether it was tagged Ready or Not Ready.

## Guidelines

- Keep the conversation fast. 1–3 exchanges max before creating the issue.
- Don't ask for acceptance criteria, story points, or full specs. This is quick capture.
- If the user is mid-coding, be especially brief — capture the idea and get out of the way.
- Always include enough context that someone reading the issue cold can understand the intent.

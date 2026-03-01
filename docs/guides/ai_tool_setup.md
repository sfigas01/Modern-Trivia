# AI Tool Setup for Trivia QA

Configuration files for using AI coding assistants to review the Modern Trivia question database.

## Tool Setup

### Shared Root Instructions (All Active Agents)

- `AGENTS.md`, `CLAUDE.md`, and `replit.md` are intentionally kept in sync and contain the same shared rules/context.
- If a tool auto-loads only one root file, that is acceptable because the three files are mirrored.

### Claude Code

- `CLAUDE.md` in repo root — auto-loads when you open the project
- Just start giving commands like "Review questions 1-50 for factual accuracy"

### Codex

- `AGENTS.md` in repo root — shared rules/context for Codex sessions

### Replit Agent

- `replit.md` in repo root — shared rules/context for Replit agent sessions

### Google Antigravity

1. Open Antigravity → Click `...` menu → Customizations → Rules
2. Set scope to "Workspace"
3. Paste the following rules:

```
You are a trivia content QA specialist. Read docs/guides/qa_instructions.md for complete guidelines.

Key Files:
- Question database: client/src/lib/questions.json
- Full instructions: docs/guides/qa_instructions.md

Critical Rules:
- Always web search to verify facts before making corrections
- GlobalEh must NOT be US-centric
- FreshPrints must be from last 3 months
- Verify celebrity nationality before applying regional tags

Commit format: type(content): description
```

### Other Tools

Ask the AI to read `docs/guides/qa_instructions.md` at the start of each session.

## Common Commands (All Tools)

| Command                                      | What it does                    |
| -------------------------------------------- | ------------------------------- |
| "Review questions 1-50 for factual accuracy" | Checks facts, reports errors    |
| "Check pillar distribution"                  | Compares to 30/30/25/15 targets |
| "Find US-centric GlobalEh questions"         | Flags editorial violations      |
| "Find stale FreshPrints content"             | Finds outdated content          |
| "Fix question q128: [issue]"                 | Makes specific correction       |
| "Find duplicate questions"                   | Reports duplicates              |

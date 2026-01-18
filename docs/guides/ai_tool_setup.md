# AI Tool Setup for Trivia QA

Configuration files for using AI coding assistants to review the Modern Trivia question database.

## Tool Setup

### Claude Code
- `CLAUDE.md` in repo root — auto-loads when you open the project
- Just start giving commands like "Review questions 1-50 for factual accuracy"

### Cursor
- `.cursorrules` in repo root — auto-loads when you open the project

### Google Antigravity
1. Open Antigravity → Click `...` menu → Customizations → Rules
2. Set scope to "Workspace"
3. Paste the following rules:

```
You are a trivia content QA specialist. Read docs/TRIVIA_QA_INSTRUCTIONS.md for complete guidelines.

Key Files:
- Question database: client/src/lib/questions.json
- Full instructions: docs/TRIVIA_QA_INSTRUCTIONS.md

Critical Rules:
- Always web search to verify facts before making corrections
- GlobalEh must NOT be US-centric
- FreshPrints must be from last 3 months
- Verify celebrity nationality before applying regional tags

Commit format: type(content): description
```

### Other Tools
Ask the AI to read `docs/TRIVIA_QA_INSTRUCTIONS.md` at the start of each session.

## Common Commands (All Tools)

| Command | What it does |
|---------|--------------|
| "Review questions 1-50 for factual accuracy" | Checks facts, reports errors |
| "Check pillar distribution" | Compares to 30/30/25/15 targets |
| "Find US-centric GlobalEh questions" | Flags editorial violations |
| "Find stale FreshPrints content" | Finds outdated content |
| "Fix question q128: [issue]" | Makes specific correction |
| "Find duplicate questions" | Reports duplicates |

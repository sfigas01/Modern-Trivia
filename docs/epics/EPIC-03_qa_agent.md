# EPIC-03: AI QA "Guardian" Agent

## Context
**Problem:** We have multiple needs for content verification (Disputes, Mass Audits, Import Pipeline) but currently no centralized "Brain" to enforce quality standards consistently. One-off scripts (like FT-03) recall the AI ad-hoc, leading to drift in personality and exactness.
**Value:** A centralized, versioned "Content Guardian" agent ensures that whether a question is being disputed, imported, or audited, the same high standard of "Editorial Voice" and "Fact Checking" is applied.
**Success Metrics:**
*   **Reuse:** Agent is successfully called by at least 3 distinct features (Disputes, Audit, Import).
*   **Accuracy:** Agent achieves >95% agreement with human editorial decisions.
*   **Latency:** Analysis completes in < 3s for single-item checks.

## Current State
**Status:** 📋 Planned
**Blockers:** None
**Last Updated:** Jan 18, 2026 - Initial creation.

## Scope
**In Scope:**
- **Core Logic:** A centralized service (`server/lib/guardian.ts`) that validates the **Complete Q&A Pair**.
    - **Question Quality:** Checks for grammar, ambiguity, "Answer Leakage" (answer is in the question), negative/biased phrasing, and factual correctness.
    - **Answer Accuracy:** Verifies the fact is correct and up-to-date.
    - **Metadata:** Validates tags, difficulty, and distractors.
- **Rules Engine:** Configurable policies (e.g., "Allow slang" = true/false) passed at runtime or stored in config.
- **Tools:** Integration with Search (for fact checking) and Context (previous questions).

**Out of Scope:**
- **UI:** This Epic is "Headless". The UI belongs to the features consuming it (e.g., Dispute Dashboard).

**Technical Constraints:**
- Must support multiple LLM backends (OpenAI/Anthropic) via `app_config`.

## Features
| ID | Name | Status | Notes |
|----|------|--------|-------|
| **FT-05** | **Agent Core & Rules Engine** | 📋 Planned | The "Brain": inputs (Question) -> output (Verdict). |
| **FT-06** | **Search Tool integration** | 📋 Planned | Giving the agent "Eyes" to verify facts via Perplexity/Google. |
| **FT-07** | **Test Harness / Playground** | 📋 Planned | A simple dev UI to test prompts against edge cases. |
| **FT-03** | **Integration: Quality Sweep** | 📋 Planned | *Linked here as a Consumer of this agent.* |

## Technical Notes
*   This agent will be the "single source of truth" for prompt engineering.
*   Likely needs a "Prompt Management" strategy (versioned prompts).

## Workflow
```mermaid
graph TD
    Consumer[Dispute OR Audit OR Import] -->|Request| Guardian(Guardian Agent)
    Guardian -->|1. Check Rules| Rules{Policy Engine}
    Guardian -->|2. Verify Facts| Search[Web Search Tool]
    Guardian -->|3. Generate Report| LLM
    LLM --> Result[JSON: {valid, issues[], fix}]
    Result --> Consumer
```

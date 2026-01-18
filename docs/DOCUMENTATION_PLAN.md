# Documentation Reorganization Plan

This plan aims to structure the `docs/` directory to scale with the new Roadmap and Epic-based workflow.

## Naming Conventions
*   **Epics:** `docs/epics/EPIC-00_slug_name.md`
    *   Why: Prefixing with `EPIC-` and a number helps ordering and clarity.
*   **Guides:** `docs/guides/topic_name.md`
    *   Why: Separates "How-To" operational manuals from strategy.
*   **Specs:** `docs/specs/topic_name.md`
    *   Why: Deep technical details referenced by Epics.

## Proposed Moves

| Current File | New Location | Rationale |
| :--- | :--- | :--- |
| `docs/DISPUTE_QA_USER_STORIES.md` | `docs/epics/EPIC-01_dispute_resolution.md` | This is the source of truth for the "Now" epic. |
| *New File* | `docs/epics/EPIC-02_backstage_pipeline.md` | Placeholder for the "Next" epic. |
| `docs/TRIVIA_QA_INSTRUCTIONS.md` | `docs/guides/qa_instructions.md` | Operational guide used by AI/Humans. |
| `docs/AI_TOOL_SETUP.md` | `docs/guides/ai_tool_setup.md` | Setup guide. |
| `docs/ADMIN_SETUP.md` | `docs/guides/admin_setup.md` | Setup guide. |
| `docs/QUALITY_REVIEW_CONTEXT.md` | `docs/specs/quality_criteria.md` | Deep dive on quality rules. |
| `docs/STATE_MACHINE.md` | `docs/specs/game_state_machine.md` | Technical spec. |
| `docs/REFERENCE_SUPPORT_SPEC.md` | `docs/specs/reference_support.md` | Technical spec. |

## Root Files (Stay in `docs/`)
*   `PRODUCT_ROADMAP.md` (The Main Entry Point)

## Next Steps
1.  Create directories: `epics`, `guides`, `specs`.
2.  Move files.
3.  Update internal links in `PRODUCT_ROADMAP.md` and `CLAUDE.md`.

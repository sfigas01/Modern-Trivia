# Documentation Standards & Naming Conventions

This document defines the rules for creating and maintaining documentation in the Modern Trivia project. All contributors (human and AI) must follow these standards.

## Directory Structure

| Directory | Purpose | Naming Convention |
| :--- | :--- | :--- |
| `docs/epics/` | High-level business goals or major initiatives. | `EPIC-XX_slug_name.md` |
| `docs/feature_specs/` | Detailed technical specifications for specific features. | `FT-XX_slug_name.md` |
| `docs/guides/` | Operational manuals, "How-To" guides, and setup instructions. | `slug_name.md` (No ID prefix) |
| `docs/` (Root) | High-level project maps (Roadmap). | `UPPERCASE_FILENAME.md` |

## Naming Rules

### IDs (Epics & Features)
*   **Epics:** Use `EPIC-01`, `EPIC-02`, etc.
*   **Features:** Use `FT-01`, `FT-02`, etc.
*   **Sequential:** Increment the number based on the last used ID in the directory.

### Filenames
*   Use `snake_case` for the slug part of the name.
*   **Correct:** `EPIC-01_dispute_resolution.md`
*   **Incorrect:** `EPIC-01-DisputeResolution.md`, `EPIC-1_dispute.md`

## Roadmap Integration
Every new Epic or Feature Spec **must** be added to `docs/PRODUCT_ROADMAP.md`.

1.  **Add to Status Table:**
    *   Include ID, Status (NOW/NEXT/LATER), Timeline, Focus Area, Description, and Relative Link.
2.  **Add to Content Section:**
    *   Use the ID in the header: `### EPIC-01: Name` or `### FT-01: Name`.
    *   Link the "Reference Spec" to the file.

## Agent Behavior
*   When creating a new spec, **always** check the existing IDs to find the next available number.
*   **Never** create a file in `docs/` without categorizing it into `epics/`, `feature_specs/`, or `guides/` (unless it's a root map).

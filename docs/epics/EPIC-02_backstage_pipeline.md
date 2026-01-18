# Epic-02: Backstage Content Pipeline

**Goal:** Enable high-volume, "Spoiler-Free" import of new questions directly from AI generation.
**Status:** 📋 Planned
**Prerequisites:** None

## Context
Creating new questions currently requires humans to read and verify them, which spoils the answers for the creator. We need a "Blind Import" system where an AI Gatekeeper rigorously validates new content before it enters the database.

## Key Deliverables
1.  **Staging Environment:** A temporary storage (`staging.json`) where rejected/pending questions sit.
2.  **The Gatekeeper:** An automated script that runs validation rules (fact checking, deduping) on staging items.
3.  **Bulk Import Tool:** A CLI or UI to trigger the gatekeeper and promote passing items to `questions.json`.

## User Stories
*   (To be defined in detail during planning phase)

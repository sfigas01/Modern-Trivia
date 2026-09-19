---
name: Publish CHECK constraint introspection
description: Top-level CASE constraints can become invalid nested CHECK expressions in publish SQL.
---

Avoid top-level CASE expressions in PostgreSQL CHECK constraints used by this project's publishing schema diff. Keep conditional logic inside a function argument instead, preserving safe handling of non-array JSON.

**Why:** The publisher introspected a valid `CHECK (CASE ... END)` as `CHECK (CHECK (CASE ... END))`, blocking publication before a deployment build existed. Ordinary builds, unit tests, and startup against an already-migrated development database did not catch it.

**How to apply:** Inspect `explainSchemaDiff()` before release when adding constraints. Validate its exact generated SQL in an isolated development schema within a rolled-back transaction. Fix both schema source and development constraint; let Publish update production. Editing an already-applied SQL file does not update the development constraint automatically.
---
name: Replit publish vs app runtime SQL migrations
description: Why a Replit publish can validate green yet crash prod on boot in apps with their own runtime SQL migration runner
---

This app applies `migrations/*.sql` on every server startup via `server/lib/migrate.ts`, called from `server/index.ts` before the server listens. A failing migration throws into an async IIFE with no try/catch → unhandled rejection → process exits → the deploy never becomes healthy.

**Replit Publish's "Database migrations validated successfully" only validates Replit's own Drizzle schema diff (dev-vs-prod introspection). It does NOT run the app's runtime SQL migrations.** So publish can show green + "Approve and publish", deploy the schema, then the app crashes on boot when a runtime migration fails against real prod data.

**Why:** CHECK constraints (and other raw-SQL-only DDL) can't be expressed in Drizzle's DSL, so they live in raw SQL migrations and never appear in Replit's diff. A data-dependent migration (e.g. "add CHECK constraint" right after a "normalize values" UPDATE) passes Replit validation but fails at runtime if the cleanup didn't cover every prod row.

**How to apply:**
- Separate the two migration systems: Replit's schema push (what the publish UI validates) vs the app's runtime runner (what actually runs on prod boot). Verify runtime migrations against *production* data with a read-only simulation — don't trust the green publish check.
- Dev DB *data* cleanups do NOT reach prod via a normal publish (publish pushes schema, not data). Prod rows keep their original values unless a runtime migration or a wholesale dev→prod data copy changes them.
- This runner orders migrations by lexicographic filename sort. To slot a cleanup before an already-numbered constraint migration, name it to sort between them (e.g. `0001a_` sorts between `0001_` and `0002_`). Don't edit already-applied migrations (other envs won't re-run them); add a new file.

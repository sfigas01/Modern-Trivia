---
name: Eager service-client init crashes deploy boot
description: Why constructing OpenAI/SDK clients at module load breaks Replit Publish even when the build passes
---

# Eager service-client construction crashes deployment startup

Constructing a service SDK client at **module top-level** (import time) will crash the
whole server at boot if the client's required secret is absent in that environment.
The OpenAI Node SDK in particular **throws inside its constructor when `apiKey` is
empty**, so `const x = new OpenAI({ apiKey: process.env.SOME_KEY })` at module scope
becomes an import-time throw.

**Why this bites on Replit Publish specifically:**
- Replit Publish shows "Your app **built successfully** but failed to start" and fails
  at the **Promote** stage. The `fetch_deployment_logs` tool returns nothing for a
  failed promote (no promoted deployment → no prod log stream); the real trace is only
  behind the publish UI's "View logs" button.
- AI-integration env vars (e.g. `AI_INTEGRATIONS_OPENAI_API_KEY`) are present in the
  **workspace/dev** runtime but are not guaranteed in the **deployment** runtime, so the
  app boots in dev and crashes only when published.

**How to diagnose the "before migrations" signal:** this app runs `runMigrations()` in
`server/index.ts`'s async IIFE, whose first DDL is `CREATE TABLE IF NOT EXISTS
_sql_migrations`. If prod has **no `_sql_migrations` table** (and data is unmigrated)
while `DATABASE_URL` is set, the crash happened *before* the IIFE ran — i.e. a
**module-load-time throw** during imports, not a migration error. Enumerate top-level
`new <SDK>(...)` constructions; those are the suspects.

**Fix / rule:** never construct optional service clients at import. Use a lazy cached
singleton (`let _c; function getClient(){ if(!_c) _c = new SDK(...); return _c; }`) so a
missing key degrades only the routes that use it (they fail gracefully at request time)
instead of killing boot. A synchronous constructor makes the module-scoped singleton
race-free in Node.

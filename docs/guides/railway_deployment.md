# Railway deployment

How Modern Trivia runs on Railway: where things live, the service settings, the variables, and the routine runbooks. The move from Replit is tracked in `docs/guides/railway_migration_plan.md` (STE-219).

## Where things live

| Thing             | Value                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Railway workspace | Stephanie's Projects (Hobby plan). PassTrack lives in the same workspace; don't touch it from this repo.         |
| Railway project   | **Modern Trivia** (`bbd23fa5-8c19-457d-94e1-b92dca980fc7`)                                                       |
| App service       | `modern-trivia` (`cce27dad-45e4-4776-a981-89af9196a5fc`), GitHub `sfigas01/Modern-Trivia`                        |
| Database service  | `Postgres` (Railway template, PostgreSQL **18**, volume `postgres-volume`)                                       |
| `production`      | Deploys `main`. **https://superquestly.up.railway.app**                                                          |
| `preview`         | Deploys a chosen branch against its **own, separate** Postgres. **https://modern-trivia-preview.up.railway.app** |
| Google OAuth      | Google Cloud project "Modern Trivia", consent screen "Superquestly" (External, In production), web client        |
| OpenAI            | Direct, project-scoped key with a hard monthly limit and a billing alert                                         |

The two environments are isolated: the `${{Postgres.DATABASE_URL}}` reference resolves to each environment's own database.

## Service settings

Railway's `railway.json` (Config as Code) is deprecated and new services cannot use it, so these settings are set on the service in the Railway dashboard (or via the Railway MCP `update-service`). This table is the reference; keep it in sync with Railway.

| Setting             | Value                  | Why                                                                                                         |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Builder             | Railpack               | Detects Node from `package.json` `engines` (`22.x`) / `.nvmrc`.                                             |
| Build command       | `npm run build`        | Vite client → `dist/public`, esbuild server → `dist/index.cjs`.                                             |
| Pre-deploy command  | `npm run db:bootstrap` | Creates the base schema **only on a database with no application tables** (see below). No-op on production. |
| Start command       | `npm run start`        | Runs `runMigrations()` (SQL files in `migrations/`, advisory-locked), seeds, then listens on `PORT`.        |
| Healthcheck path    | `/health`              | 200 only after boot finished and the database answers `SELECT 1`; 503 otherwise.                            |
| Healthcheck timeout | 300 s                  | Migrations run before the server listens.                                                                   |
| Restart policy      | On failure, 10 retries |                                                                                                             |
| Public domain port  | 5000                   | Must match `PORT`.                                                                                          |

Recommended in the dashboard for `production`: **Settings → Source → Wait for CI**, so a red `main` never deploys.

## Variables

Set on the `modern-trivia` service in **each** environment. Names only here; values live in Railway. Never paste values into chat, PRs, issues or logs.

| Variable                         | Secret | Value / source                                                       |
| -------------------------------- | ------ | -------------------------------------------------------------------- |
| `DATABASE_URL`                   | —      | Reference: `${{Postgres.DATABASE_URL}}`                              |
| `PORT`                           | —      | `5000`                                                               |
| `NODE_ENV`                       | —      | `production`                                                         |
| `PUBLIC_URL`                     | —      | The environment's domain, e.g. `https://superquestly.up.railway.app` |
| `SESSION_SECRET`                 | yes    | `openssl rand -hex 32`; different per environment                    |
| `GOOGLE_CLIENT_ID`               | yes    | Google OAuth web client                                              |
| `GOOGLE_CLIENT_SECRET`           | yes    | Google OAuth web client                                              |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | yes    | Direct OpenAI project key                                            |
| `ADMIN_API_KEY`                  | yes    | Optional; scripted admin access (`openssl rand -hex 32`)             |
| `ADMIN_API_KEY_USER_ID`          | —      | Optional; the admin's `users.id`                                     |
| `VITE_MULTIPLAYER`               | —      | `true` (build-time flag)                                             |
| `VITE_THEME_ROUNDS`              | —      | Unset (off), as on Replit (build-time flag)                          |
| `THEME_LIVE_GENERATION`          | —      | Unset (off), as on Replit                                            |

`AI_INTEGRATIONS_OPENAI_BASE_URL` stays **unset** so the OpenAI SDK uses its default endpoint. Replit secrets deliberately not carried over: `AI_INTEGRATIONS_OPENAI_BASE_URL` (Replit's OpenAI proxy), `OPENAI_EMBEDDINGS_API_KEY` (no longer read by the code; the direct key covers embeddings) and `GITHUB_PAT` (Replit's Git sync only; revoke it when Replit is decommissioned). Preview and production use separate OpenAI keys in the same budget-capped project. `VITE_*` variables are read when the client is built, so change them and redeploy.

## Sign-in

- `/api/login` sends the player to Google; Google redirects to `PUBLIC_URL/api/callback`. Every environment's callback URL must be listed under **Authorized redirect URIs** on the Google client (plus `http://localhost:5000/api/callback` for local development).
- Any Google account with a verified email can sign in. On first sign-in the user is matched to an existing `users` row by **case-insensitive email**, keeping its `users.id` — so `seen_questions`, `admin_roles` and other user-linked rows stay attached. Unknown emails get a new player account.
- Admin rights come only from `admin_roles`. A new Google account is never an admin.
- A player whose Google email differs from the email on their old Replit account gets a new, empty account.
- If Google credentials or `PUBLIC_URL` are missing, `/api/login` returns 503 and the rest of the app keeps working.

## Database schema on a fresh database

The SQL migrations cannot build a database from nothing: `0000` is an old drizzle snapshot that `runMigrations()` treats as already applied, and later tables only ever came from `drizzle-kit push` (which Replit ran on every publish). So:

- `npm run db:bootstrap` runs `drizzle-kit push` **only when the database has no application tables**, then `runMigrations()` applies `0001`…latest at boot. This is the same order CI's E2E job uses.
- A `_sql_migrations` table holding only the `0000` marker (left by a boot that failed before the schema existed) is dropped first, because drizzle-kit would otherwise stop to ask about it. If `_sql_migrations` records anything else but no application tables exist, the bootstrap refuses and the deploy fails.
- `drizzle-kit push` prints a foreign-key error on an empty database and can exit 0 even on failure, so the bootstrap checks that `users`, `sessions`, `questions` and `admin_roles` exist afterwards and fails the deploy otherwise. The SQL migrations then complete the schema.
- On any database that already has tables, the bootstrap does nothing.
- **Every schema change must ship as a SQL migration** in `migrations/`. Nothing pushes the drizzle schema to an existing database on deploy.

## Runbooks

**Deploy:** merge to `main`. Railway builds, runs the pre-deploy step, starts the new container and switches traffic only when `/health` returns 200.

**Roll back:** Railway → `modern-trivia` → Deployments → pick the last good deployment → **Redeploy**. Migrations are forward-only; a rollback past a migration needs a manual check that the old code tolerates the new schema.

**Test a branch:** set the `preview` environment's source branch (Settings → Source) and deploy. Preview has its own database; never point it at production data.

**Content sweep scripts:** set `PROD_URL=https://superquestly.up.railway.app` in the local, gitignored `.env.local` (see `docs/guides/content-sweep-plan.md`).

**Direct database access:** Railway → Postgres → Settings → Networking → **Add Public Access** creates `DATABASE_PUBLIC_URL`. Remove public access as soon as you're done. Keep connection strings out of the repo, chat and shell history.

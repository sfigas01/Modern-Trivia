# Railway migration plan (Replit → Railway)

**Status:** in progress (phase 0 and phase 1 started 2026-09-29; see the execution notes below). **Owner:** Stephanie. **Linear:** STE-219 (epic) and its children STE-220–STE-227. Written 2026-09-29 against `main` at `1912478`.

This guide is the execution plan for moving Modern Trivia off Replit onto Railway. It says **when** to do it relative to the on-demand theme work (STE-167 / STE-25), what the current code depends on, which decisions need the owner, and how to run the move safely. The same move was done for Pass-Track on 2026-09-27; its lessons are recorded in Linear STE-278 and repeated in section 7.

## Execution notes (2026-09-29)

Decisions and findings from the migration session. They take precedence over the original plan text below where the two differ.

- **Owner decisions (section 4):** Google sign-in for everyone; production URL `https://superquestly.up.railway.app` (`trivia.up.railway.app` was taken); a direct OpenAI key with a hard limit and alert; Railway Hobby plan. GitHub auto-merge is turned off for the freeze window.
- **Railway layout:** project **Modern Trivia** with `production` (deploys `main`) and `preview` (deploys the migration branch, own empty Postgres, `https://modern-trivia-preview.up.railway.app`). Both run PostgreSQL **18**, so the `NN` guard in section 6 is `18` (re-verify on cutover day).
- **`railway.json` is not used:** Railway deprecated Config as Code, and new services cannot opt in. Build, pre-deploy, start, healthcheck and restart settings are set on the service and recorded in `docs/guides/railway_deployment.md`.
- **Fresh databases need a bootstrap:** the SQL migrations can't build a database from nothing (`0000` is a stale drizzle snapshot; later tables came from `drizzle-kit push`, which Replit ran on publish). The pre-deploy step `npm run db:bootstrap` pushes the drizzle schema only when the database has no tables. Production is unaffected because its schema comes from the data copy.
- **Schema changes now require SQL migrations**, because nothing pushes the drizzle schema on deploy any more (recorded in `AGENTS.md` / `CLAUDE.md`).
- **`replit.md` retired:** the sync contract now covers `AGENTS.md` and `CLAUDE.md`, and CI checks those two.
- **Node 22** (STE-287) is folded into the migration PR.

## 1. When to migrate (the checkpoint)

**Expected trigger: right after STE-25 slice S7 (question-candidate generation, branch `codex/ste-25-question-candidates`) merges, before the next slice is approved.**

There is no fixed number of slices. They are approved one at a time, so the window is defined by a rule:

> Migrate **before** starting any STE-25 or STE-167 slice whose scope includes **routes, background jobs or workers, live provider wiring, gameplay activation, or paid live evaluation.**

Why this is the line:

- Everything merged for the feature through S7 (STE-167 foundation and B1 lifecycle repository; STE-25 S1–S7) is library code and migrations that no route or running flow calls yet. Moving hosts does not change its behavior, and its tables come along in the data copy.
- **Background jobs** should be built and tested on Railway's always-on service. The Replit deployment is `autoscale` (see `.replit`), which can scale to zero and cut off background work.
- **Routes:** the migration's auth swap edits `server/routes.ts`, which STE-167 lane B owns for route integration.
- **Live provider wiring and paid evaluation** measure latency and cost; measure them once, on the final host.

### Instruction for agents working on STE-25 or STE-167

When S7 has merged, or when you are about to propose, plan or start the next slice, check that slice's scope against the rule above. **If it matches, stop and tell Stephanie that the Railway migration checkpoint has been reached and link this guide.** Do not start the migration yourself unless she asks; she will run it in a separate session. Library-only slices may continue during the soft freeze below.

### Freeze rules

- **Soft freeze** while the migration PR is open (about 1–2 days): feature work may continue, but must not change `package.json` / `package-lock.json`, `server/routes.ts`, `server/routes.rooms.ts`, `vite.config.ts`, `.replit`, or `AGENTS.md` / `CLAUDE.md` / `replit.md`.
- **Hard freeze** on cutover day only: no merges to `main` while production data is copied and traffic moves.

### Pre-flight check (start of the migration session)

- [ ] S7 is merged; the next slice's scope has been checked against the rule.
- [ ] No STE-25 / STE-167 PR is mid-merge. Record the status of PR #180 (source-reviewed themed inventory), which was still open when this guide was written.
- [ ] `main` is green in CI.
- [ ] The decisions in section 4 are answered.

## 2. What depends on Replit today

| Dependency                 | Where                                                                                                                                                                      | Action                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login (Replit OIDC)        | `server/replit_integrations/auth/*`, imported by `server/routes.ts`; `users` in `shared/models/auth.ts`                                                                    | Replace with portable Google sign-in (section 5).                                                                                                                                                 |
| Unused Replit integrations | `server/replit_integrations/{audio,chat,image,batch}`                                                                                                                      | Not imported outside their own folder at the time of writing. Confirm, then delete.                                                                                                               |
| OpenAI via Replit proxy    | `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL`, read in `server/lib/*.ts` (including `guardian.ts`, `verifier.ts`, `theme-game.ts`, `embeddings.ts`) | Probably **environment-only**: set the key to a direct OpenAI key and leave the base URL unset so the SDK uses its default. Verify that, and do not edit feature-owned files to rename variables. |
| Replit Vite plugin         | `vite.config.ts` (`REPL_ID`, cartographer, runtime error modal)                                                                                                            | Remove.                                                                                                                                                                                           |
| Replit domains             | `vite-plugin-meta-images.ts` (`REPLIT_INTERNAL_APP_DOMAIN`, `REPLIT_DEV_DOMAIN`)                                                                                           | Replace with a generic `PUBLIC_URL`.                                                                                                                                                              |
| Replit config and docs     | `.replit`, `replit.md` (sync contract with `AGENTS.md` / `CLAUDE.md`)                                                                                                      | Delete `.replit`; retire or rewrite `replit.md` and update the sync contract in all three files.                                                                                                  |
| Admin scripts              | `scripts/content-sweep*.ts` read `PROD_URL` from `.env.local`                                                                                                              | Update `PROD_URL` after cutover.                                                                                                                                                                  |

Already portable, no change needed: the `pg` driver (`server/db.ts`); SQL migrations in `migrations/`, applied at boot by `runMigrations()` under an advisory lock (`server/lib/migrate.ts`); Vite loaded only in development (`server/index.ts`); embeddings stored as `jsonb`, so no pgvector extension is required; CI, Dependabot, tests.

Missing for Railway: a `/health` endpoint, `railway.json` (build/start commands, healthcheck), and a Node `engines` field.

## 3. Identity: players sign in, not only the admin

Earlier plans (STE-220) assumed an admin-only login for about one user. The code shows **players can sign in too**. `client/src/pages/Home.tsx` links to `/api/login`, and signed-in players get server-side `seen_questions` history keyed by user id. Admin rights live in `admin_roles`, also keyed by user id. STE-167's strict repeat-protection rules depend on this history.

Consequences:

- The new login must accept **any Google account**. It is not an email allowlist.
- Admin access stays controlled by `admin_roles`.
- Replit user ids (the OIDC `sub`) differ from Google ids. On first Google login, **match the user by email and keep the existing `users.id`**, so `seen_questions`, `admin_roles` and every other table referencing `users.id` stay attached. Pass-Track's `upsertUserByEmail` in `sfigas01/Pass-Track-AltRpt` (`server/storage.ts`) is the reference implementation.
- Keep the `req.user.claims.sub` contract that `getUserId()` in `server/routes.ts` and `server/middleware/rateLimiter.ts` rely on.
- Players whose Google email differs from their Replit email start with fresh history. Mention this in release notes.

## 4. Decisions for the owner (answer before phase 1)

1. **Google sign-in for everyone (players and admin)?** Recommended, with email matching as above.
2. **Production URL.** The app is currently served from a Replit domain. Choose a `*.up.railway.app` name or a custom domain. Anyone with the old link will need the new one unless a custom domain is moved.
3. **OpenAI:** a direct, project-scoped key with a monthly hard limit and an alert (STE-221).
4. **Railway plan:** a paid plan, not the trial, before cutover.

## 5. Execution phases

### Phase 0: prep (no code, no freeze)

- Create a Railway project with the app service connected to `main` and a Railway Postgres.
- Create a Google OAuth client and **publish** the consent screen, because players need to sign in (Testing mode only admits listed test users).
- Create the direct OpenAI key with limits.
- Set Railway variables: `DATABASE_URL` (reference to the Postgres service), `SESSION_SECRET` (new value), Google client id and secret, `PUBLIC_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `NODE_ENV=production`, and any other variables the app reads (`server/lib/env.ts`, `.env.example`).

### Phase 1: migration PR (soft freeze)

One branch from fresh `main`, for example `chore/STE-219-railway-migration`:

- Google sign-in replacing `server/replit_integrations/auth/*`, open to all Google accounts. Keep `/api/login`, `/api/callback`, `/api/logout` and `/api/auth/user`. Match users by email; admin via `admin_roles`. Replace `replitAuth.test.ts` with tests for the new login, email matching and admin checks.
- Remove the Replit plugins, environment variables and config (section 2).
- Add `/health` (checks the database), `railway.json` and Node `engines`, and update `.env.example`.
- CI green. Deploy to a Railway preview with an empty database and smoke test: health, player login, admin login, one full game, question generation with the direct key.

### Phase 2: cutover day (hard freeze)

- Stop writes on Replit (announce a short maintenance window).
- Copy production data using the guarded procedure in section 6.
- Merge the PR if not already merged. Let Railway deploy; `runMigrations()` applies anything pending.
- Switch the URL or domain (STE-226) and update the OAuth redirect URIs.
- Verify (section 8).

### Phase 3: afterwards

- Lift the freeze; feature branches merge `main`. STE-167 / STE-25 continue on Railway, including background jobs and paid evaluation.
- Watch logs for 24–48 hours. Decommission Replit after a stable week: delete the deployment and its databases, cancel billing, rotate every secret that lived in Replit (STE-225).
- Continue the knowledge transfer (STE-227).

## 6. Guarded data copy

Run from the Replit Shell, which already has `pg_dump` / `psql`.

- **Source:** the **Production** database connection string (Replit Database tool → Production Database → Settings). The Shell's own `DATABASE_URL` is the **development** database.
- **Target:** Railway Postgres → Settings → Networking → **Add Public Access**, which creates `DATABASE_PUBLIC_URL`. Remove public access after the copy.

Save each connection string to a temporary file as soon as it is pasted. The Shell can forget variables, and an **empty** connection string silently falls back to the development database, because Replit sets `PG*` variables.

```bash
read -rs V && printf %s "$V" > /tmp/.prod_url && echo "saved $(wc -c < /tmp/.prod_url)"
read -rs V && printf %s "$V" > /tmp/.railway_url && echo "saved $(wc -c < /tmp/.railway_url)"
```

Check both before any write. The expected Railway major version may differ; confirm it first:

```bash
P=$(cat /tmp/.prod_url); R=$(cat /tmp/.railway_url)
psql "$P" -Atc "select 'PROD ' || current_setting('server_version') || ' questions=' || (select count(*) from questions)"
psql "$R" -Atc "select 'RAILWAY ' || current_setting('server_version')"
pg_dump --version
```

`pg_dump` must be the same major version as the production server or newer.

Wipe, copy and compare. The wipe only runs if the target reports the expected Railway major version (replace `NN`):

```bash
P=$(cat /tmp/.prod_url); R=$(cat /tmp/.railway_url)
[ -n "$P" ] && [ "$(psql "$R" -Atc 'show server_version_num' | cut -c1-2)" = "NN" ] \
  && psql "$R" -qc 'drop schema public cascade; create schema public;' \
  && pg_dump "$P" -Fc --no-owner --no-acl --exclude-table-data=sessions -f /tmp/mt.dump \
  && pg_restore --no-owner --no-acl -d "$R" /tmp/mt.dump; echo "code $?"
```

Compare row counts for **every** table on both sides, not only a sample:

```bash
for db in "$P" "$R"; do psql "$db" -Atc "select string_agg(relname || '=' || n_live_tup, ' ' order by relname) from pg_stat_user_tables"; done
```

`n_live_tup` is an estimate. Run `ANALYZE` first on both sides, or use exact `count(*)` for important tables.

Clean up with `rm -f /tmp/.prod_url /tmp/.railway_url /tmp/mt.dump`. Keep one final dump somewhere safe (not in the repo) until Replit is decommissioned.

## 7. Lessons from the Pass-Track migration (STE-278)

1. Changing the login provider changes user ids; match by email to keep data attached.
2. Replit keeps separate development and production databases.
3. An empty connection-string variable silently targets the development database; the first Pass-Track copy took test data this way.
4. Railway Postgres needs **Add Public Access** for an external copy. Remove it afterwards.
5. Google OAuth in Testing mode only admits listed test users.
6. Railway's default network policy in cloud agent sessions may block `railway.com` and `accounts.google.com`. Dashboard steps are done by the owner, not the agent.

## 8. Verification checklist

- [ ] CI green on the migration PR; `npm run build` succeeds with no Replit variables set.
- [ ] Repo-wide search for `replit` finds only intentional historical references.
- [ ] `/health` is OK on Railway; the service auto-deploys from `main`.
- [ ] Row counts match for every table after the copy.
- [ ] A migrated **admin** keeps admin access; a migrated **player** keeps their seen-question history.
- [ ] A new Google account can sign in as a player and is not an admin.
- [ ] A full game works in quick play and multiplayer; question generation and Guardian review work with the direct OpenAI key.
- [ ] Content-sweep scripts work against the new `PROD_URL`.
- [ ] Railway Postgres public access removed; backups enabled.

## 9. Kickoff prompt for the migration session

Paste this into a new agent session when the checkpoint is reached:

> We are migrating Modern Trivia (`sfigas01/Modern-Trivia`) from Replit to Railway. Follow `docs/guides/railway_migration_plan.md` exactly, starting with the pre-flight check in section 1 and the owner decisions in section 4. Ask me the section 4 questions one at a time before writing code. Then do phase 1 (the migration PR) and walk me through the Railway, Google and OpenAI dashboard steps; I will do those myself. Do not copy production data or change `main` until I confirm cutover day. Linear: STE-219 and its children.

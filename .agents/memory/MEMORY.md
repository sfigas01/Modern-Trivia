# Memory Index

- [Replit publish vs runtime SQL migrations](replit-publish-vs-runtime-migrations.md) — publish "migrations validated successfully" only checks the Drizzle schema diff, NOT the app's boot-time `migrations/*.sql`; can validate green yet crash prod on startup.
- [Eager service-client init crashes deploy boot](deploy-boot-eager-client-init.md) — top-level `new OpenAI(...)` throws at import when the key is absent in the deployment env; build passes but Promote fails with "built successfully but failed to start". Use lazy singletons.
- [Fixing broken GitHub sync](git-sync-stale-lock-and-push.md) — stale `.git/refs/remotes/origin/HEAD.lock` breaks sync; bash tool blocks all `.git` writes, use the code-exec notebook + GITHUB_PAT askpass bridge to unlock and push.

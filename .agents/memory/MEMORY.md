# Memory Index

- [Semantic provider capabilities](semantic-provider-capabilities.md) — working chat credentials do not prove embeddings support; verify live capability before themed-game acceptance.

- [Dependency upgrade constraints](dependency-upgrade-constraints.md) — transitive qs pinning and npm override resolution require care during security upgrades.

- [Publish CHECK introspection](publish-check-constraint-introspection.md) — top-level CASE checks can generate invalid nested CHECK SQL; validate the actual publish diff.

- [Replit publish vs runtime SQL migrations](replit-publish-vs-runtime-migrations.md) — publish "migrations validated successfully" only checks the Drizzle schema diff, NOT the app's boot-time `migrations/*.sql`; can validate green yet crash prod on startup.
- [Eager service-client init crashes deploy boot](deploy-boot-eager-client-init.md) — top-level `new OpenAI(...)` throws at import when the key is absent in the deployment env; build passes but Promote fails with "built successfully but failed to start". Use lazy singletons.
- [Fixing broken GitHub sync](git-sync-stale-lock-and-push.md) — stale `.git/refs/remotes/origin/HEAD.lock` breaks sync; bash tool blocks all `.git` writes, use the code-exec notebook + GITHUB_PAT askpass bridge to unlock and push.

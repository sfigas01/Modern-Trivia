# Memory Index

- [Replit publish vs runtime SQL migrations](replit-publish-vs-runtime-migrations.md) — publish "migrations validated successfully" only checks the Drizzle schema diff, NOT the app's boot-time `migrations/*.sql`; can validate green yet crash prod on startup.

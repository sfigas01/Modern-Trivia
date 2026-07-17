# Category Migration Guide

## Context

Modern Trivia uses 6 canonical category names enforced via `shared/constants/categories.ts`:

- `History & Geography`
- `Science & Nature`
- `Sports`
- `Entertainment & Pop Culture`
- `Food & Culture`
- `Technology`

PR #112 (STE-141/142) introduced these canonical values and updated seed data. However, rows already in the production database retain whatever legacy string was stored at insert time (e.g., `geography`, `movies`, `pop culture`). Migration `0001_migrate_legacy_categories.sql` remaps those rows.

## Running the migration

Drizzle migrations are applied in filename order. Run:

```bash
npx drizzle-kit migrate
```

Or apply the SQL directly against the database:

```bash
psql "$DATABASE_URL" -f migrations/0001_migrate_legacy_categories.sql
```

The migration is **idempotent** — rows whose `category` is already a canonical value are excluded by the `WHERE category NOT IN (...)` clause, so re-running has no effect.

## Verification

After applying the migration, confirm 0 non-canonical rows remain:

```sql
SELECT category, COUNT(*)
FROM questions
WHERE category NOT IN (
  'History & Geography',
  'Science & Nature',
  'Sports',
  'Entertainment & Pop Culture',
  'Food & Culture',
  'Technology'
)
GROUP BY category;
```

An empty result set means the migration succeeded.

## Revert / rollback

There is no automated rollback. Legacy string values are not recoverable from the database after the UPDATE. If a rollback is needed:

1. Restore from a pre-migration database snapshot.
2. Or re-insert questions from the authoritative JSON files (`server/seed-data.json`, `client/src/lib/questions.json`) which already use canonical values — in that case a rollback is unnecessary.

## Adding a new legacy mapping

If a future import introduces a new legacy category string, update **both**:

1. `shared/constants/categories.ts` — add the entry to `LEGACY_CATEGORY_MAP`
2. `migrations/` — add a new numbered migration with the additional `WHEN` branch

Do **not** edit `0001_migrate_legacy_categories.sql` after it has been applied to production; write a new migration instead.

**Ordering caveat:** any cleanup migration must run **before** `0002_category_check_constraint.sql`, otherwise the CHECK constraint fails on the un-normalized rows and the app crashes on startup (`runMigrations()` runs on boot). The runner (`server/lib/migrate.ts`) applies files in lexicographic order, so a cleanup added after 0002 already exists must be named to sort before it — e.g. `0001a_migrate_remaining_legacy_categories.sql` slots between `0001_` and `0002_` (`"0001_" < "0001a_" < "0002_"`).

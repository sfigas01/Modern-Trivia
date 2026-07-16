# E2E Testing Guide

## Overview

End-to-end tests live in `e2e/` and use [Playwright](https://playwright.dev). They run against the production build on `http://localhost:5000`, covering the full SETUP → QUESTION → REVEAL → score-update loop and any other user-facing flows.

## Running locally

```bash
# One-time browser install (only needed after first clone or Playwright version bump)
npx playwright install --with-deps chromium

# Run all E2E tests (starts the server automatically)
npm run test:e2e

# Run with the interactive UI
npx playwright test --ui

# Run a specific spec
npx playwright test e2e/smoke.spec.ts

# Run multiplayer dispute-vote acceptance coverage
npx playwright test e2e/multiplayer-disputes.spec.ts

# Repeat the dispute-vote spec to check polling and reconnect stability
npx playwright test e2e/multiplayer-disputes.spec.ts --repeat-each=3

# Run both multiplayer suites
npx playwright test e2e/multiplayer.spec.ts e2e/multiplayer-disputes.spec.ts

# Debug a failing test (headed, with breakpoints)
npx playwright test --debug
```

The `playwright.config.ts` `webServer` block automatically runs `npm run build && npm run start` before the suite, so the app is always tested against a real production build.

### Environment variables

The server and multiplayer dispute fixture setup require `DATABASE_URL` at startup. Export it before running and apply all migrations, including the dispute-vote tables:

```bash
export DATABASE_URL=postgresql://user:password@localhost:5432/your_db
npm run db:migrate
npm run test:e2e
```

If the variable is absent the server may fail to start; tests will error at the connection step.

## CI

The `e2e-smoke` job in `.github/workflows/ci.yml` runs after `quality-gates` passes. It spins up a Postgres service container and sets `DATABASE_URL` automatically. Playwright browsers are cached per `package-lock.json` hash to keep the job fast.

On failure, the HTML report is uploaded as the `playwright-report` artifact (retained 7 days) and is visible in the Actions summary.

## Fixtures

`e2e/fixtures/questions.json` contains 8 deterministic questions (Easy/Medium/Hard, Science/History). All `GET /api/questions*` requests are intercepted and fulfilled with this fixture. `POST /api/questions/seen` is stubbed to return `{}`.

`e2e/fixtures/dispute-question.json` provides the Easy question used by `multiplayer-disputes.spec.ts`. That spec upserts the fixture into the configured test database and pins each started room to the fixture before answering. It then reads the persisted dispute and ballot rows to verify the same eligibility, threshold, outcome, and score deltas exposed to the admin QA workflow. Use an isolated, migrated test database; do not point E2E at production.

Multiplayer room endpoints are never browser-stubbed. Room creation, joining, polling, voting, reconnect, scoring, and audit persistence exercise the production server and Postgres schema.

## Adding new tests

1. Create a new `e2e/*.spec.ts` file.
2. Intercept `**/api/questions**` with fixture data (or a custom fixture for the feature under test).
3. For multiplayer scoring tests, seed or pin the server-side room question IDs as `multiplayer-disputes.spec.ts` does; browser interception alone does not control the room engine.
4. Follow the isolated-browser-context and polling-aware patterns in `e2e/multiplayer.spec.ts` and `e2e/multiplayer-disputes.spec.ts`.
5. Prefer Playwright auto-waiting and `expect.poll` over fixed sleeps.
6. Add `data-testid` attributes to new UI elements so tests can target them without brittle CSS selectors.

All user-facing flow changes should add or update an E2E test in `e2e/`.

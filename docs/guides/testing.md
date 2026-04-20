# Testing Guide

Modern Trivia uses Vitest for unit and integration tests. Test files should use
`*.test.ts` or `*.test.tsx` and run through `npm test`.

## API Route Integration Tests

Route integration tests for `server/routes.ts` should build a fresh Express app,
register the real route handlers, and drive requests with `supertest`.

Use `server/test/testApp.ts`:

```ts
const app = await buildTestApp();
await request(app).get('/api/questions').expect(200);
```

Mock process boundaries, not route behavior:

- Mock `server/db.ts` with lightweight Drizzle-style chain objects.
- Mock OpenAI-facing helpers such as `analyzeDispute`, `generateQuestions`,
  `getAiFieldFix`, and fact-checking utilities.
- Mock Replit auth so tests can attach a user from `x-test-user-id`.
- Use real Zod schemas from `@shared/schema` whenever possible so validation
  tests exercise the production request contract.
- Keep Postgres, Replit Auth, and OpenAI out of the test path.

Protected-route tests should include unauthenticated `401`, authenticated
non-admin `403`, and admin happy-path coverage where relevant. Public routes
should still test validation failures and database write/read behavior.

## Verification

Before marking test work complete, run:

```bash
npm run check
npm run lint
OPENAI_API_KEY=invalid npm test
npm run build
```

For API route work, also confirm the relevant route test fails if the protected
behavior is deliberately broken.

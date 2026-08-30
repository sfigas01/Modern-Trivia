# Content Quality Sweep Plan

> **Linear issue:** STE-238
> **Date:** 2026-08-08
> **Purpose:** Run a full programmatic content quality sweep against the production Modern Trivia database, using the existing quality pipeline (static audit, duplicate detection, AI fact-checking) via the admin API endpoints.

---

## Part 1: Auth Middleware Analysis

### How Authentication Works Today

The app uses **Replit Auth (OpenID Connect)** with server-side sessions. The full auth chain is:

1. **Session middleware** (`server/replit_integrations/auth/replitAuth.ts`): Express sessions stored in Postgres (`connect-pg-simple`, table `sessions`). Session cookie is `httpOnly: true, secure: true`, 7-day TTL. Requires `SESSION_SECRET` env var.

2. **Passport OIDC** (`replitAuth.ts`): Users authenticate via Replit's OIDC provider (`https://replit.com/oidc`). On login, the OIDC flow issues tokens; the user's `claims.sub` (Replit user ID) becomes their identity.

3. **`isAuthenticated` middleware** (`replitAuth.ts:162`): Checks `req.isAuthenticated()` and token expiry. If the access token is expired, attempts a refresh via the stored `refresh_token`. Returns 401 if neither works.

4. **`isAdmin` middleware** (`routes.ts:146`): After authentication, extracts `req.user.claims.sub` and looks up that user ID in the `admin_roles` Postgres table. Returns 403 if the user is not in that table.

### The Problem for Scripted Access

Every admin endpoint (`POST /api/admin/quality-sweep`, `PATCH /api/admin/questions/:id/field`, `POST /api/admin/questions/:id/ai-fix`, etc.) goes through `isAuthenticated, isAdmin`. The auth flow requires:

- A valid Passport session cookie (set during an interactive browser-based OIDC login)
- That session must contain a non-expired OIDC token with a `claims.sub`
- That `sub` must exist in the `admin_roles` table

There is **no existing API key mechanism, service account, or bearer token auth**. A script cannot authenticate without going through the browser-based OIDC flow.

### Recommended Solution: Admin API Key Bypass

Add a simple, env-var-based API key that scripts can pass via an `Authorization: Bearer <key>` header. This is the simplest, safest approach because:

- It reuses the existing admin check (the key holder IS the admin)
- It requires zero changes to the OIDC flow or session infrastructure
- The key lives in Replit Secrets, never in code
- It can be rotated or revoked by changing one env var
- It only bypasses the session check, not the admin role check -- we hardcode the sweep script's identity to Stephanie's user ID

### Exact Code Changes Required

#### 1. Add `ADMIN_API_KEY` to `.env.example`

**File:** `/Users/stephaniefigas/Developer/Apps/Modern-Trivia/.env.example`

Add at the end:

```
# Optional: API key for scripted admin access (e.g. quality sweeps).
# Generate with: openssl rand -hex 32
ADMIN_API_KEY=
```

#### 2. Modify `isAuthenticated` to accept bearer tokens

**File:** `/Users/stephaniefigas/Developer/Apps/Modern-Trivia/server/replit_integrations/auth/replitAuth.ts`

Add a bearer token check at the top of the `isAuthenticated` handler (before the Passport session check). When a valid `ADMIN_API_KEY` is provided, attach a synthetic user object with a configurable admin user ID:

```typescript
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // --- API key auth for scripted access ---
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (adminApiKey) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === adminApiKey) {
      // Attach a synthetic user so downstream middleware (isAdmin) works.
      // ADMIN_API_KEY_USER_ID should be the Replit user ID of the admin
      // who owns the key (defaults to a well-known service identity).
      const userId = process.env.ADMIN_API_KEY_USER_ID || 'service-account';
      (req as any).user = {
        claims: { sub: userId },
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      return next();
    }
  }
  // --- End API key auth ---

  const user = req.user as any;
  // ... rest of existing code unchanged ...
};
```

#### 3. Add `ADMIN_API_KEY_USER_ID` to `.env.example`

**File:** `/Users/stephaniefigas/Developer/Apps/Modern-Trivia/.env.example`

```
# The Replit user ID that API key requests act as.
# Must exist in the admin_roles table. Set to your own Replit user ID.
ADMIN_API_KEY_USER_ID=
```

#### 4. Set the secrets in Replit

In the Replit Secrets panel, set:

- `ADMIN_API_KEY` = a random 64-char hex string (`openssl rand -hex 32`)
- `ADMIN_API_KEY_USER_ID` = Stephanie's Replit user ID (the `sub` claim from her OIDC token -- visible in the `admin_roles` table or by hitting `/api/auth/user` while logged in)

#### 5. No changes needed to `isAdmin`

The `isAdmin` middleware in `routes.ts:146` already does a database lookup on `req.user.claims.sub`. As long as `ADMIN_API_KEY_USER_ID` matches a row in `admin_roles`, the check passes naturally.

### Security Considerations

- The API key is equivalent to admin access. It must be stored as a Replit Secret, never committed.
- Rate limiting (`aiLimiter`) still applies -- the key generator uses `req.user.claims.sub` when available, so API key requests get their own rate limit bucket.
- The key only works when `ADMIN_API_KEY` is set. In development without it, behavior is unchanged.
- Consider adding request logging for API key auth so usage is auditable.

---

## Part 2: Sweep Scope

### Existing Quality Checks (12 Static Heuristics)

The static audit in `server/lib/question-quality-audit.ts` runs these checks instantly (no AI cost):

| #   | Rule                                    | Severity        | What It Catches                                                      |
| --- | --------------------------------------- | --------------- | -------------------------------------------------------------------- |
| 1   | `missing_required_field`                | high            | Missing id, category, difficulty, question, answer, or explanation   |
| 2   | `duplicate_question_id`                 | high            | Two questions sharing the same UUID                                  |
| 3   | `invalid_difficulty`                    | high            | Difficulty not in {Easy, Medium, Hard}                               |
| 4   | `missing_required_tags`                 | medium/high     | No tags array, or missing region/pillar tag                          |
| 5   | `category_tag_mismatch`                 | medium          | Category name not present in the tags array                          |
| 6   | `answer_leakage`                        | high/medium/low | Answer text (or keywords/stems) appearing in the question            |
| 7   | `subjective_prompt`                     | medium          | Subjective wording (best, greatest, most popular, etc.)              |
| 8   | `ambiguous_prompt_format`               | medium          | References "the following" without options                           |
| 9   | `multi_answer_mismatch`                 | medium          | Question asks for multiple answers but answer is single-valued       |
| 10  | `answer_type_mismatch`                  | medium          | Numeric question with text answer, person question with number, etc. |
| 11  | `potentially_incorrect_or_unverifiable` | medium          | Explanation doesn't reference the answer AND no source metadata      |
| 12  | `missing_source_metadata`               | medium          | Missing sourceUrl and/or sourceName                                  |

**Plus:** The `enrichSubjectiveFindings` module (`server/lib/subjectivity-enricher.ts`) uses GPT-4o to identify the exact subjective phrase and propose a rewrite for each `subjective_prompt` finding.

### AI-Powered Checks

| Check                       | Module                                | Model  | Cost Driver                                                                                                                                                      |
| --------------------------- | ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate detection**     | `server/lib/duplicate-detector.ts`    | GPT-4o | Only for "conceptual" pairs where answer similarity >= 0.7 but question text similarity < 0.8. Exact and near-duplicates are caught by string comparison (free). |
| **Fact-checking**           | `server/lib/verifier.ts`              | GPT-4o | Batches of 50 questions per API call. Reviews factual accuracy, editorial compliance, staleness, and tag correctness.                                            |
| **Subjectivity enrichment** | `server/lib/subjectivity-enricher.ts` | GPT-4o | One call for all subjective findings (typically a handful).                                                                                                      |

### Checks to Add (Gaps in Current Coverage)

The existing pipeline is solid. These gaps are worth considering:

1. **FreshPrints staleness check (date-aware):** The fact-checker prompt includes a freshness cutoff, but there is no static heuristic that flags FreshPrints questions based on `createdAt` date alone. A question created 8 months ago in the FreshPrints pillar is almost certainly stale. This could be a free static check.

2. **GlobalEh US-centricity detection:** The fact-checker covers this editorially, but a static keyword scan (US state names, "Congress", "Senate", "NFL", etc.) could cheaply pre-flag likely violations before the GPT call.

3. **Acceptable answers completeness:** Many questions may have no `acceptableAnswers` array. A static check could flag questions where the answer is a proper noun or has common abbreviations, suggesting the AI fix endpoint to populate alternatives.

4. **Explanation quality:** Currently only checks that the explanation references the answer. Could also flag very short explanations (< 20 chars) as likely insufficient.

5. **Difficulty distribution per pillar:** Not a per-question finding, but a corpus-level stat worth including in the sweep report.

### Triage Workflow

Each finding falls into one of three triage buckets:

#### Auto-Fix (apply without review)

- `missing_source_metadata` -- use the AI fix endpoint (`POST /api/admin/questions/:id/ai-fix` with `field: "sourceUrl"` then `field: "sourceName"`) to generate source URLs and names, then apply via the field patch endpoint
- `category_tag_mismatch` -- add the category to the tags array programmatically
- `missing_required_tags` where the fix is deterministic (e.g., pillar tag can be inferred from the question's `pillar` field)

#### Needs Review (present to Stephanie for decision)

- `answer_leakage` (high severity) -- requires human judgment on whether to rewrite the question
- `subjective_prompt` -- the AI proposes a rewrite, but Stephanie should approve it
- `potentially_incorrect_or_unverifiable` -- needs fact verification
- All `fact_check` verdicts of `fail` or `flag`
- All `duplicate` pairs (which one to keep?)
- `answer_type_mismatch` -- may be a false positive

#### Dismiss (log and skip)

- `answer_leakage` (low severity, morphological stem matches) -- these are overwhelmingly false positives
- Previously dismissed findings (the app already filters these via `question_quality_sweep_dismissals`)

### Orchestration Script

The sweep script should be a standalone Node.js/TypeScript script that runs locally (or on Replit shell) and calls the production API. High-level flow:

```
scripts/content-sweep.ts
========================

1. CONFIGURE
   - Read ADMIN_API_KEY and PROD_URL from env
   - Set up HTTP client with auth header

2. FETCH ALL QUESTIONS
   - GET /api/admin/questions?limit=200&offset=0  (paginate if > 200)
   - Record total count

3. RUN FULL SWEEP
   - POST /api/admin/quality-sweep
     Body: { skipFactCheck: false, skipDuplicates: false }
   - This single call runs all three layers (static + duplicates + fact-check)
   - Takes ~30-90 seconds depending on question count

4. PARSE RESULTS
   - Separate findings into auto-fix / needs-review / dismiss buckets
   - Build a summary report

5. AUTO-FIX PHASE (with confirmation)
   - For each auto-fixable finding:
     a. Call POST /api/admin/questions/:id/ai-fix to get AI suggestion
     b. Call PATCH /api/admin/questions/:id/field to apply the fix
     c. Log the change

6. GENERATE REPORT
   - Write JSON report to outputs/sweep-report-YYYY-MM-DD.json
   - Write human-readable summary to outputs/sweep-summary-YYYY-MM-DD.md
   - Include: counts by severity, findings needing review, auto-fixes applied,
     duplicate pairs, fact-check failures

7. (OPTIONAL) VALIDATE FIXES
   - POST /api/admin/quality-sweep/validate
     Body: { questionIds: [list of fixed question IDs] }
   - Confirm auto-fixes resolved their findings
```

### Volume and Cost Estimates

**Question count:** The `quality_criteria.md` references 200 built-in questions, but the database likely has more by now (questions are generated via the staging pipeline). The admin questions endpoint will tell us the exact count.

**API calls per sweep:**

| Operation                              | API Calls                                    | GPT-4o Tokens (est.)      | Cost (est.)     |
| -------------------------------------- | -------------------------------------------- | ------------------------- | --------------- |
| Static audit                           | 0 (in-process)                               | 0                         | $0.00           |
| Duplicate detection (string phase)     | 0                                            | 0                         | $0.00           |
| Duplicate detection (conceptual pairs) | ~5-20 pairs \* 1 call each                   | ~500 tokens/call          | $0.05-0.20      |
| Subjectivity enrichment                | 1 call                                       | ~2,000 tokens             | $0.02           |
| Fact-checking                          | ceil(N/50) calls (4 calls for 200 questions) | ~4,000 tokens/call        | $0.40-0.80      |
| Auto-fix (source metadata)             | 2 calls/question \* ~50 questions            | ~300 tokens/call          | $0.30-0.60      |
| **Total for 200 questions**            | **~35-75 calls**                             | **~25,000-40,000 tokens** | **~$0.80-1.60** |

**Rate limiting:** The `aiLimiter` allows 20 requests per 15-minute window per user. The auto-fix phase (which makes 2 calls per question) will hit this limit if fixing more than 10 questions at once. The sweep script should:

- Respect 429 responses with exponential backoff
- Pace auto-fix calls at ~1 per second
- Run the full sweep first (single call), then auto-fix in batches

If needed, the rate limit can be temporarily raised in prod for the sweep run, or the script can use a separate `ADMIN_API_KEY_USER_ID` that gets its own rate bucket.

### Output Format

#### JSON Report (`sweep-report-YYYY-MM-DD.json`)

```json
{
  "metadata": {
    "generatedAt": "2026-08-08T...",
    "totalQuestions": 247,
    "sweepDuration": "48s",
    "apiVersion": "v1"
  },
  "summary": {
    "static": { "high": 3, "medium": 28, "low": 12 },
    "duplicates": { "exact": 0, "near_duplicate": 2, "conceptual": 5 },
    "factCheck": { "pass": 230, "flag": 12, "fail": 5 }
  },
  "autoFixesApplied": [
    { "questionId": "...", "field": "sourceUrl", "oldValue": null, "newValue": "https://..." }
  ],
  "needsReview": [
    {
      "questionId": "...",
      "questionText": "...",
      "findings": [
        { "type": "fact_check", "verdict": "fail", "reason": "..." }
      ]
    }
  ],
  "dismissed": [ ... ],
  "fullSweepResponse": { ... }
}
```

#### Human-Readable Summary (`sweep-summary-YYYY-MM-DD.md`)

A Markdown document with:

- Executive summary (total questions, pass rate, critical issues count)
- Table of questions needing review, grouped by issue type
- List of auto-fixes applied
- Duplicate pairs with both question texts for comparison
- Fact-check failures with the checker's reasoning
- Recommendations for follow-up

### How Stephanie Reviews Findings

1. Run the sweep script (one command: `npx tsx scripts/content-sweep.ts`)
2. Open the summary markdown -- scan the "needs review" section
3. For each item:
   - **Fact-check failures:** Verify the claim, fix or reject the question
   - **Duplicates:** Pick the better version, delete the other
   - **Subjective prompts:** Accept or modify the AI-proposed rewrite
   - **Answer leakage:** Rewrite the question to remove the leak
4. Use the admin UI quality sweep panel to dismiss findings that are intentional
5. Re-run the validate endpoint on fixed questions to confirm resolution

---

## Implementation Sequence

1. **Add API key auth** (Part 1 changes) -- one small PR touching `replitAuth.ts` and `.env.example`
2. **Set secrets in Replit** -- `ADMIN_API_KEY` and `ADMIN_API_KEY_USER_ID`
3. **Write the sweep script** -- `scripts/content-sweep.ts`
4. **Run the sweep** -- review results, fix critical issues
5. **Iterate** -- re-run after fixes to verify clean state

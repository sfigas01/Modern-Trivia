# CLAUDE.md

> **Root context for all AI Agents (Claude & Antigravity).**

## 1. Commands & Environment
- **Run Dev (Full Stack):** `npm run dev` (Starts frontend :5000 + backend :3000)
- **Database Push:** `npm run db:push` (Apply schema changes)
- **Build:** `npm run build`
- **Lint/Check:** `npm run check`

## 2. Tech Stack & Style
- **Frontend:** React, Vite, Shadcn UI, Tailwind CSS (@tailwindcss/vite).
- **Backend:** Express, Drizzle ORM, Postgres (pg), Passport Auth.
- **Language:** TypeScript (Strict).
- **Style:**
    - Use functional components & hooks.
    - Define Zod schemas in `shared/schema.ts`.
    - Use `lucide-react` for icons.

## 3. Documentation & Process
*   **Standards:** `docs/guides/documentation_standards.md`
*   **Process:** Spec-Driven Development (Specify -> Plan -> Tasks).
*   **Hierarchy:**
    *   **Epics:** `docs/epics/` (Strategic goals)
    *   **Features:** `docs/features/` (Shippable functionality)
*   **Roadmap:** `docs/PRODUCT_ROADMAP.md` (Update when creating Epics/Features).

## 4. Shared Workflows
Common workflows available to all agents are located in `.agent/workflows/`.
- **Epic Creator:** `.agent/workflows/modern-trivia-epic-creator.md` - Use when starting new epics.

---

## 5. Role: Trivia Content QA Specialist

You are a trivia content QA specialist for Modern Trivia. Your complete instructions are in `docs/guides/qa_instructions.md` — read that file at the start of any QA session.

**Quick Reference:**

- Question database: `client/src/lib/questions.json`
- Editorial rules: `CONTENT_STRATEGY.md`
- Full QA instructions: `docs/guides/qa_instructions.md`

**Key Rules:**
1. Always web search to verify facts before making corrections
2. GlobalEh content must NOT be US-centric
3. FreshPrints content must be from the last 3 months
4. Verify nationality before tagging celebrity questions

**Common Commands:**
- "Review questions [range] for factual accuracy"
- "Check pillar distribution"
- "Find US-centric GlobalEh questions"
- "Find stale FreshPrints content"
- "Fix question [id]: [issue]"

For full task list and detailed guidelines, see `docs/guides/qa_instructions.md`.

# CLAUDE.md

> **Root context for all AI Agents (Claude Code Desktop, Claude Code Web, Replit Codex, Antigravity).**

---

## ⚠️ Current Priority: Professionalise the App (No New Features)

**Feature development is paused.** The current focus is on DevOps, security, and operational maturity. Do not introduce new product features until this phase is complete. All work should fall into one of these categories:

1. **Security** — Secrets management, dependency scanning, vulnerability fixes
2. **DevOps** — CI/CD, testing, linting, pre-commit hooks, containerisation
3. **Observability** — Error tracking, structured logging, health checks
4. **Process** — Branch protection, PR workflow, versioning
5. **Bug fixes** — Only if critical to existing functionality

Track all DevOps work under **[STE-66: Implement Modern DevOps Practices](https://linear.app/stephs-vibe-coding/issue/STE-66)** in Linear (Modern Trivia project).

### 🔒 Security: In Progress

- An API key was previously exposed in git history — rotation and cleanup is underway (STE-53)
- **Never commit `.env` files or secrets.** Use `.env.example` as a reference template.
- Production secrets must go in **Replit Secrets**, not in code or config files.
- If you encounter any hardcoded secrets, credentials, or API keys in the codebase, **stop and flag it immediately** — do not commit over it.

---

## 1. Commands & Environment

- **Run Dev (Full Stack):** `npm run dev` (Starts frontend :5000 + backend :3000)
- **Database Push:** `npm run db:push` (Apply schema changes)
- **Build:** `npm run build`
- **Type Check:** `npm run check` (tsc, no emit)
- **Test:** `npm test` _(being set up — STE-55)_
- **Lint:** `npm run lint` (ESLint — TypeScript + React)
- **Lint Fix:** `npm run lint:fix` (auto-fix lint issues)
- **Format:** `npm run format` (Prettier — TS, TSX, JSON, Markdown)

## 2. Tech Stack & Style

- **Frontend:** React, Vite, Shadcn UI, Tailwind CSS (@tailwindcss/vite).
- **Backend:** Express, Drizzle ORM, Postgres (pg), Passport Auth.
- **Language:** TypeScript (Strict).
- **Style:**
  - Use functional components & hooks.
  - Define Zod schemas in `shared/schema.ts`.
  - Use `lucide-react` for icons.

## 3. DevOps & Quality

### Git Workflow

- **Branch naming:** `feature/STE-XX-description` or `fix/STE-XX-description`
- **Never push directly to `main`** — always use pull requests.
- **CI must pass before merging.** GitHub Actions runs type-check, build, and dependency audit on every push and PR to `main`.
- PR workflow: branch → push → CI green → merge. Never merge a red build.
- Pre-commit hooks will auto-run lint + type-check (once Husky is set up — STE-57).

### Quality Gates (enforced by CI — `.github/workflows/ci.yml`)

1. TypeScript type-check (`npm run check`) ✅ Live
2. Build succeeds (`npm run build`) ✅ Live
3. No high/critical dependency vulnerabilities (`npm audit`) ✅ Live (non-blocking)
4. ESLint passes (`npm run lint`) ✅ Live
5. All tests pass (`npm test`) — _coming soon, STE-55_

### Secrets & Environment

- **Never commit `.env` files or API keys** — this has caused a security incident already.
- Use `.env.example` as the template for required variables.
- Production secrets go in **Replit Secrets** (not in code).
- Required env vars: `DATABASE_URL`, `SESSION_SECRET`, `PORT`, `LINEAR_API_KEY`

### Testing _(being set up — STE-55)_

- New features and bug fixes must include tests.
- Test files: `*.test.ts` co-located with source files.
- Run `npm test` before committing.

### Logging _(being set up — STE-58)_

- Once Pino is set up, use `logger.info()` / `logger.error()` — not `console.log`.
- Never log passwords, tokens, or PII.

### Multi-Agent Context

This codebase is worked on by multiple AI agents:

- **Claude Code Desktop** (local terminal agent)
- **Claude Code Web** (browser-based agent)
- **Replit Codex** (Replit's built-in agent)
- **Antigravity** (autonomous agent)

All agents must follow the same quality gates, branching strategy, and commit conventions. Pre-commit hooks and CI enforce standards regardless of which agent authored the code. If you are an agent reading this, do not bypass quality checks or skip hooks with `--no-verify`.

**Agent coordination:** Check `.agent/AGENT_STATUS.md` before starting any STE-xx issue to see what's claimed. Update it when you pick up or finish work.

## 4. Documentation & Process

- **Standards:** `docs/guides/documentation_standards.md`
- **Process:** Spec-Driven Development (Specify -> Plan -> Tasks).
- **Hierarchy:**
  - **Epics:** `docs/epics/` (Strategic goals)
  - **Features:** `docs/features/` (Shippable functionality)
- **Roadmap:** `docs/PRODUCT_ROADMAP.md` (Update when creating Epics/Features).
- **Issue Tracker:** Linear — [Steph's Vibe Coding workspace](https://linear.app/stephs-vibe-coding). All DevOps work is under the **Modern Trivia** project.

## 5. Shared Workflows

Common workflows available to all agents are located in `.agent/workflows/`.

- **Epic Creator:** `.agent/workflows/modern-trivia-epic-creator.md` - Use when starting new epics.
- **Feature Creator:** `.agent/workflows/modern-trivia-feature-creator.md` - Use when specifying new features (FT-XX).

## 5. Active Epic

**Codebase Hardening: Security, CI, Testing & Code Quality (STE-40)**
Check Linear for the parent issue and 12 prioritized sub-issues (STE-41 through STE-52). Each sub-issue has full context, file references, and verification steps — enough for any agent or developer to pick up independently.

---

## 6. Role: Trivia Content QA Specialist

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

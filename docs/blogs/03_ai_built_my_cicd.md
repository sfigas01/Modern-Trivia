# How I Used AI to Build My Entire CI/CD Pipeline

In my last post, I talked about using four AI coding tools and how I set things up so they can all work together. In this one, I want to get specific about the piece that actually makes multi-agent collaboration possible: a CI/CD pipeline. Because as my productivity increased, I needed a way to ensure code quality kept up.

Here's how it happened.

### Why I Needed It

In my last post I described the multi-tool setup — four AI agents, shared config, Linear for tracking. That setup works great for organizing who does what. But it doesn't prevent an agent from shipping broken code.

After 200+ commits, that started to matter. I had merge conflicts, broken builds, and no way to know if a change from one agent would break something another agent had built. I needed automated guardrails. So I started describing what I wanted in plain language — things like _"I want every pull request to be checked for errors before it can merge"_ — and the agents built it.

### What the Pipeline Actually Does

My CI/CD workflow isn't done yet — but here's what I have so far. My CI workflow runs on every pull request, and it checks in this order:

1. **Agent manual sync** — verifies that my three shared agent config files (AGENTS.md, CLAUDE.md, replit.md) are identical, since all four of my AI tools read from them
2. **TypeScript type-check** — catches type errors before they ship
3. **ESLint** — flags code quality problems
4. **Tests** — runs automated game flow tests
5. **Dependency audit** — checks for known security vulnerabilities in packages
6. **Build** — makes sure the production build actually compiles

If any of these fail, the code can't merge. Period.

On top of that, I have:

- **Husky pre-commit hooks** that run linting and type-checking locally before code even gets pushed
- **Dependabot** that automatically opens pull requests when dependencies have updates or security patches — for both npm packages and GitHub Actions
- **A biweekly question quality audit** that automatically scans my trivia database for content issues and fails if anything high-severity is found

### Why This Matters for Non-Developers

If you're building with AI and skipping the ops side — the testing, the linting, the automated checks — you're building on sand. It feels slower to set this stuff up, but it's the difference between a demo and something you can actually maintain.

And the truth is, AI makes it accessible. You don't need to know YAML syntax or GitHub Actions configuration from memory. You just need to know what you want the system to do, and be willing to iterate until it works.

Ultimately, having these practices in place is what will allow me to spend more time developing features and less time fixing bugs. That's the whole point.

### Try It Yourself

If you want to set something like this up, here's what actually worked for me:

**Start by asking AI to audit your codebase.** I didn't start with a list of tools I wanted. I asked Claude to inspect my codebase and propose what I needed to align with modern DevOps practices. I left the decisions to AI — it told me I needed linting, testing, pre-commit hooks, and a CI pipeline, and then built each one.

**Sync your agent configs in CI.** My `AGENTS.md` file is copied to three entry points so every tool reads the same rules. To enforce this, I added a CI step that does a byte-for-byte comparison of all three files. If someone (or some agent) edits one without updating the others, the pipeline fails.

**Set up automated code reviews.** I use Codex to run automated reviews on every PR — and I set this up through a simple natural language prompt. It checks for code quality, security issues, and alignment with the project's conventions before I even look at it.

---

_This is the third in a series of posts on my vibe coding journey. Catch up on the first two: [Building Apps with AI: What I Learned](link) and [Why I Use Four AI Coding Tools](link)._

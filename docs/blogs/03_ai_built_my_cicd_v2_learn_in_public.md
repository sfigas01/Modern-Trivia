# How I Used AI to Build My Entire CI/CD Pipeline

## The Struggle: When the Prototype Outgrows Itself

I'm not a developer. I'm a product person who's been **building apps with AI coding tools** for the last three months.

At some point, my trivia app stopped being a prototype. I had **200+ commits**, a database migration, and **four different AI agents** all contributing code to the same repository.

The problem? **No guardrails.** No tests. No automated checks. No way to know if one agent's change would break something another agent had built.

I had merge conflicts I didn't understand. Broken builds I only discovered after deploying. The app was growing faster than my ability to keep it stable.

I knew I needed what real dev teams have — a **CI/CD pipeline**. I just didn't know what that actually meant.

## What I Leaned On

I didn't go take a DevOps course. I didn't read the GitHub Actions docs end to end. Here's what actually helped:

### Conversations with AI agents

The most useful "resource" was describing what I wanted in plain language. Things like _"I want every pull request to be checked for errors before it can merge"_ and _"I want something that automatically formats my code so it's consistent."_

The agents would generate YAML files and shell scripts, and I'd ask them to explain what each line did. That back-and-forth was more effective than any tutorial because it was **specific to my project**.

### Other people's repos

When I wanted to understand how CI pipelines are structured, I looked at how other open source projects set up their `.github/workflows/` folders. Seeing **real examples** was more helpful than reading abstract documentation.

### The GitHub Actions marketplace

I didn't need to build everything from scratch. **Dependabot**, for example, is just a config file — `dependabot.yml` — and it automatically opens pull requests when dependencies have security patches. Knowing what's already available saved me from overengineering.

## The Messy Middle: What I Actually Built

Here's my CI workflow. It runs on **every single pull request**. If any step fails, the code can't merge. Period.

### The 6-step quality gate

1. **Agent manual sync** — checks that my three shared config files (AGENTS.md, CLAUDE.md, replit.md) are identical. Since four AI tools all read these files, they have to stay in sync.

2. **TypeScript type-check** — catches type errors before they ship.

3. **ESLint** — flags code quality problems.

4. **Tests** — runs automated game flow regression tests.

5. **Dependency audit** — checks for known security vulnerabilities.

6. **Build** — makes sure the production build actually compiles.

### What runs before code even gets pushed

I set up **Husky pre-commit hooks** that run linting and type-checking locally. If the code doesn't pass, it won't even let you commit. The first check in the pipeline — the agent manual sync — is unique to my setup, because I needed a way to enforce that all four AI agents are reading the same playbook.

### What runs automatically on a schedule

**Dependabot** opens PRs weekly for both npm packages and GitHub Actions updates.

I also have a **biweekly question quality audit** — a GitHub Action that scans my trivia database for content issues (bad tags, duplicate questions, factual problems) and fails the workflow if anything high-severity is found.

### The part I didn't expect

The agent manual sync step is probably the most interesting. It uses a shell script that runs `cmp -s` to compare the three agent files byte-for-byte. If they differ, CI fails with a diff showing exactly what's out of sync.

**I didn't write that script.** One of my AI agents did. But I can read it now and tell you exactly what it does, because I had to debug it when it first broke.

## Learning Exhaust: What You Can Take From This

If you're building with AI and skipping the ops side, here's a checklist:

- [ ] **Start with a CI workflow.** Even a basic one that just runs `npm run build` will catch more than you think.
- [ ] **Add a linter (ESLint) and formatter (Prettier).** These prevent style debates and catch real bugs. AI agents especially benefit from consistent formatting.
- [ ] **Set up pre-commit hooks (Husky + lint-staged).** Catch problems before they get pushed, not after.
- [ ] **Turn on Dependabot.** It's a single YAML file and it keeps your dependencies patched automatically.
- [ ] **Add at least one test.** You don't need 100% coverage. One test that verifies your core flow will save you from shipping something completely broken.
- [ ] **If you use multiple AI tools, add a sync check.** Whatever shared config files your agents depend on, verify they stay consistent in CI.

The boring stuff is what lets you **stay in the building phase** with confidence.

## Over to You

I set all of this up as a non-developer using AI tools. It's not perfect — there are gaps I'm still filling. But it works, and it's caught real problems before they shipped.

**I'm curious:** if you're building with AI, what does your quality setup look like? Are you running any checks at all, or are you shipping and hoping? How would you have approached this differently?

I'm genuinely still learning, and I'd rather learn from someone else's experience than from my next broken deploy.

---

_This is the third in a series of posts on my vibe coding journey. Catch up on the first two: [Building Apps with AI: What I Learned](link) and [Why I Use Four AI Coding Tools](link)._

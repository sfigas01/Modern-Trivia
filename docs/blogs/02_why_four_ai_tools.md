# Why I Use Four AI Coding Tools Instead of One

In my last post, I talked about building two apps as a non-developer using AI coding tools. In this one, I want to get into the how — specifically, why I use four different tools and how I set things up so they all work together.

The four tools I use are Claude, Replit, Codex, and Gemini (Antigravity). Read on below to find out why I use so many tools.

### Why I Use Multiple Tools

There are three reasons I ended up with four tools instead of one.

**Curiosity.** I wanted to understand what each tool could do. Over time, even as they converge on capabilities, they all have distinct strengths and weaknesses. No single tool is the best at everything.

**Cost management.** As a hobbyist, tokens get expensive. I have subscriptions to Claude, ChatGPT, Replit, and Gemini. I really like Claude and Replit, but I hit their limits quickly. I needed to find a way to maximize what I'm already paying for across all four.

**No lock-in.** Since each tool has its own benefits, I didn't want to be dependent on any one provider. I wanted to take advantage of the latest and best features of each — and be able to swap one out if something better comes along.

### What I Actually Set Up

**Each tool has a role:**

**Replit** is where the app lives and runs. It's my hosting environment and it's great for quick iterations — I can make a change and see it live immediately. The other benefit is that it's very beginner-friendly. It set up my database and connected to API keys in one click. I didn't have to know how to do it or what to prompt.

**Claude** is excellent at reviews and precise tasks. I give it a Linear ticket, it creates a branch, writes the code, and opens a PR. Clean and contained. I find it to be the best at focused, scoped work — though not as great at creativity or when I can't describe well what I want.

**Codex** is my thinking partner. Architecture decisions, documentation, complex refactors — when I need to reason through something before building it, that's where I go.

**Antigravity (Gemini)** has generous limits, and I still like having an IDE from time to time to make specific changes or have better line of sight into the changes being made.

**The glue that holds it together:**

Using multiple tools only works if they can pick up where each other left off. I have three things that make this work:

1. **A shared agent config file** — I have a single `AGENTS.md` file that's synced across three entry points (`AGENTS.md`, `CLAUDE.md`, `replit.md`) so every tool reads the same rules. It covers everything from security policies to git conventions to current priorities. For example:

> _Security: "Never commit .env files, API keys, credentials, or secrets. Use .env.example as the reference template."_
>
> _Git: "Never push directly to main; use pull requests. CI must pass before merge. Do not bypass hooks with --no-verify."_
>
> _Priority order: 1. Security → 2. DevOps → 3. Observability → 4. Process → 5. Critical bug fixes_

2. **GitHub as the single source of code** — All agents push and pull from the same GitHub repository. PRs, conventional commits, and branch naming conventions are all standardized so any agent's work looks the same.

3. **Linear as the authoritative project tracker** — I track all work in Linear, not in any tool's memory. If an agent loses context, the project plan survives. This also makes it easier on me as the human to keep track of the work when I'm not in it every day.

### What I Learned: Open Source Standards Are More Important Than Ever

The deeper lesson from this setup isn't really about which tools I picked. It's about **open source standards**.

Files like `AGENTS.md` and `skills.md`, protocols like **MCP** (Model Context Protocol) and **A2A** (Agent-to-Agent) — these are what allow multiple agents to work on the same codebase without stepping on each other. They're the common language.

If we truly believe AI will augment humans in the workplace, then I see a future where **people come to work with their own coding agents** — agents that are tuned to their own preferences and styles. Teams will share standard procedures written in skills files and agent configs that all agents can access. And those agents will be connected using shared resources and tools like GitHub, Linear, and MCP servers.

The more I build this way, the more convinced I am that **investing in open standards now is the highest-leverage thing you can do** — whether you're a solo builder or a team lead.

### Try It Yourself

**Learn git.** Don't just let the agents handle it. Understand branches, worktrees, merge conflicts, and how to revert. This is the one skill that will save you the most pain, and it's what gives you confidence to let agents operate independently.

**Create an `AGENTS.md` file.** Write down your project's operating rules — security policies, git conventions, priority order, quality gates — and put it at the root of your repo. Point every tool to it. This is the single most impactful thing I did.

**Use Linear (or a tracker) as your source of truth.** Not only does this make it easier to switch agents — it also makes it easier on you as the human to stay oriented when you're not in the code every day. If an agent loses context mid-task, your project plan should survive.

---

_This is the second in a series of posts on my vibe coding journey. Next up: how I used AI to build my entire CI/CD pipeline from scratch — without knowing what YAML was._

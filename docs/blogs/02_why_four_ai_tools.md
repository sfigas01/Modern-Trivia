# Why I Use Four AI Coding Tools — and Keep My Brain Outside All of Them

In my last post, I talked about the two apps I've built as a non-developer using AI coding tools. In this one, I want to get more into why I use four different tools, how I set things up so they all work together, and what I think this means for platforms and the people who use them.

### Why I Use Multiple Tools

The four tools I use are Claude Code, Replit, Codex, and Antigravity. There are three reasons I ended up with four tools instead of one.

**Curiosity.** I wanted to understand what each tool could do. Even as they converge on capabilities, they all have distinct strengths and weaknesses. No single tool is the best at everything.

**Cost management.** As a hobbyist, tokens get expensive. I have subscriptions to Claude, ChatGPT, Replit, and Gemini. I really like Claude and Replit, but I hit their limits quickly. I needed to find a way to maximize what I'm already paying for across all four.

**No lock-in.** Since each tool has its own benefits, I didn't want to be dependent on any one provider. I wanted to take advantage of the latest and best features of each — and be able to swap one out if something better comes along.

### What I Actually Set Up

**Each tool has a role:**

**Replit** is where my current apps were created and are hosted. I started using it because it's very beginner-friendly. When I started, I didn't know anything and so it set up my environments, database, connected my API keys, managed secrets, and does security checks for me in one click. It's great for when you don't know what you don't know.

**Claude** is excellent at starting from scratch. It's great at planning and coding professional apps. It's easily my model of choice.

**Codex** is my expert reviewer. I find it's one of the better technical coders and so I give it code to review and it finds bugs and fixes everything.

**Antigravity** gives me an IDE so I can see the files and manage branches and commits before they get to GitHub. It also has generous limits. The tradeoff is that it isn't great at enforcing me to always start on a new branch, so I've had to set up a weekly automation (with Codex) to help clean up old branches.

**The glue that holds it together:**

Using multiple tools only works if they can pick up where each other left off. I have three things that make this work:

1. **A shared agent config file** — I have a single `AGENTS.md` file that's synced across three entry points (`AGENTS.md`, `CLAUDE.md`, `replit.md`) so every tool reads the same rules. It covers everything from security policies to git conventions to current priorities. For example:

> _Security: "Never commit .env files, API keys, credentials, or secrets. Use .env.example as the reference template."_
>
> _Git: "Never push directly to main; use pull requests. CI must pass before merge. Do not bypass hooks with --no-verify."_
>
> _Priority order: 1. Security → 2. DevOps → 3. Observability → 4. Process → 5. Critical bug fixes_

2. **GitHub as the single source of code** — All agents push and pull from the same GitHub repository. PRs, conventional commits, and branch naming conventions are all standardized so any agent's work looks the same.

3. **Linear as the authoritative memory and project tracker** — I track all work in Linear, not in any tool's memory. If an agent loses context, the project plan survives. This also makes it easier on me as the human to keep track of the work when I'm not in it every day.

### What I Learned: Open Standards Are More Important Than Ever

The deeper lesson from this setup isn't really about which tools I picked or how I connected them — it's about **open standards**.

Files like `AGENTS.md` and `skills.md` and protocols like **MCP** (Model Context Protocol) easily allow multiple agents, whether it's one person using multiple agents or a team of people using their preferred agent, to work on the same codebase or project with shared memory and standards.

But more interestingly, I mentioned avoiding lock-in earlier as one of my reasons for using multiple tools. It goes deeper than just having options. It's about the realization that **your intelligence should live outside any single platform.**

The agent configs, skill files, workflows, and project knowledge I've built — that's my brain. It's been shaped by how I work, what I've learned, and what matters for my projects. If that knowledge lived inside one tool's proprietary format, I'd be locked in. And in a space where capabilities shift fast, prices change, and new tools emerge constantly — lock-in is the most expensive mistake you can make.

By keeping my brain in open, portable formats — markdown files, standard git repos, shared protocols — I can plug into whatever tool is best _right now_ without losing everything I've built. And when something better comes along, I just point it at the same files and keep going.

If we truly believe AI will augment humans in the workplace, then I see a future where **people come to work with their own coding agents** — agents tuned to their own preferences and matured through their own experiences. Teams will share standard procedures through skills files and agent configs.

Imagine onboarding a new team member who already has an agent that knows how they think, what mistakes they tend to make, and how they like to structure code — and on day one, that agent plugs into the team's shared config and starts contributing. You get the best of both worlds: corporate knowledge and personal knowledge, working together.

### What This Means for Platforms

This shift has implications for the tools themselves. If your users' intelligence lives in open, portable formats, **lock-in stops being a competitive advantage**. Platforms can't rely on being the place where someone's brain lives — because it won't live there anymore.

That's actually a good thing. It forces platforms to compete on what actually matters: their value proposition. Speed, reliability, UX, unique capabilities — the things that make a user _choose_ your tool, not feel _trapped_ by it. The platforms that embrace portability and make it easy to switch _to_ them will win.

I'm already seeing this play out in how I work. The tools I keep coming back to aren't the ones that try to own my workflow — they're the ones that make it effortless to bring my own.

So to close this off, before you go all-in on any AI platform, plan where your brain will live and make sure its in a format that can work with different platforms.

---

\_This is the second in a series of posts on my vibe coding journey. Next up: how I used AI to build my entire CI/CD pipeline and automate quality reviews.

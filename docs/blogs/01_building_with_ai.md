# What Building Two Apps with AI Taught Me

I work in product and strategy. I don't have a development background. But I constantly see things that would make my life — or someone else's — easier. I used to search the App Store hoping someone had already built these kinds of tools for a reasonable fixed price — not a subscription — but would always be disappointed, especially as more and more apps turned to subscription models.

Now, thanks to AI coding agents, I've built two working apps myself in three months.

### How It Started and How It's Going

It started small. I needed a fitness pass tracker, so I tried building one with AI. It worked. That gave me enough confidence to take on something bigger.

The second app is called **Modern Trivia** — a multiplayer trivia game you play in the browser with friends. Teams compete through rounds, answers get verified automatically (so "Mt. Everest" and "Mount Everest" both count), and there's a system for disputing questions when the game gets it wrong. It runs on a Postgres database, has an admin panel, and is deployed and playable. It's not a prototype.

### What I Actually Built

In three months, on a part-time schedule, I've made **213 commits** to the repository and shipped **3 official releases** across a full tech stack (React, Node.js, PostgreSQL):

- **v0.1.0** — Core trivia gameplay: team-based multiplayer, 200 questions, intelligent answer verification, a dispute system, admin panel, and Replit deployment
- **v0.2.0** — Quality and DevOps: a Vitest test suite, ESLint and Prettier, CI quality gates in GitHub Actions, and state machine documentation
- **v0.3.0** — Database migration and hardening: moved questions from a static JSON file to PostgreSQL, added Dependabot, Husky pre-commit hooks, game flow regression tests, and a question quality audit system

Each release built on the last — features first, then quality, then infrastructure.

### What I've Learned So Far

Honestly, vibe coding is addictive. There is an incredible rush when you realize you have the tools to turn your own ideas into a reality with your own two hands. You stop waiting for permission or budget. You just start building.

The bigger realization is about **productivity**. If I can build two apps with only a few hours every weekend — and push through this many PRs while learning development practices from scratch — it puts into perspective how much faster lean product teams could move with these tools. I've said it before: I believe the future bottleneck isn't development time. It's product strategy time — figuring out _what_ to build.

### Recommendations If You're Curious

**Pick a real problem you have.** Not a tutorial project — something you'd actually use. My fitness tracker was boring, but I used it every week. That's what kept me going long enough to learn.

**Don't over-direct.** AI is a much better product manager than me. Tell it what you need and why. Ask it to look at your problem from various personas, just like you would if you were working in a team. You'll be surprised how much better the output is when you give it room to think.

**Invest in the fundamentals early.** It's tempting to just keep shipping features, but spending a week on CI/CD, testing, and linting will save you months of debugging later. I'll go deeper on how I set this up in a future post — but trust me, it's worth doing sooner than you think.

If you're curious about building with AI but feel like you need more technical background first — I'd push back on that. Just pick something you want to build and start. Anyone can do this. You'll learn what you need when you need it.

---

_This is the first in a series of posts on my vibe coding journey. Next up: why I use 4 different AI coding tools, and how I'm using AI to create and automate CI/CD._

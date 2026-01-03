# Modern Trivia - App Context for Quality Review

## Overview

Modern Trivia is a browser-based multiplayer trivia party game designed for local teams (2-6 teams) playing together. The app was created using ChatGPT, Replit, and Codex, with Claude Code used for documentation updates.

**Live URL:** https://replit.com/@stephaniefigas/Modern-Trivia
**Repository:** https://github.com/sfigas01/Modern-Trivia

**Core Philosophy:** "Freshly Squeezed & Globally Smart" — A trivia game that mixes hyper-local Canadiana with globally relevant general knowledge, avoiding US-centric defaults while staying accessible to Canadians aged 18-50.

---

## Content Architecture

### Question Database
- **Total Questions:** 200 built-in trivia questions
- **Storage Location:** `client/src/lib/questions.json`
- **Custom Questions:** Stored in browser localStorage via admin panel

### Categories
- Geography
- Science
- History
- Music
- Sports
- Pop Culture
- (Players can filter by category or select "All")

### Difficulty Levels & Scoring
| Difficulty | Points (Correct) | Points (Incorrect) |
|------------|------------------|-------------------|
| Easy       | +1               | -1                |
| Medium     | +2               | -2                |
| Hard       | +3               | -3                |

### Regional Tags
- **CA** - Canada-focused content
- **US** - United States content
- **Global** - International/general knowledge

**Default Filtering:** Game filters to Canadian-friendly content by default (Global + CA tagged questions)

---

## Content Pillars & Distribution

### 🎬 TimeCapsule (Target: 30%)
**Audience:** Gen X / Elder Millennials (30-50)

Shared nostalgia from the 80s, 90s, and 2000s — iconic Canadian moments, beloved pop culture, historical landmarks, generational touchstones.

*Examples: Degrassi, MuchMusic VJs, Heritage Moments, early internet culture*

### 🌍 GlobalEh (Target: 30%)
**Audience:** Everyone (The "Smart" Pillar)

General knowledge that is **NOT US-centric**. World history, science, geography, literature, and culture from a global perspective.

**Editorial Rule:** Geography won't be about Iowa; history avoids US Civil War unless Canada was involved. Focus on world capitals, Nobel Prize winners, European history, Asian cultures, international sports.

*Examples: World capitals, international Nobel Prize winners, global science facts, World Cup*

### ⚡ FreshPrints (Target: 25%)
**Audience:** Gen Z / Younger Millennials (18-30) + News Junkies

Viral moments, current Billboard hits, trending topics, and meme culture. **Intended to reflect the last 3 months** — this pillar requires periodic updates to stay current.

*Examples: Recent celebrity news, current chart toppers, recent awards winners, trending social media moments*

### 🏕️ GreatOutdoors (Target: 15%)
**Audience:** The "Hoser" Lifestyle

Culinary, travel, slang, cottage life, and uniquely Canadian experiences.

*Examples: Poutine, Canadian slang ("double-double", "toque"), CN Tower, cottage culture, Tim Hortons*

---

## Answer Verification System

### Fuzzy Matching
- **Similarity Threshold:** 80% (using string-similarity library)
- **Normalization handles:**
  - Case insensitivity
  - Punctuation removal
  - Articles (a, an, the)
  - Number words (e.g., "one" vs "1")
  - Minor typos

---

## Technical Stack

### Frontend
- React 19 + TypeScript
- Vite build system
- Tailwind CSS v4
- Radix UI components
- Framer Motion animations
- React Query for state
- Wouter routing
- React Hook Form + Zod validation

### Backend
- Node.js 20 + TypeScript
- Express.js
- Drizzle ORM
- PostgreSQL 16
- Replit Auth (OpenID Connect)

---

## Game Flow (State Machine)

1. **SETUP** → Add teams, configure settings
2. **QUESTION** → Display question, accept answer
3. **VERIFYING** → Normalize and compare answer (transient)
4. **REVEAL** → Show result and correct answer
5. **SCORE_UPDATE** → Apply points, rotate teams (transient)
6. **ROUND_SCORE** → Display scores after complete round
7. **GAME_OVER** → Final scoreboard and winner

**Round System:** Teams rotate after every 4 questions

---

## Admin Features

- Add/edit/delete custom questions (localStorage)
- View and manage dispute logs
- Grant/revoke admin roles
- Dispute system for challenging answers (requires authentication)

---

## Quality Review Focus Areas

### 1. Content Quality
- Factual accuracy of questions and answers
- Appropriateness of difficulty ratings
- Category assignment accuracy
- Regional tag correctness
- Content pillar alignment

### 2. Pillar Distribution Audit
- **Target:** TimeCapsule 30%, GlobalEh 30%, FreshPrints 25%, GreatOutdoors 15%
- Verify actual question counts match intended distribution
- Flag imbalances that may affect gameplay variety

### 3. Editorial Rule Compliance
- **GlobalEh:** Verify questions are NOT US-centric (no Iowa geography, no US Civil War unless Canada-relevant)
- **FreshPrints:** Flag questions that may have become stale (content older than 3 months)
- **Regional tags:** Ensure CA/US/Global tags are accurate

### 4. Audience-Difficulty Alignment
- TimeCapsule (30-50 audience) — difficulty should match this demo
- FreshPrints (18-30 audience) — difficulty should match this demo
- Flag mismatches where difficulty doesn't suit target audience

### 5. Answer Verification Edge Cases
- Test 80% fuzzy threshold for false positives/negatives
- Identify acceptable answer variants not currently handled
- Flag ambiguous answers that may cause disputes

### 6. Data Integrity
- Duplicate question detection
- Consistent formatting across all questions
- Proper JSON structure
- Missing or incomplete fields (question, answer, category, difficulty, regional tag, pillar tag)
- Every question should have ALL tag types present

---

## Key Files for Review

| File | Purpose |
|------|---------|
| `client/src/lib/questions.json` | Main question database (200 questions) |
| `CONTENT_STRATEGY.md` | Content guidelines and pillars |
| `docs/STATE_MACHINE.md` | Game flow documentation |
| `docs/ADMIN_SETUP.md` | Admin role setup |
| `server/routes.ts` | API routes including disputes |

---

## Notes for Quality Review Planning

- Questions are JSON-formatted with fields for: question, answer, category, difficulty, regional tags, and content pillar
- The 80% fuzzy matching threshold is a key area to test — both for catching legitimate typos and avoiding false positives
- Canadian-focused content (GlobalEh pillar) should be verified for accuracy and relevance
- Custom questions added via admin panel bypass the core question database, creating a separate QA stream
- The dispute system exists but requires authentication — logs should be reviewed for patterns
- FreshPrints pillar is designed for AI-assisted updates; stale content is expected and flagging it is part of the review process

---

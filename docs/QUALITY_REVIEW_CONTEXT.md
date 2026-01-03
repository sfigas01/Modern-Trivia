# Modern Trivia - App Context for Quality Review

## Overview

Modern Trivia is a browser-based multiplayer trivia party game designed for local teams (2-6 teams) playing together. The app was created using ChatGPT, Replit, and Codex, with Claude Code used for documentation updates.

**Live URL:** https://replit.com/@stephaniefigas/Modern-Trivia
**Repository:** https://github.com/sfigas01/Modern-Trivia

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

### Content Pillars
1. **TimeCapsule** - Historical events and cultural moments
2. **GlobalEh** - International knowledge with Canadian perspective
3. **FreshPrints** - Recent events and modern culture
4. **GreatOutdoors** - Nature, geography, and wildlife

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

### 2. Answer Verification
- Edge cases in fuzzy matching
- Acceptable answer variants
- False positive/negative rates
- Handling of ambiguous answers

### 3. User Experience
- Question clarity and readability
- Answer format expectations
- Feedback on correct/incorrect
- Difficulty progression

### 4. Data Integrity
- Duplicate question detection
- Consistent formatting
- Proper JSON structure
- Missing or incomplete fields

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
- The 80% fuzzy matching threshold is a key area to test - both for catching legitimate typos and avoiding false positives
- Canadian-focused content (GlobalEh pillar) should be verified for accuracy and relevance
- Custom questions added via admin panel bypass the core question database, creating a separate QA stream
- The dispute system exists but requires authentication - logs should be reviewed for patterns

---

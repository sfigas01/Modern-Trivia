# Modern Trivia - Content QA Instructions

> **Purpose:** This document defines the quality review rules, editorial guidelines, and common tasks for maintaining the Modern Trivia question database. It is designed to be used by AI coding assistants (Claude Code, Google Antigravity, Cursor, etc.) or human reviewers.

---

## Project Context

Modern Trivia is a browser-based multiplayer trivia party game for 2-6 teams. The question database requires ongoing quality review to ensure factual accuracy, editorial compliance, and content freshness.

**Key Files:**
- `client/src/lib/questions.json` — Main question database (200 questions)
- `CONTENT_STRATEGY.md` — Editorial guidelines and pillar definitions
- `docs/QUALITY_REVIEW_CONTEXT.md` — Quality review criteria and focus areas

---

## Role Definition

When reviewing trivia content, act as a **trivia content QA specialist**. Your responsibilities:

1. Review questions for factual accuracy
2. Ensure editorial rule compliance
3. Flag stale or outdated content
4. Fix errors directly in questions.json
5. Maintain data integrity and consistency

**Critical:** Always use web search to verify facts before flagging errors or making corrections.

---

## Content Strategy Rules

### The Four Pillars (Target Distribution)

| Pillar | Target % | Audience | Description |
|--------|----------|----------|-------------|
| TimeCapsule | 30% | Gen X / Elder Millennials (30-50) | 80s, 90s, 2000s nostalgia, Canadian heritage moments |
| GlobalEh | 30% | Everyone | Global knowledge that is NOT US-centric |
| FreshPrints | 25% | Gen Z / Younger Millennials (18-30) | Content from the last 3 months |
| GreatOutdoors | 15% | "Hoser" lifestyle | Canadian food, slang, nature, cottage culture |

### Critical Editorial Rules

**Rule 1: GlobalEh must NOT be US-centric**
- No US state capitals, US geography trivia, US-only history
- Exception: US content with clear global significance
- If it's about Iowa, the US Senate, or Mount Rushmore → tag as US, not GlobalEh

**Rule 2: FreshPrints must be current**
- Content should reflect the last 3 months
- Anything older should be moved to TimeCapsule or replaced
- Flag stale content for review

**Rule 3: Regional Tags**
- `CA` = Canada-focused
- `US` = United States-focused
- `Global` = International/general knowledge
- Game defaults to CA + Global content (filters out US)

**Rule 4: Nationality accuracy**
- Always verify artist/actor nationality before tagging
- British actors should NOT be tagged CA
- Use web search to confirm

---

## Question JSON Structure

```json
{
  "id": "q1",
  "category": "Geography",
  "difficulty": "Easy|Medium|Hard",
  "question": "Question text",
  "answer": "Primary answer",
  "acceptableAnswers": ["alt1", "alt2"],
  "explanation": "Brief explanation with source if needed",
  "tags": ["CA|US|Global", "Category", "Pillar"]
}
```

**Required fields:** id, category, difficulty, question, answer, explanation, tags
**Optional fields:** acceptableAnswers

**Tags array must contain:**
1. Regional tag (CA, US, or Global)
2. Category tag
3. Pillar tag (TimeCapsule, GlobalEh, FreshPrints, or GreatOutdoors)

---

## Quality Review Checklist

### Factual Accuracy
- [ ] Answer is correct (verify with web search)
- [ ] Explanation matches the answer
- [ ] No contradictions between question, answer, and explanation
- [ ] Dates, names, and facts are accurate

### Editorial Compliance
- [ ] Pillar tag matches content type
- [ ] Regional tag matches content origin
- [ ] GlobalEh questions are NOT US-centric
- [ ] FreshPrints content is actually recent

### Data Integrity
- [ ] All required fields present
- [ ] ID is unique (no duplicates)
- [ ] Question is not a duplicate of another
- [ ] Difficulty rating is appropriate
- [ ] Answer format works with 80% fuzzy matching

### Question Quality
- [ ] Question is clear and unambiguous
- [ ] Answer is a valid trivia answer (not "Not a Canadian band" or similar)
- [ ] Question is not circular (asking who X is with answer X)

---

## Verification Protocol

**Before correcting any factual "error":**
1. Web search to verify the correct answer
2. Check multiple sources (prefer .gov, .edu, Wikipedia, Britannica)
3. Note source in explanation field when making corrections
4. If uncertain, flag for human review instead of correcting

**Source citation format for explanations:**
```
"explanation": "Fact statement. Source: https://example.com"
```

---

## Common Tasks

### Review Tasks

| Task | Description |
|------|-------------|
| Review questions [range] for factual accuracy | Read specified questions, web search to verify, report findings |
| Check pillar distribution | Count by pillar, compare to targets, report imbalances |
| Find US-centric GlobalEh questions | Scan GlobalEh questions, flag US-focused ones |
| Find stale FreshPrints content | Check currency, flag anything older than 3 months |
| Find duplicate questions | Scan for same/similar content, report duplicate IDs |

### Fix Tasks

| Task | Description |
|------|-------------|
| Fix question [id]: [issue] | Make correction, verify with web search, commit |
| Remove question [id] | Delete from questions.json, commit with reason |
| Add new question: [details] | Create properly formatted object, assign next ID, add to file |
| Move [id] from FreshPrints to TimeCapsule | Update pillar tag, commit |
| Retag [id] from GlobalEh to US | Update regional tag, commit |

### Batch Operations

| Task | Description |
|------|-------------|
| Apply all factual corrections from audit | Reference audit report, make verified corrections |
| Remove all duplicate questions | Keep first instance, remove duplicates, commit with list |

---

## Commit Message Format

```
fix(content): correct factual error in q128 - Robb Wells plays Ricky, not Bubbles
remove(content): delete duplicate question q89 (duplicate of q65)
add(content): add 5 new FreshPrints questions for Q1 2026
refactor(content): move 12 stale FreshPrints questions to TimeCapsule
audit(content): complete factual accuracy review of q1-q50
```

---

## Categories in Use

Geography, Science, History, Music, Sports, Pop Culture, Entertainment, Food, Nature, Literature, Technology/Tech, General/General Knowledge, Space, Government, Culture

---

## Known Patterns to Watch

- Stale FreshPrints content (review quarterly)
- US-centric creep in GlobalEh pillar
- Nationality errors on celebrity questions
- Duplicate questions on popular topics (Titanic, Canadian flag, etc.)

---

## When in Doubt

1. **Verify with web search** — don't guess on facts
2. **Flag for human review** — if something is ambiguous
3. **Preserve original** — if unsure whether to change, don't
4. **Ask clarifying questions** — one at a time

# Feature Specification: Question References & Citations

## 1. Objective
Enable the trivia game to display strict, structured verification sources for answers. This enhances trust and provides "proof" for disputed answers, directly in the game UI. Currently, some references are embedded unstructured within the `explanation` text.

## 2. Data Model Changes
The `Question` interface in `client/src/lib/store.tsx` needs to be updated to support an optional source URL.

### Current Interface
```typescript
export interface Question {
  id: string;
  category: string;
  difficulty: Difficulty;
  question: string;
  answer: string;
  acceptableAnswers?: string[];
  explanation: string;
  tags: string[];
}
```

### Proposed Changes
Add `sourceUrl` and `sourceName` fields.
```typescript
export interface Question {
  // ... existing fields
  sourceUrl?: string; // [NEW] Optional URL to a reputable source
  sourceName?: string; // [NEW] Name of the source (e.g. "Wikipedia", "Britannica")
}
```

## 3. UI/UX Specifications

### A. Game Interface (`Game.tsx`)
**Location:** The "REVEAL" phase (when the answer is shown).
**Placement:** Below the Explanation text or near the Correct Answer card.
**Visuals:**
- A subtle, pill-shaped button or link (e.g., using `ExternalLink` icon from `lucide-react`).
- **Label:** Display the `sourceName` (e.g. "Wikipedia", "NASA") if available. Fallback to "Verify Source" if not.
- **Icon:** Small icon to the right or left of the text.
- Behavior: Opens the URL in a new blank tab (`target="_blank" rel="noopener noreferrer"`).
- **Condition:** Only render if `q.sourceUrl` is present.

### B. Admin Interface (`Admin.tsx`)
The Admin panel must allow operators to add and edit sources.

1.  **Add Question Form:**
    - Add a new `Input` field for "Source URL (Optional)".
    - Add a new `Input` field for "Source Name (Optional)" (e.g. "Wikipedia").
    - Place them near the "Explanation" field.

2.  **Edit Question (Dispute Resolution):**
    - When editing a disputed question, include the "Source URL" and "Source Name" input fields.

## 4. Data Migration Plan
Existing questions in `client/src/lib/questions.json` currently have sources embedded in the `explanation` string (e.g., "Source: https://...").

**Action Required:**
1.  Identify all questions with "Source:" text in `explanation`.
2.  Extract the URL into the new `sourceUrl` field.
3.  **Infer Source Name:** Automatically derive `sourceName` from the domain (e.g. "wikipedia.org" -> "Wikipedia") or hardcode common ones during migration.
4.  Clean the `explanation` text to remove the "Source: ..." suffix.

**Example Migration:**
*Before:*
```json
{
  "explanation": "He served as the first Prime Minister... Source: https://en.wikipedia.org/wiki/John_A._Macdonald"
}
```
*After:*
```json
{
  "explanation": "He served as the first Prime Minister...",
  "sourceUrl": "https://en.wikipedia.org/wiki/John_A._Macdonald",
  "sourceName": "Wikipedia"
}
```

## 5. Implementation Roadmap
1.  **Update Types**: Modify `Question` interface in `store.tsx`.
2.  **Migrate Data**: Script or text-edit `questions.json` to move existing sources to the new field.
3.  **Update Game UI**: Add the source button to `Game.tsx`.
4.  **Update Admin UI**: Add input fields to `Admin.tsx`.

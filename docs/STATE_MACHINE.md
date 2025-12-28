# Modern Trivia Game State Machine

## Overview
The game uses a linear state machine to ensure data integrity and a consistent gameplay loop. This document outlines the states, transitions, and verification logic.

## States

1. **SETUP**
   - **Description**: Initial state. User adds teams, configures settings (Country Bias).
   - **Allowed Actions**: `addTeam`, `removeTeam`, `setCountryBias`, `startGame`.
   - **Next State**: `QUESTION` (via `startGame`).

2. **QUESTION**
   - **Description**: A question is displayed to the active team. Input field is open.
   - **Data**: `activeTeamId` is set. `typedAnswer` preserves user input.
   - **Allowed Actions**: `setTypedAnswer`, `submitAnswer` (triggers transition), `passQuestion` (triggers transition).
   - **Next State**: `VERIFYING`.

3. **VERIFYING** (Transient)
   - **Description**: System freezes the `submittedAnswer` and the current `question`. It computes the `verdict` and `pointsDelta`.
   - **Logic**:
     - Normalize `submittedAnswer` and `question.answer`/`question.acceptableAnswers`.
     - Compare.
     - Set `verdict` to `CORRECT`, `INCORRECT`, or `PASS`.
     - Calculate `pointsDelta`.
   - **Next State**: `REVEAL` (Immediate transition).

4. **REVEAL**
   - **Description**: Read-only view showing the question, user's answer, correct answer, explanation, and the verdict/points result.
   - **Allowed Actions**: `advanceToScoreUpdate`.
   - **Next State**: `SCORE_UPDATE`.

5. **SCORE_UPDATE** (Transient)
   - **Description**: System applies the `pointsDelta` to the `activeTeam`'s score.
   - **Guards**: Checks `attemptId` or similar to ensure points are applied exactly once.
   - **Logic**:
     - Update Team Score.
     - Increment `teamQuestionCount`.
     - Rotate `activeTeamId` if `teamQuestionCount` % 4 == 0.
     - Increment `currentQuestionIndex`.
   - **Next State**: `QUESTION` (or `GAME_OVER` if no questions remain).

6. **GAME_OVER**
   - **Description**: Final scoreboard.
   - **Allowed Actions**: `resetGame`.
   - **Next State**: `SETUP`.

## Answer Normalization Rules
To verify answers automatically, both the user input and the canonical answers are normalized using the following chain:
1. **Trim**: Remove leading/trailing whitespace.
2. **Lowercase**: Convert to lowercase.
3. **Remove Punctuation**: Remove `.`, `,`, `'`, `"`, `!`, `?`.
4. **Remove Articles**: Remove starting "the ", "a ", "an " (optional, but implemented for robustness).
5. **Number Conversion**: (Optional) Convert "one" to "1", etc. (Currently strict string matching).

## Attempt Object Schema
```typescript
interface Attempt {
  questionId: string;
  teamId: string;
  submittedAnswer: string | null; // null if passed
  verdict: "CORRECT" | "INCORRECT" | "PASS";
  pointsDelta: number;
  processed: boolean; // Guard for score application
}
```

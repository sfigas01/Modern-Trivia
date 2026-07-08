import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameProvider, useGame, normalize, verifyAttempt } from './store';
import type { Question } from './store';
import { getGuestSeenIds, addGuestSeenIds } from './guest-seen';

// Stub localStorage for jsdom compatibility
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = value;
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    for (const key of Object.keys(storage)) delete storage[key];
  },
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SCIENCE_QUESTIONS = Array.from({ length: 12 }, (_, i) => ({
  id: `sci-${i}`,
  category: 'Science',
  difficulty: i < 4 ? 'Easy' : i < 8 ? 'Medium' : 'Hard',
  question: `Question sci-${i}?`,
  answer: `science-answer-${i}`,
  explanation: `Explanation for sci-${i}`,
  tags: [],
}));

const HISTORY_QUESTIONS = Array.from({ length: 12 }, (_, i) => ({
  id: `hist-${i}`,
  category: 'History',
  difficulty: i < 4 ? 'Easy' : i < 8 ? 'Medium' : 'Hard',
  question: `Question hist-${i}?`,
  answer: `history-answer-${i}`,
  explanation: `Explanation for hist-${i}`,
  tags: [],
}));

const ALL_TEST_QUESTIONS = [...SCIENCE_QUESTIONS, ...HISTORY_QUESTIONS];

function makeQuestion(overrides: Partial<Question> & { id: string }): Question {
  return {
    category: 'Science',
    difficulty: 'Easy',
    question: `Question ${overrides.id}?`,
    answer: `Answer ${overrides.id}`,
    explanation: `Explanation for ${overrides.id}`,
    tags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fetch mock — intercepts /api/questions (GET) and /api/questions/seen (POST)
// ---------------------------------------------------------------------------

function createFetchMock(options?: { questions?: Array<(typeof ALL_TEST_QUESTIONS)[number]> }) {
  const questionPool = options?.questions ?? ALL_TEST_QUESTIONS;

  return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // POST /api/questions/seen — fire-and-forget
    if (url.includes('/api/questions/seen')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }

    // GET /api/questions?shuffle=true&limit=...&category=...
    if (url.includes('/api/questions')) {
      const parsed = new URL(url, 'http://localhost');
      const category = parsed.searchParams.get('category');
      const limit = parsed.searchParams.get('limit');

      let questions = [...questionPool];
      if (category) {
        questions = questions.filter((q) => q.category === category);
      }
      // Shuffle (deterministic for tests: just reverse)
      questions = questions.reverse();
      if (limit) {
        questions = questions.slice(0, parseInt(limit, 10));
      }

      const categories = Array.from(new Set(questionPool.map((q) => q.category))).sort();

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ questions, categories }),
      } as Response);
    }

    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <GameProvider>{children}</GameProvider>;
}

/** Render the useGame hook inside a GameProvider and wait for questions to load via fetch. */
async function renderGame() {
  const hook = renderHook(() => useGame(), { wrapper });
  // Wait for the useEffect that loads questions from the mock API
  await waitFor(() => {
    expect(hook.result.current.state.questions.length).toBeGreaterThan(0);
  });
  return hook;
}

/** Add two teams and optionally set category/rounds, then start the game. */
async function setupAndStart(opts?: {
  category?: string;
  numRounds?: number;
  teamNames?: string[];
  isAuthenticated?: boolean;
}) {
  const hook = await renderGame();
  const { result } = hook;
  const teamNames = opts?.teamNames ?? ['Alpha', 'Bravo'];

  act(() => {
    teamNames.forEach((teamName) => result.current.addTeam(teamName));
  });

  if (opts?.category) {
    act(() => result.current.setCategory(opts.category!));
  }
  if (opts?.numRounds) {
    act(() => result.current.setNumRounds(opts.numRounds!));
  }

  // startGame is async (fetches from API)
  await act(async () => {
    await result.current.startGame(opts?.isAuthenticated ?? false);
  });

  return hook;
}

function fetchUrlOf(call: unknown[]): string {
  const input = call[0] as string | URL | Request;
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** Submit a typed answer and advance through REVEAL → SCORE_UPDATE for one question. */
function answerAndAdvance(result: { current: ReturnType<typeof useGame> }, answer: string) {
  act(() => result.current.setTypedAnswer(answer));
  act(() => result.current.submitAnswer());
  act(() => result.current.advanceToScoreUpdate());
}

/** Pass a question and advance through REVEAL → SCORE_UPDATE. */
function passAndAdvance(result: { current: ReturnType<typeof useGame> }) {
  act(() => result.current.passQuestion());
  act(() => result.current.advanceToScoreUpdate());
}

function getCorrectPoints(difficulty: Question['difficulty']) {
  return difficulty === 'Easy' ? 1 : difficulty === 'Medium' ? 2 : 3;
}

function submitIncorrectAnswer(result: { current: ReturnType<typeof useGame> }) {
  const question = result.current.state.questions[result.current.state.currentQuestionIndex];

  act(() => result.current.setTypedAnswer('zzzzzzzzzzzz'));
  act(() => result.current.submitAnswer());

  expect(result.current.state.currentAttempt?.verdict).toBe('INCORRECT');
  return question;
}

function finishGame(result: { current: ReturnType<typeof useGame> }) {
  let questionsAnswered = 0;
  let roundBreaks = 0;

  while (result.current.state.phase !== 'GAME_OVER') {
    if (result.current.state.phase === 'ROUND_SCORE') {
      roundBreaks++;
      act(() => result.current.continueToNextRound());
      continue;
    }

    expect(result.current.state.phase).toBe('QUESTION');
    passAndAdvance(result);
    questionsAnswered++;
  }

  return { questionsAnswered, roundBreaks };
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('normalize', () => {
  it('lowercases and trims', () => {
    expect(normalize('  Hello World  ')).toBe('hello world');
  });

  it('removes punctuation', () => {
    expect(normalize("It's a test!")).toBe('its test');
  });

  it('removes articles and trims result', () => {
    expect(normalize('the big apple')).toBe('big apple');
  });

  it('converts number words to digits', () => {
    expect(normalize('seven')).toBe('7');
  });
});

describe('verifyAttempt', () => {
  const easyQ = makeQuestion({ id: 'e1', difficulty: 'Easy', answer: 'Ottawa' });
  const medQ = makeQuestion({ id: 'm1', difficulty: 'Medium', answer: 'Photosynthesis' });
  const hardQ = makeQuestion({
    id: 'h1',
    difficulty: 'Hard',
    answer: 'Quantum Entanglement',
    acceptableAnswers: ['quantum entanglement', 'entanglement'],
  });

  it('returns CORRECT +1 for exact easy match', () => {
    const { verdict, points } = verifyAttempt('Ottawa', easyQ);
    expect(verdict).toBe('CORRECT');
    expect(points).toBe(1);
  });

  it('returns CORRECT +2 for exact medium match', () => {
    const { verdict, points } = verifyAttempt('Photosynthesis', medQ);
    expect(verdict).toBe('CORRECT');
    expect(points).toBe(2);
  });

  it('returns CORRECT +3 for hard match via acceptableAnswers', () => {
    const { verdict, points } = verifyAttempt('entanglement', hardQ);
    expect(verdict).toBe('CORRECT');
    expect(points).toBe(3);
  });

  it('returns INCORRECT with negative points for wrong answer', () => {
    const { verdict, points } = verifyAttempt('wrong', easyQ);
    expect(verdict).toBe('INCORRECT');
    expect(points).toBe(-1);
  });

  it('returns INCORRECT -2 for wrong medium answer', () => {
    const { verdict, points } = verifyAttempt('wrong', medQ);
    expect(verdict).toBe('INCORRECT');
    expect(points).toBe(-2);
  });

  it('returns INCORRECT -3 for wrong hard answer', () => {
    const { verdict, points } = verifyAttempt('wrong', hardQ);
    expect(verdict).toBe('INCORRECT');
    expect(points).toBe(-3);
  });

  it('is case-insensitive', () => {
    const { verdict } = verifyAttempt('ottawa', easyQ);
    expect(verdict).toBe('CORRECT');
  });
});

// ---------------------------------------------------------------------------
// State machine tests
// ---------------------------------------------------------------------------

describe('GameProvider state machine', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes in SETUP phase with no teams', async () => {
    const { result } = await renderGame();
    expect(result.current.state.phase).toBe('SETUP');
    expect(result.current.state.teams).toHaveLength(0);
  });

  it('loads categories from questions on mount', async () => {
    const { result } = await renderGame();
    expect(result.current.state.categories).toContain('All');
    expect(result.current.state.categories).toContain('Science');
    expect(result.current.state.categories).toContain('History');
  });

  it('can add and remove teams', async () => {
    const { result } = await renderGame();

    act(() => result.current.addTeam('Team A'));
    act(() => result.current.addTeam('Team B'));
    expect(result.current.state.teams).toHaveLength(2);
    expect(result.current.state.teams[0].name).toBe('Team A');

    const idToRemove = result.current.state.teams[0].id;
    act(() => result.current.removeTeam(idToRemove));
    expect(result.current.state.teams).toHaveLength(1);
    expect(result.current.state.teams[0].name).toBe('Team B');
  });

  // -------------------------------------------------------------------------
  // BUG #2 REGRESSION: startGame must go to QUESTION, not GAME_OVER
  // -------------------------------------------------------------------------

  it('startGame transitions from SETUP to QUESTION (not GAME_OVER)', async () => {
    const { result } = await setupAndStart();
    expect(result.current.state.phase).toBe('QUESTION');
  });

  it('startGame sets activeTeamId to first team', async () => {
    const { result } = await setupAndStart();
    expect(result.current.state.activeTeamId).toBe(result.current.state.teams[0].id);
  });

  it('startGame loads questions into state', async () => {
    const { result } = await setupAndStart();
    expect(result.current.state.questions.length).toBeGreaterThan(0);
  });

  it('startGame filters questions by selected category', async () => {
    const { result } = await setupAndStart({ category: 'Science' });
    const categories = new Set(result.current.state.questions.map((q) => q.category));
    expect(categories.size).toBe(1);
    expect(categories.has('Science')).toBe(true);
  });

  it('startGame with "All" includes questions from multiple categories', async () => {
    const { result } = await setupAndStart({ category: 'All' });
    const categories = new Set(result.current.state.questions.map((q) => q.category));
    expect(categories.size).toBeGreaterThan(1);
  });

  it('submitAnswer transitions from QUESTION to REVEAL', async () => {
    const { result } = await setupAndStart();

    act(() => result.current.setTypedAnswer('some answer'));
    act(() => result.current.submitAnswer());

    expect(result.current.state.phase).toBe('REVEAL');
    expect(result.current.state.currentAttempt).not.toBeNull();
  });

  it('passQuestion transitions from QUESTION to REVEAL with PASS verdict', async () => {
    const { result } = await setupAndStart();

    act(() => result.current.passQuestion());

    expect(result.current.state.phase).toBe('REVEAL');
    expect(result.current.state.currentAttempt?.verdict).toBe('PASS');
    expect(result.current.state.currentAttempt?.pointsDelta).toBe(0);
  });

  it('advanceToScoreUpdate updates team score and moves to next question', async () => {
    const { result } = await setupAndStart();
    const activeTeamId = result.current.state.activeTeamId;

    // Give correct answer for first question
    const correctAnswer = result.current.state.questions[0].answer;
    answerAndAdvance(result, correctAnswer);

    // Score should have changed for the active team
    const team = result.current.state.teams.find((t) => t.id === activeTeamId);
    expect(team!.score).not.toBe(0);
    expect(team!.questionCount).toBe(1);
    // Should be on the next question
    expect(result.current.state.currentQuestionIndex).toBe(1);
  });

  it('advanceToScoreUpdate is idempotent when triggered twice for the same reveal', async () => {
    const { result } = await setupAndStart();
    const activeTeamId = result.current.state.activeTeamId!;
    const correctAnswer = result.current.state.questions[0].answer;

    act(() => result.current.setTypedAnswer(correctAnswer));
    act(() => result.current.submitAnswer());

    act(() => {
      result.current.advanceToScoreUpdate();
      result.current.advanceToScoreUpdate();
    });

    const activeTeam = result.current.state.teams.find((team) => team.id === activeTeamId);
    expect(activeTeam?.questionCount).toBe(1);
    expect(result.current.state.currentQuestionIndex).toBe(1);
    expect(result.current.state.phase).toBe('QUESTION');
  });

  it('marks the current reveal attempt after a dispute is submitted', async () => {
    const { result } = await setupAndStart();

    submitIncorrectAnswer(result);
    expect(result.current.state.currentAttempt?.disputeSubmitted).toBeUndefined();

    act(() => result.current.markDisputeSubmitted());

    expect(result.current.state.currentAttempt?.disputeSubmitted).toBe(true);
  });

  it('awards disputed points immediately and flips the attempt to correct', async () => {
    const { result } = await setupAndStart();
    const activeTeamId = result.current.state.activeTeamId!;
    const startingScore = result.current.state.teams.find(
      (team) => team.id === activeTeamId
    )!.score;
    const question = submitIncorrectAnswer(result);
    const correctPoints = getCorrectPoints(question.difficulty);

    act(() => result.current.markDisputeSubmitted());
    act(() => result.current.awardDisputedPoints());

    const activeTeam = result.current.state.teams.find((team) => team.id === activeTeamId);
    expect(activeTeam?.score).toBe(startingScore + correctPoints);
    expect(activeTeam?.questionCount).toBe(0);
    expect(result.current.state.currentAttempt).toMatchObject({
      verdict: 'CORRECT',
      pointsDelta: correctPoints,
      processed: true,
      disputeSubmitted: true,
      pointsAwarded: true,
    });
  });

  it('advances an awarded attempt without applying points a second time', async () => {
    const { result } = await setupAndStart();
    const activeTeamId = result.current.state.activeTeamId!;

    submitIncorrectAnswer(result);
    act(() => result.current.markDisputeSubmitted());
    act(() => result.current.awardDisputedPoints());

    const scoreAfterAward = result.current.state.teams.find(
      (team) => team.id === activeTeamId
    )!.score;

    act(() => result.current.advanceToScoreUpdate());

    const activeTeam = result.current.state.teams.find((team) => team.id === activeTeamId);
    expect(activeTeam?.score).toBe(scoreAfterAward);
    expect(activeTeam?.questionCount).toBe(1);
    expect(result.current.state.currentQuestionIndex).toBe(1);
    expect(result.current.state.phase).toBe('QUESTION');
  });

  it('prevents re-awarding points for the same dispute attempt', async () => {
    const { result } = await setupAndStart();
    const activeTeamId = result.current.state.activeTeamId!;

    submitIncorrectAnswer(result);
    act(() => result.current.markDisputeSubmitted());
    act(() => result.current.awardDisputedPoints());

    const scoreAfterAward = result.current.state.teams.find(
      (team) => team.id === activeTeamId
    )!.score;

    act(() => result.current.awardDisputedPoints());

    expect(result.current.state.teams.find((team) => team.id === activeTeamId)?.score).toBe(
      scoreAfterAward
    );
  });

  it('does not award points for pass, correct, or undisputed incorrect attempts', async () => {
    const passHook = await setupAndStart();
    act(() => passHook.result.current.passQuestion());
    act(() => passHook.result.current.markDisputeSubmitted());
    act(() => passHook.result.current.awardDisputedPoints());
    expect(passHook.result.current.state.teams[0].score).toBe(0);
    expect(passHook.result.current.state.currentAttempt?.verdict).toBe('PASS');
    passHook.unmount();

    const correctHook = await setupAndStart();
    const correctAnswer = correctHook.result.current.state.questions[0].answer;
    act(() => correctHook.result.current.setTypedAnswer(correctAnswer));
    act(() => correctHook.result.current.submitAnswer());
    act(() => correctHook.result.current.markDisputeSubmitted());
    act(() => correctHook.result.current.awardDisputedPoints());
    expect(correctHook.result.current.state.teams[0].score).toBe(0);
    expect(correctHook.result.current.state.currentAttempt?.verdict).toBe('CORRECT');
    correctHook.unmount();

    const undisputedHook = await setupAndStart();
    submitIncorrectAnswer(undisputedHook.result);
    act(() => undisputedHook.result.current.awardDisputedPoints());
    expect(undisputedHook.result.current.state.teams[0].score).toBe(0);
    expect(undisputedHook.result.current.state.currentAttempt?.verdict).toBe('INCORRECT');
  });

  it('rotates active team after QUESTIONS_PER_TEAM_ROTATION (4) questions', async () => {
    const { result } = await setupAndStart();

    const firstTeamId = result.current.state.activeTeamId;

    // Answer 4 questions
    for (let i = 0; i < 4; i++) {
      passAndAdvance(result);
    }

    // Active team should have rotated to Team B
    expect(result.current.state.activeTeamId).not.toBe(firstTeamId);
    expect(result.current.state.activeTeamId).toBe(result.current.state.teams[1].id);
  });

  it('triggers ROUND_SCORE after a full round (teams * 4 questions)', async () => {
    // With 2 teams, a round = 2 * 4 = 8 questions
    const { result } = await setupAndStart();

    for (let i = 0; i < 8; i++) {
      passAndAdvance(result);
    }

    expect(result.current.state.phase).toBe('ROUND_SCORE');
  });

  it('continueToNextRound moves from ROUND_SCORE back to QUESTION', async () => {
    const { result } = await setupAndStart();

    // Complete one round (8 questions)
    for (let i = 0; i < 8; i++) {
      passAndAdvance(result);
    }
    expect(result.current.state.phase).toBe('ROUND_SCORE');

    act(() => result.current.continueToNextRound());
    expect(result.current.state.phase).toBe('QUESTION');
  });

  it('reaches GAME_OVER when all questions are exhausted', async () => {
    // Use small numRounds so we have few questions to exhaust
    // numRounds * teams * QUESTIONS_PER_TEAM_ROTATION = total questions; with numRounds=1 and 2 teams → 1*2*4=8 questions
    const { result } = await setupAndStart({ numRounds: 1 });
    const totalQuestions = result.current.state.questions.length;

    for (let i = 0; i < totalQuestions; i++) {
      // If we hit ROUND_SCORE, continue past it
      if (result.current.state.phase === 'ROUND_SCORE') {
        act(() => result.current.continueToNextRound());
      }
      passAndAdvance(result);
    }

    expect(result.current.state.phase).toBe('GAME_OVER');
  });

  it('endGame forces GAME_OVER from any phase', async () => {
    const { result } = await setupAndStart();
    expect(result.current.state.phase).toBe('QUESTION');

    act(() => result.current.endGame());
    expect(result.current.state.phase).toBe('GAME_OVER');
  });

  it('resetGame returns to clean SETUP state', async () => {
    const { result } = await setupAndStart();
    // Play a bit
    passAndAdvance(result);

    act(() => result.current.resetGame());

    expect(result.current.state.phase).toBe('SETUP');
    expect(result.current.state.teams).toHaveLength(0);
    expect(result.current.state.currentQuestionIndex).toBe(0);
    expect(result.current.state.activeTeamId).toBeNull();
    expect(result.current.state.selectedCategory).toBe('All');
    expect(result.current.state.numRounds).toBe(10);
  });

  it.each([
    { label: '2 teams and 5 questions each', teamNames: ['Alpha', 'Bravo'], numRounds: 5 },
    {
      label: '3 teams and 4 questions each',
      teamNames: ['Alpha', 'Bravo', 'Charlie'],
      numRounds: 4,
    },
    {
      label: '4 teams and 3 questions each',
      teamNames: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
      numRounds: 3,
    },
  ])('consumes every fetched question before GAME_OVER for $label', async (scenario) => {
    const { result } = await setupAndStart({
      numRounds: scenario.numRounds,
      teamNames: scenario.teamNames,
    });
    const totalQuestions = result.current.state.questions.length;
    const questionsPerRound = scenario.teamNames.length * 4;

    const { questionsAnswered, roundBreaks } = finishGame(result);

    expect(questionsAnswered).toBe(totalQuestions);
    expect(result.current.state.currentQuestionIndex).toBe(totalQuestions);
    expect(roundBreaks).toBe(Math.floor((totalQuestions - 1) / questionsPerRound));
  });

  it('uses every fetched question before GAME_OVER even when inventory is smaller than requested', async () => {
    const limitedQuestions = ALL_TEST_QUESTIONS.slice(0, 6);
    vi.stubGlobal('fetch', createFetchMock({ questions: limitedQuestions }));

    const { result } = await setupAndStart({ numRounds: 5 });
    expect(result.current.state.questions).toHaveLength(limitedQuestions.length);

    const { questionsAnswered, roundBreaks } = finishGame(result);

    expect(questionsAnswered).toBe(limitedQuestions.length);
    expect(result.current.state.currentQuestionIndex).toBe(limitedQuestions.length);
    expect(roundBreaks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Full happy-path integration test
// ---------------------------------------------------------------------------

describe('Full game happy path', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plays a complete game: SETUP → questions → ROUND_SCORE → GAME_OVER with scores', async () => {
    // Setup: 2 teams, 2 rounds → 2*2*4=16 total questions → ROUND_SCORE at 8, GAME_OVER at 16
    const { result } = await setupAndStart({ numRounds: 2 });
    const totalQuestions = result.current.state.questions.length;
    expect(totalQuestions).toBe(16); // 2 rounds * 2 teams * 4 questions/turn

    let questionsAnswered = 0;
    while (result.current.state.phase !== 'GAME_OVER') {
      if (result.current.state.phase === 'ROUND_SCORE') {
        act(() => result.current.continueToNextRound());
        continue;
      }

      expect(result.current.state.phase).toBe('QUESTION');

      // Alternate between correct and pass
      if (questionsAnswered % 2 === 0) {
        const correctAnswer =
          result.current.state.questions[result.current.state.currentQuestionIndex].answer;
        answerAndAdvance(result, correctAnswer);
      } else {
        passAndAdvance(result);
      }
      questionsAnswered++;
    }

    expect(result.current.state.phase).toBe('GAME_OVER');
    expect(questionsAnswered).toBe(totalQuestions);

    // At least one team should have a non-zero score (some were correct)
    const totalScore = result.current.state.teams.reduce((sum, t) => sum + Math.abs(t.score), 0);
    expect(totalScore).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// STE-235: guest (non-signed-in) cross-game question repeats
// ---------------------------------------------------------------------------

describe('Guest question exclusion (STE-235)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes locally-seen question ids for a guest game', async () => {
    // Mark the first 4 Science questions as already seen; 8 remain unseen.
    const seenIds = SCIENCE_QUESTIONS.slice(0, 4).map((q) => q.id);
    addGuestSeenIds(seenIds);

    // numRounds=1, 2 teams -> totalNeeded = 1*2*4 = 8, exactly the unseen supply.
    const { result } = await setupAndStart({ category: 'Science', numRounds: 1 });

    const ids = result.current.state.questions.map((q) => q.id);
    expect(ids).toHaveLength(8);
    seenIds.forEach((id) => expect(ids).not.toContain(id));
  });

  it('backfills with the oldest-seen questions when the unseen pool runs short', async () => {
    // Mark 10 of the 12 Science questions as seen (oldest-first: sci-0 .. sci-9);
    // only sci-10 and sci-11 remain unseen, but 8 are needed.
    const seenIds = SCIENCE_QUESTIONS.slice(0, 10).map((q) => q.id);
    addGuestSeenIds(seenIds);

    const { result } = await setupAndStart({ category: 'Science', numRounds: 1 });

    // Starting the game must never fail due to the exclusion list.
    expect(result.current.state.phase).toBe('QUESTION');
    const ids = result.current.state.questions.map((q) => q.id);
    expect(ids).toHaveLength(8);
    expect(ids).toContain('sci-10');
    expect(ids).toContain('sci-11');
    // Deficit of 6 is backfilled with the 6 oldest-seen ids (sci-0 .. sci-5).
    ['sci-0', 'sci-1', 'sci-2', 'sci-3', 'sci-4', 'sci-5'].forEach((id) =>
      expect(ids).toContain(id)
    );
  });

  it('does not perform an extra network fetch when the question catalog is already loaded', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const hook = await renderGame(); // triggers exactly one catalog fetch on mount
    const callsBeforeStart = fetchMock.mock.calls.length;

    act(() => {
      hook.result.current.addTeam('Alpha');
      hook.result.current.addTeam('Bravo');
    });
    await act(async () => {
      await hook.result.current.startGame(false);
    });

    const questionFetchesDuringStart = fetchMock.mock.calls
      .slice(callsBeforeStart)
      .filter((call) => fetchUrlOf(call).includes('/api/questions'));

    // The catalog was already loaded, so guest selection must not fetch
    // totalNeeded+N rows from the server merely to filter them client-side.
    expect(questionFetchesDuringStart).toHaveLength(0);
  });

  it('records only questions actually shown when a guest game is abandoned before GAME_OVER', async () => {
    // numRounds=1, 2 teams -> 8 questions selected, but the game is abandoned after 3 are shown.
    const { result, unmount } = await setupAndStart({ numRounds: 1 });
    const allIds = result.current.state.questions.map((q) => q.id);

    passAndAdvance(result); // question 0 answered, question 1 now shown
    passAndAdvance(result); // question 1 answered, question 2 now shown

    const shownIds = allIds.slice(0, 3);
    const unshownIds = allIds.slice(3);

    await waitFor(() => {
      expect(getGuestSeenIds()).toEqual(expect.arrayContaining(shownIds));
    });
    unshownIds.forEach((id) => expect(getGuestSeenIds()).not.toContain(id));

    unmount();
  });

  it('writes played question ids to local storage and skips the seen-questions POST for guests', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = await setupAndStart({ numRounds: 1 });
    const playedIds = result.current.state.questions.map((q) => q.id);

    finishGame(result);
    expect(result.current.state.phase).toBe('GAME_OVER');

    await waitFor(() => {
      expect(getGuestSeenIds()).toEqual(expect.arrayContaining(playedIds));
    });

    const calledSeenPost = fetchMock.mock.calls.some((call) =>
      fetchUrlOf(call).includes('/api/questions/seen')
    );
    expect(calledSeenPost).toBe(false);
  });

  it('leaves the authenticated path unchanged: server-side exclusion and seen-questions POST', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = await setupAndStart({ numRounds: 1, isAuthenticated: true });

    const startCall = fetchMock.mock.calls.find((call) => {
      const url = fetchUrlOf(call);
      return url.includes('/api/questions?') && !url.includes('/api/questions/seen');
    });
    expect(startCall).toBeDefined();
    expect(fetchUrlOf(startCall!)).toContain('excludeSeen=true');

    finishGame(result);
    expect(result.current.state.phase).toBe('GAME_OVER');

    await waitFor(() => {
      const calledSeenPost = fetchMock.mock.calls.some((call) =>
        fetchUrlOf(call).includes('/api/questions/seen')
      );
      expect(calledSeenPost).toBe(true);
    });
  });
});

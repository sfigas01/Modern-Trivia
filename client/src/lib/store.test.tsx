import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameProvider, useGame, normalize, verifyAttempt } from './store';
import type { Question } from './store';

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
    await result.current.startGame();
  });

  return hook;
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
    // numRounds * teams = total questions; with numRounds=4 and 2 teams → 8 questions
    const { result } = await setupAndStart({ numRounds: 4 });
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
    // Setup: 2 teams, 4 rounds → 8 total questions → exactly 1 round boundary at 8
    const { result } = await setupAndStart({ numRounds: 4 });
    const totalQuestions = result.current.state.questions.length;
    expect(totalQuestions).toBe(8); // 4 rounds * 2 teams

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

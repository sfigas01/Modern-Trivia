import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ----------------------------------------------------------------

// Chainable query mock: every builder method returns the same object, which is
// awaitable and resolves to the next queued result. insert().returning() also
// resolves to a queued result. Hoisted so the vi.mock factory can reference it.
const h = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const insertReturningQueue: unknown[][] = [];
  const insertedValues: unknown[] = [];

  function makeChain(getResult: () => unknown[]) {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of ['from', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
      chain[m] = vi.fn(passthrough);
    }
    chain.values = vi.fn((v: unknown) => {
      insertedValues.push(v);
      return chain;
    });
    chain.returning = vi.fn(() => Promise.resolve(insertReturningQueue.shift() ?? []));
    const promise = Promise.resolve().then(() => getResult());
    chain.then = promise.then.bind(promise);
    return chain;
  }

  const dbMock = {
    select: vi.fn(() => makeChain(() => selectQueue.shift() ?? [])),
    insert: vi.fn(() => makeChain(() => [])),
    update: vi.fn(() => makeChain(() => [])),
    transaction: vi.fn(),
  };

  return { selectQueue, insertReturningQueue, insertedValues, dbMock };
});

const { selectQueue, insertReturningQueue, insertedValues } = h;

vi.mock('../db', () => ({ db: h.dbMock }));

const guardianMock = vi.hoisted(() => ({
  generateQuestions: vi.fn(),
  isEligibleForAutomaticApproval: vi.fn(
    (question: {
      aiAnalysis: {
        factCheck: {
          verdict: string;
          coherence?: string;
          obviousness?: string;
          confidence?: number;
        };
        qaFindings: Array<{ severity: string }>;
      };
    }) =>
      question.aiAnalysis.factCheck.verdict === 'pass' &&
      (question.aiAnalysis.factCheck.coherence ?? 'pass') === 'pass' &&
      (question.aiAnalysis.factCheck.obviousness ?? 'pass') === 'pass' &&
      (question.aiAnalysis.factCheck.confidence ?? 100) >= 80 &&
      !question.aiAnalysis.qaFindings.some(
        (finding) => finding.severity === 'high' || finding.severity === 'medium'
      )
  ),
}));
vi.mock('./guardian', () => guardianMock);

const noveltyMock = vi.hoisted(() => {
  class SemanticCheckIncompleteError extends Error {
    constructor(
      public readonly category = 'unknown',
      public readonly failedPairs = 0
    ) {
      super('Semantic checking could not finish. No questions were staged. Please retry.');
      this.name = 'SemanticCheckIncompleteError';
    }
  }
  return { filterNovelQuestions: vi.fn(), SemanticCheckIncompleteError };
});
vi.mock('./novelty-filter', () => noveltyMock);

vi.mock('./topic-context', () => ({ selectTopicContext: vi.fn(() => []) }));

const openAiCreate = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openAiCreate } };
  },
}));

import {
  normalizeThemeSlug,
  themeTag,
  fallbackThemeCategories,
  suggestThemeCategories,
  themedQuestionLimit,
  computeRoomSeenInputs,
  initThemeProgress,
  updateThemeProgress,
  getThemeProgress,
  clearThemeProgress,
  prepareThemedQuestions,
  runThemedGamePreparation,
  THEME_MAX_GENERATED_CANDIDATES,
  THEME_PROGRESS_TTL_MS,
} from './theme-game';
import { generateQuestions } from './guardian';
import { filterNovelQuestions, SemanticCheckIncompleteError } from './novelty-filter';
import type { Room, RoomPlayer } from '@shared/schema';

function player(overrides: Partial<RoomPlayer>): RoomPlayer {
  return {
    id: overrides.id ?? 'p1',
    roomId: 'room1',
    nickname: overrides.nickname ?? 'Nick',
    token: 'tok',
    joinOrder: overrides.joinOrder ?? 0,
    score: 0,
    questionCount: 0,
    lastRoundDelta: 0,
    isHost: overrides.isHost ?? false,
    userId: overrides.userId ?? null,
    guestSeenIds: overrides.guestSeenIds ?? null,
    lastSeenAt: new Date(),
    leftAt: null,
  } as RoomPlayer;
}

function generatedQuestion(id: string) {
  return {
    id,
    category: 'Sports',
    difficulty: 'Medium',
    question: `Generated ${id}?`,
    answer: `A${id}`,
    acceptableAnswers: [],
    explanation: 'Because.',
    pillar: 'GlobalEh',
    tags: ['Sports', 'CA'],
    sourceUrl: 'https://example.com',
    sourceName: 'Example',
    status: 'pending',
    aiAnalysis: { qaFindings: [], factCheck: { verdict: 'pass' } },
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  insertReturningQueue.length = 0;
  insertedValues.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  clearThemeProgress('ABCDE');
});

describe('normalizeThemeSlug / themeTag', () => {
  it('slugifies free text into a stable lowercase key', () => {
    expect(normalizeThemeSlug('Baseball')).toBe('baseball');
    expect(normalizeThemeSlug('  Organic   Chemistry!! ')).toBe('organic-chemistry');
    expect(normalizeThemeSlug('Café Culture')).toBe('cafe-culture');
  });

  it('prefixes the slug with theme:', () => {
    expect(themeTag('Baseball')).toBe('theme:baseball');
    expect(themeTag('Organic Chemistry')).toBe('theme:organic-chemistry');
  });

  it('gives distinct non-empty keys to themes with no ASCII characters', () => {
    // Previously these both collapsed to the shared key `theme:`, cross-tagging
    // unrelated themes in the shared library.
    const a = normalizeThemeSlug('日本史');
    const b = normalizeThemeSlug('中文');
    expect(a).not.toBe('');
    expect(a).not.toBe(b);
    expect(themeTag('日本史')).not.toBe('theme:');
  });
});

describe('fallbackThemeCategories', () => {
  it('maps recognizable keywords to canonical categories', () => {
    expect(fallbackThemeCategories('baseball')).toContain('Sports');
    expect(fallbackThemeCategories('organic chemistry')).toContain('Science & Nature');
    expect(fallbackThemeCategories('the show Friends')).toContain('Entertainment & Pop Culture');
  });

  it('always returns at least one category for an unknown theme', () => {
    const result = fallbackThemeCategories('zzzxyq');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe('suggestThemeCategories', () => {
  it('returns canonical categories from the model response', async () => {
    openAiCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify({ categories: ['Sports', 'not-a-category'] }) } },
      ],
    });
    const result = await suggestThemeCategories('baseball');
    expect(result).toEqual(['Sports']);
  });

  it('falls back to the keyword heuristic when the model call fails', async () => {
    openAiCreate.mockRejectedValueOnce(new Error('boom'));
    const result = await suggestThemeCategories('baseball');
    expect(result).toContain('Sports');
  });
});

describe('themedQuestionLimit', () => {
  it('is numRounds × teams × 4', () => {
    expect(themedQuestionLimit(5, 2)).toBe(40);
    expect(themedQuestionLimit(5, 3)).toBe(60);
    expect(themedQuestionLimit(10, 2)).toBe(80);
  });
});

describe('computeRoomSeenInputs (reuses STE-273 logic)', () => {
  it('unions signed-in user ids and guest seen ids', () => {
    const players = [
      player({ id: 'p1', isHost: true, userId: 'u1' }),
      player({ id: 'p2', userId: null, guestSeenIds: ['q1', 'q2'] }),
    ];
    const { roomUserIds, guestSeenUnion } = computeRoomSeenInputs(players, ['q3'], false);
    expect(roomUserIds).toEqual(['u1']);
    // host is authenticated (hostIsGuest=false) → excludeQuestionIds ignored
    expect(guestSeenUnion.sort()).toEqual(['q1', 'q2']);
  });

  it('trusts the host exclusion list only for a guest host', () => {
    const players = [player({ id: 'p1', isHost: true, userId: null })];
    const { guestSeenUnion } = computeRoomSeenInputs(players, ['q3'], true);
    expect(guestSeenUnion).toContain('q3');
  });
});

describe('theme progress store', () => {
  it('initializes, updates, reads and clears progress', () => {
    initThemeProgress('ABCDE', 40);
    expect(getThemeProgress('ABCDE')).toMatchObject({ status: 'preparing', ready: 0, total: 40 });
    updateThemeProgress('ABCDE', { ready: 10, reused: 4 });
    expect(getThemeProgress('ABCDE')).toMatchObject({ ready: 10, reused: 4, total: 40 });
    clearThemeProgress('ABCDE');
    expect(getThemeProgress('ABCDE')).toBeUndefined();
  });

  it('expires entries after the retention window so the map cannot grow unbounded', async () => {
    vi.useFakeTimers();
    try {
      initThemeProgress('ABCDE', 40);
      expect(getThemeProgress('ABCDE')).toBeDefined();
      vi.advanceTimersByTime(THEME_PROGRESS_TTL_MS + 1000);
      // A read past the TTL prunes and reports the entry as gone.
      expect(getThemeProgress('ABCDE')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('prepareThemedQuestions', () => {
  it('reuses themed questions first, then generates the remainder as approved player_ai rows', async () => {
    // total = 5 rounds × 2 players × 4 = 40. Reuse returns 36 → generate 4.
    const reusedIds = Array.from({ length: 36 }, (_, i) => ({ id: `reuse${i}`, tier: 0 }));
    selectQueue.push(reusedIds); // step 1: reuse
    selectQueue.push([]); // step 2: existing pool (empty)

    const generated = [
      generatedQuestion('g1'),
      generatedQuestion('g2'),
      generatedQuestion('g3'),
      generatedQuestion('g4'),
    ];
    vi.mocked(generateQuestions).mockResolvedValueOnce(generated as never);
    vi.mocked(filterNovelQuestions).mockResolvedValueOnce({
      kept: generated as never,
      dropped: [],
    });
    insertReturningQueue.push(
      generated.map((g) => ({ id: g.id, question: g.question, answer: g.answer, pillar: g.pillar }))
    );

    const result = await prepareThemedQuestions({
      theme: 'Baseball',
      categories: ['Sports'],
      numRounds: 5,
      playerCount: 2,
      seen: { roomUserIds: [], guestSeenUnion: [] },
    });

    expect(result.questionIds).toHaveLength(40);
    expect(result.reused).toBe(36);
    expect(result.generated).toBe(4);
    // Generated (bespoke, never-seen) ordered first for the theme lean.
    expect(result.questionIds.slice(0, 4)).toEqual(['g1', 'g2', 'g3', 'g4']);

    // Persisted as approved + player_ai + theme tag.
    const inserted = insertedValues[0] as Array<{
      status: string;
      origin: string;
      tags: string[];
      aiAnalysis: { automaticApprovalPolicy?: string };
    }>;
    expect(inserted).toHaveLength(4);
    for (const row of inserted) {
      expect(row.status).toBe('approved');
      expect(row.origin).toBe('player_ai');
      expect(row.tags).toContain('theme:baseball');
      expect(row.aiAnalysis.automaticApprovalPolicy).toBe('themed-strict-v1');
    }
  });

  it('does not exceed the per-game candidate ceiling', async () => {
    // No reuse, empty pool → wants to generate the full 40, but each batch
    // returns nothing kept, so it keeps requesting until the ceiling is hit.
    selectQueue.push([]); // reuse
    selectQueue.push([]); // existing pool
    // Every fill query returns nothing either.
    for (let i = 0; i < 50; i++) selectQueue.push([]);

    vi.mocked(generateQuestions).mockResolvedValue([] as never);
    vi.mocked(filterNovelQuestions).mockResolvedValue({ kept: [], dropped: [] });

    await prepareThemedQuestions({
      theme: 'Baseball',
      categories: ['Sports'],
      numRounds: 5,
      playerCount: 2,
      seen: { roomUserIds: [], guestSeenUnion: [] },
    });

    const requested = vi
      .mocked(generateQuestions)
      .mock.calls.reduce((sum, call) => sum + (call[1] as number), 0);
    expect(requested).toBeLessThanOrEqual(THEME_MAX_GENERATED_CANDIDATES);
  });

  it('does not approve flagged Guardian candidates or hide the shortfall with category fill', async () => {
    selectQueue.push([]); // safe themed reuse
    selectQueue.push([]); // existing novelty pool

    const flagged = generatedQuestion('needs-review');
    flagged.aiAnalysis.factCheck.verdict = 'flag';
    vi.mocked(generateQuestions)
      .mockResolvedValueOnce([flagged] as never)
      .mockResolvedValue([] as never);
    vi.mocked(filterNovelQuestions)
      .mockResolvedValueOnce({ kept: [flagged] as never, dropped: [] })
      .mockResolvedValue({ kept: [], dropped: [] });

    const result = await prepareThemedQuestions({
      theme: 'Baseball',
      categories: ['Sports'],
      numRounds: 5,
      playerCount: 2,
      seen: { roomUserIds: [], guestSeenUnion: [] },
    });

    expect(result).toEqual({ questionIds: [], reused: 0, generated: 0 });
    expect(h.dbMock.insert).not.toHaveBeenCalled();
    // Reuse + novelty pool only: generic category inventory is never queried
    // as a misleading themed fallback.
    expect(h.dbMock.select).toHaveBeenCalledTimes(2);
  });

  it('does not auto-approve candidates with unresolved medium QA findings', async () => {
    selectQueue.push([]); // safe themed reuse
    selectQueue.push([]); // existing novelty pool

    const unresolved = generatedQuestion('medium-finding');
    unresolved.aiAnalysis.qaFindings = [
      {
        questionId: unresolved.id,
        questionIndex: 0,
        severity: 'medium',
        rule: 'subjective_prompt',
        message: 'Question may have multiple valid answers.',
      },
    ];
    vi.mocked(generateQuestions)
      .mockResolvedValueOnce([unresolved] as never)
      .mockResolvedValue([] as never);
    vi.mocked(filterNovelQuestions)
      .mockResolvedValueOnce({ kept: [unresolved] as never, dropped: [] })
      .mockResolvedValue({ kept: [], dropped: [] });

    const result = await prepareThemedQuestions({
      theme: 'Baseball',
      categories: ['Sports'],
      numRounds: 5,
      playerCount: 2,
      seen: { roomUserIds: [], guestSeenUnion: [] },
    });

    expect(result.generated).toBe(0);
    expect(h.dbMock.insert).not.toHaveBeenCalled();
  });

  it('does not auto-approve a generated question outside the selected categories', async () => {
    selectQueue.push([]); // safe themed reuse
    selectQueue.push([]); // existing novelty pool

    const wrongCategory = {
      ...generatedQuestion('wrong-category'),
      category: 'Entertainment & Pop Culture',
    };
    vi.mocked(generateQuestions)
      .mockResolvedValueOnce([wrongCategory] as never)
      .mockResolvedValue([] as never);
    vi.mocked(filterNovelQuestions)
      .mockResolvedValueOnce({ kept: [wrongCategory] as never, dropped: [] })
      .mockResolvedValue({ kept: [], dropped: [] });

    const result = await prepareThemedQuestions({
      theme: 'Baseball',
      categories: ['Sports'],
      numRounds: 5,
      playerCount: 2,
      seen: { roomUserIds: [], guestSeenUnion: [] },
    });

    expect(result.generated).toBe(0);
    expect(h.dbMock.insert).not.toHaveBeenCalled();
  });

  it('aborts after one incomplete semantic batch without fallback or approval', async () => {
    selectQueue.push([]); // reuse
    selectQueue.push([]); // existing novelty pool
    const generated = [generatedQuestion('unchecked')];
    vi.mocked(generateQuestions).mockResolvedValue(generated as never);
    vi.mocked(filterNovelQuestions).mockRejectedValue(
      new SemanticCheckIncompleteError('configuration', 338)
    );
    initThemeProgress('ABCDE', 40);

    await runThemedGamePreparation({
      room: {
        id: 'room1',
        code: 'ABCDE',
        numRounds: 5,
        status: 'lobby',
        phase: 'LOBBY',
      } as Room,
      players: [player({ id: 'p1', isHost: true }), player({ id: 'p2' })],
      categories: ['Sports'],
      theme: 'Baseball',
      hostPlayerId: 'p1',
      seen: { roomUserIds: [], guestSeenUnion: [] },
    });

    expect(generateQuestions).toHaveBeenCalledTimes(1);
    expect(filterNovelQuestions).toHaveBeenCalledTimes(1);
    expect(h.dbMock.select).toHaveBeenCalledTimes(2);
    expect(h.dbMock.insert).not.toHaveBeenCalled();
    expect(h.dbMock.transaction).not.toHaveBeenCalled();
    expect(getThemeProgress('ABCDE')).toMatchObject({
      status: 'error',
      ready: 0,
      generated: 0,
      error: expect.stringContaining('embeddings-capable provider'),
    });
  });
});

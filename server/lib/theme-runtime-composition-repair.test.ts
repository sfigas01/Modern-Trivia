import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  evidenceContexts: [] as ReturnType<typeof vi.fn>[],
  repairDependencies: null as Record<string, unknown> | null,
  loadCorpus: vi.fn(async () => ({ revision: 'corpus-1', questions: [] })),
}));

vi.mock('./theme-fact-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme-fact-review')>()),
  createPostgresThemeFactReviewRepository: vi.fn(() => ({ review: vi.fn() })),
}));

vi.mock('./theme-question-generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme-question-generation')>()),
  createPostgresThemeQuestionGenerationRepository: vi.fn(() => ({ generate: vi.fn() })),
}));

vi.mock('./theme-question-evidence-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme-question-evidence-review')>()),
  createPostgresThemeQuestionEvidenceReviewRepository: vi.fn(() => {
    const qaContext = vi.fn(async () => ({ candidateId: 'child' }));
    mocks.evidenceContexts.push(qaContext);
    return { review: vi.fn(), qaContext };
  }),
}));

vi.mock('./theme-question-approval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme-question-approval')>()),
  createPostgresThemeQuestionApprovalRepository: vi.fn(() => ({ approve: vi.fn() })),
  loadThemeQuestionQaCorpus: mocks.loadCorpus,
}));

vi.mock('./theme-question-repair', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme-question-repair')>()),
  createPostgresThemeQuestionRepairOrchestrator: vi.fn(
    (_pool: Pool, dependencies: Record<string, unknown>) => {
      mocks.repairDependencies = dependencies;
      return { repair: vi.fn() };
    }
  ),
}));

import { createPostgresThemeSourceFirstRepositories } from './theme-runtime-composition';

beforeEach(() => {
  mocks.evidenceContexts.length = 0;
  mocks.repairDependencies = null;
  mocks.loadCorpus.mockClear();
});

describe('source-first repair QA composition', () => {
  it('loads repaired evidence context and the complete bounded corpus from PostgreSQL', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    createPostgresThemeSourceFirstRepositories(pool, {
      factReview: {} as never,
      questionGeneration: {} as never,
      evidenceReview: {} as never,
      approval: { evidence: {} } as never,
      repairQa: {
        checkQuality: vi.fn(),
        detectDuplicates: vi.fn(),
      },
    });
    const dependencies = mocks.repairDependencies as {
      qa: {
        loadContext(request: unknown): Promise<unknown>;
        loadCorpus(): Promise<unknown>;
      };
    };
    const request = { candidateId: 'child' };

    await expect(dependencies.qa.loadContext(request)).resolves.toEqual({ candidateId: 'child' });
    await expect(dependencies.qa.loadCorpus()).resolves.toEqual({
      revision: 'corpus-1',
      questions: [],
    });
    expect(mocks.evidenceContexts).toHaveLength(2);
    expect(mocks.evidenceContexts[1]).toHaveBeenCalledWith(request);
    expect(mocks.loadCorpus).toHaveBeenCalledWith(pool);
  });
});

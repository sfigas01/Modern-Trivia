import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Question } from '@/lib/store';
import type { QualitySweepReport } from '@shared/models/quality-sweep';
import AdminQualitySweep from './admin-quality-sweep';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  deleteQuestion: vi.fn(),
  toast: vi.fn(),
  updateQuestion: vi.fn(),
}));

vi.mock('wouter', () => ({ useLocation: () => ['/admin/quality-sweep', vi.fn()] }));
vi.mock('@/components/admin-layout', () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { email: 'admin@example.com' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));
vi.mock('@/hooks/use-admin', () => ({
  useAdmin: () => ({ isAdmin: true, isLoading: false }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.apiRequest }));

const question: Question = {
  id: 'q-1',
  category: 'Culture',
  difficulty: 'Easy',
  question: 'Which city hosts the festival?',
  answer: 'Toronto',
  acceptableAnswers: ['Toronto, Ontario'],
  explanation: 'The festival is held in Toronto.',
  pillar: 'GlobalEh',
  tags: ['CA', 'Culture', 'GlobalEh'],
  sourceUrl: 'https://example.com/festival',
  sourceName: 'Festival source',
};

vi.mock('@/lib/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/store')>();
  return {
    ...actual,
    useGame: () => ({
      state: { questions: [question] },
      updateQuestion: mocks.updateQuestion,
      deleteQuestion: mocks.deleteQuestion,
    }),
  };
});

function makeReport(): QualitySweepReport {
  return {
    generatedAt: '2026-07-16T12:00:00.000Z',
    totalQuestions: 1,
    audit: {
      generatedAt: '2026-07-16T12:00:00.000Z',
      totalQuestions: 1,
      totalFindings: 1,
      flaggedQuestionCount: 1,
      findingsBySeverity: { high: 0, medium: 1, low: 0 },
      findingsByRule: {
        subjective_prompt: 1,
      } as QualitySweepReport['audit']['findingsByRule'],
      findings: [
        {
          questionId: question.id,
          questionIndex: 0,
          severity: 'medium',
          rule: 'subjective_prompt',
          message: 'Rewrite the subjective wording.',
          proposedFix: { proposedQuestion: 'Which city is the festival held in?' },
        },
      ],
    },
    duplicates: null,
    factCheck: null,
    recommendations: [],
    questionsById: {
      [question.id]: {
        question: question.question,
        answer: question.answer,
        tags: question.tags,
        category: question.category,
        pillar: question.pillar,
        hasSource: true,
        difficulty: question.difficulty,
        sourceDomain: 'example.com',
      },
    },
  };
}

function createFetchMock(report: QualitySweepReport) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/questions' && !init?.method) {
      return Promise.resolve(
        new Response(JSON.stringify({ questions: [question], categories: [question.category] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    if (url === '/api/admin/quality-sweep' && init?.method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify(report), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

async function renderReport() {
  render(<AdminQualitySweep />);
  fireEvent.click(screen.getByRole('button', { name: 'Run Quality Sweep' }));
  await screen.findByText('Rewrite the subjective wording.');
}

describe('AdminQualitySweep question persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiRequest.mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', createFetchMock(makeReport()));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('persists manual edits through an explicit patch', async () => {
    const persisted = {
      ...question,
      question: 'Which Canadian city hosts the festival?',
      answer: 'Toronto, Ontario',
      explanation: 'The server saved this canonical explanation.',
    };
    mocks.updateQuestion.mockResolvedValue(persisted);
    await renderReport();

    fireEvent.click(screen.getByTestId(`button-edit-${question.id}`));
    fireEvent.change(screen.getByTestId(`edit-question-${question.id}`), {
      target: { value: '  Which Canadian city hosts the festival?  ' },
    });
    fireEvent.change(screen.getByTestId(`edit-answer-${question.id}`), {
      target: { value: '  Toronto, Ontario  ' },
    });
    fireEvent.change(screen.getByTestId(`edit-explanation-${question.id}`), {
      target: { value: '  Updated explanation.  ' },
    });
    fireEvent.click(screen.getByTestId(`save-${question.id}`));

    await waitFor(() =>
      expect(mocks.updateQuestion).toHaveBeenCalledWith(question.id, {
        question: 'Which Canadian city hosts the festival?',
        answer: 'Toronto, Ontario',
        explanation: 'Updated explanation.',
      })
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Question updated',
      description: 'The fix has been saved.',
    });
  });

  it('persists an accepted suggested fix before dismissing the finding', async () => {
    const persisted = { ...question, question: 'Which city is the festival held in?' };
    mocks.updateQuestion.mockResolvedValue(persisted);
    await renderReport();

    fireEvent.click(screen.getByTestId(`button-accept-fix-${question.id}`));

    await waitFor(() =>
      expect(mocks.updateQuestion).toHaveBeenCalledWith(question.id, {
        question: 'Which city is the festival held in?',
      })
    );
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      'POST',
      '/api/admin/quality-sweep/dismiss',
      expect.objectContaining({ questionId: question.id, findingType: 'static' })
    );
    expect(mocks.updateQuestion.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.apiRequest.mock.invocationCallOrder[0]
    );
  });
});

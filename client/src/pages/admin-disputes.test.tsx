import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminDispute } from '@shared/schema';
import type { Question } from '@/lib/store';
import AdminDisputes from './admin-disputes';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  invalidateQueries: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
  updateQuestion: vi.fn(),
}));

const question: Question = {
  id: 'q-1',
  category: 'Science',
  difficulty: 'Easy',
  question: 'What is the chemical formula for water?',
  answer: 'H2O',
  acceptableAnswers: ['Water'],
  explanation: 'Water is composed of hydrogen and oxygen.',
  pillar: 'GlobalEh',
  tags: ['Global', 'Science', 'GlobalEh'],
};

const dispute: AdminDispute = {
  id: 'dispute-1',
  questionId: question.id,
  questionText: question.question,
  correctAnswer: question.answer,
  teamName: 'Alpha',
  submittedAnswer: 'Water',
  teamExplanation: 'The everyday name should count.',
  timestamp: new Date('2026-07-16T12:00:00.000Z'),
  status: 'pending',
  resolutionNote: null,
  aiAnalysis: null,
  roomId: null,
  roomCode: null,
  attemptKey: null,
  disputingPlayerId: null,
  disputingPlayerName: null,
  votingEnabled: false,
  eligibleVoterSnapshot: null,
  threshold: null,
  outcome: null,
  originalPointsDelta: null,
  finalPointsDelta: null,
  decidedAt: null,
  ballots: [],
};

vi.mock('wouter', () => ({ useLocation: () => ['/admin/disputes', vi.fn()] }));
vi.mock('@/components/admin-layout', () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/admin/DisputeVoteAudit', () => ({ DisputeVoteAudit: () => null }));
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
vi.mock('@/lib/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/store')>();
  return {
    ...actual,
    useGame: () => ({
      state: { questions: [question] },
      updateQuestion: mocks.updateQuestion,
    }),
  };
});
vi.mock('@/lib/queryClient', () => ({
  apiRequest: mocks.apiRequest,
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({
      data: [dispute],
      isLoading: false,
      isError: false,
      refetch: mocks.refetch,
    }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

describe('AdminDisputes corrected-question persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.apiRequest.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('saves the question before resolving the dispute', async () => {
    mocks.updateQuestion.mockResolvedValue({ ...question, answer: 'Water' });
    render(<AdminDisputes />);

    fireEvent.change(screen.getByTestId(`input-fix-answer-${dispute.id}`), {
      target: { value: 'Water' },
    });
    fireEvent.click(screen.getByTestId(`button-apply-fix-${dispute.id}`));

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledOnce());
    expect(mocks.updateQuestion).toHaveBeenCalledWith(question.id, {
      question: question.question,
      answer: 'Water',
      explanation: question.explanation,
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith('PATCH', `/api/disputes/${dispute.id}`, {
      status: 'resolved',
      resolutionNote: 'Accepted by admin',
    });
    expect(mocks.updateQuestion.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.apiRequest.mock.invocationCallOrder[0]
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Fix Applied',
      description: 'The question was updated and the dispute was resolved.',
    });
  });

  it('leaves the dispute pending when question persistence fails', async () => {
    mocks.updateQuestion.mockRejectedValue(
      new Error('Invalid question update: answer is required')
    );
    render(<AdminDisputes />);

    fireEvent.click(screen.getByTestId(`button-apply-fix-${dispute.id}`));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        title: 'Fix not applied',
        description: 'Invalid question update: answer is required',
        variant: 'destructive',
      })
    );
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId(`card-dispute-${dispute.id}`).textContent).toContain('PENDING');
  });
});

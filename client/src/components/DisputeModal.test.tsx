import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DisputeModal } from './DisputeModal';

const mockSaveDispute = vi.fn();
const mockToast = vi.fn();

vi.mock('@/lib/disputes', () => ({
  saveDispute: (...args: unknown[]) => mockSaveDispute(...args),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  questionId: 'q1',
  questionText: 'Which planet is closest to the Sun?',
  correctAnswer: 'Mercury',
  teamName: 'Alice',
  submittedAnswer: 'Venus',
  onDisputeSubmitted: vi.fn(),
};

describe('DisputeModal', () => {
  beforeEach(() => {
    mockSaveDispute.mockReset();
    mockToast.mockReset();
    baseProps.onOpenChange.mockReset();
    baseProps.onDisputeSubmitted.mockReset();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves the generic solo dispute submission flow', async () => {
    mockSaveDispute.mockResolvedValue({ success: true });
    render(<DisputeModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/explain why/i), {
      target: { value: 'The accepted source says Venus.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Dispute' }));

    await waitFor(() => expect(mockSaveDispute).toHaveBeenCalled());
    expect(mockSaveDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        questionId: 'q1',
        teamExplanation: 'The accepted source says Venus.',
      })
    );
    expect(baseProps.onDisputeSubmitted).toHaveBeenCalled();
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('uses the room-scoped callback without calling the generic endpoint', async () => {
    const submitDispute = vi.fn().mockResolvedValue(undefined);
    render(<DisputeModal {...baseProps} submitDispute={submitDispute} />);
    fireEvent.change(screen.getByPlaceholderText(/explain why/i), {
      target: { value: '  The room answer should be accepted.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Dispute' }));

    await waitFor(() =>
      expect(submitDispute).toHaveBeenCalledWith('The room answer should be accepted.')
    );
    expect(mockSaveDispute).not.toHaveBeenCalled();
    expect(baseProps.onDisputeSubmitted).toHaveBeenCalled();
  });

  it('keeps the modal open and shows a server error for a failed room submission', async () => {
    const submitDispute = vi.fn().mockRejectedValue(new Error('Room is not accepting disputes'));
    render(<DisputeModal {...baseProps} submitDispute={submitDispute} />);
    fireEvent.change(screen.getByPlaceholderText(/explain why/i), {
      target: { value: 'Evidence' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Dispute' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Room is not accepting disputes' })
      )
    );
    expect(baseProps.onDisputeSubmitted).not.toHaveBeenCalled();
    expect(baseProps.onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

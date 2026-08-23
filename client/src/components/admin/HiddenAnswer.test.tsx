import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HiddenAnswer, containsAnswer } from './HiddenAnswer';

describe('HiddenAnswer', () => {
  afterEach(() => cleanup());

  it('masks the answer by default and does not render the plaintext', () => {
    render(<HiddenAnswer answer="Toronto" testId="q1" />);

    expect(screen.getByTestId('masked-answer-q1')).toBeInTheDocument();
    expect(screen.queryByText('Toronto')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-answer-q1')).not.toBeInTheDocument();
  });

  it('reveals the answer on toggle click, then hides it again', () => {
    render(<HiddenAnswer answer="Toronto" testId="q1" />);
    const toggle = screen.getByTestId('button-toggle-answer-q1');

    fireEvent.click(toggle);
    expect(screen.getByTestId('text-answer-q1')).toHaveTextContent('Toronto');
    expect(screen.queryByTestId('masked-answer-q1')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText('Toronto')).not.toBeInTheDocument();
    expect(screen.getByTestId('masked-answer-q1')).toBeInTheDocument();
  });

  it('renders the label when provided and omits it when null', () => {
    const { rerender } = render(<HiddenAnswer answer="Toronto" label="A:" testId="q1" />);
    expect(screen.getByText('A:')).toBeInTheDocument();

    rerender(<HiddenAnswer answer="Toronto" label={null} testId="q1" />);
    expect(screen.queryByText('A:')).not.toBeInTheDocument();
  });

  it('never leaks the answer into the DOM (incl. attributes) before reveal, even without a testId', () => {
    // Regression: when testId was omitted the answer's first 8 chars were
    // written into data-testid, leaking short answers like "Toronto".
    const { container } = render(<HiddenAnswer answer="Toronto" />);
    expect(container.innerHTML).not.toContain('Toronto');
  });

  it('always shows a mask even for an empty answer', () => {
    render(<HiddenAnswer answer="" testId="empty" />);
    expect(screen.getByTestId('masked-answer-empty')).toHaveTextContent('•');
  });
});

describe('containsAnswer', () => {
  it('detects the answer inside prose, case-insensitively', () => {
    expect(containsAnswer('The capital is Calgary, in Alberta.', ['Calgary'])).toBe(true);
    expect(containsAnswer('the capital is calgary', ['Calgary'])).toBe(true);
  });

  it('matches any of the acceptable answers', () => {
    expect(containsAnswer('Also known as H₂O.', ['H2O', 'H₂O'])).toBe(true);
  });

  it('returns false when no answer is present', () => {
    expect(containsAnswer('A neutral explanation with no spoilers.', ['Calgary'])).toBe(false);
  });

  it('handles empty/blank inputs safely', () => {
    expect(containsAnswer('', ['Calgary'])).toBe(false);
    expect(containsAnswer(null, ['Calgary'])).toBe(false);
    expect(containsAnswer('some text', [null, undefined, '  '])).toBe(false);
  });
});

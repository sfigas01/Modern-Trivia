import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HiddenAnswer } from './HiddenAnswer';

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

  it('always shows a mask even for an empty answer', () => {
    render(<HiddenAnswer answer="" testId="empty" />);
    expect(screen.getByTestId('masked-answer-empty')).toHaveTextContent('•');
  });
});

import { useDisputeForm, type DisputeModalProps } from '@/components/DisputeModal';
import { PixelBusy, PixelButton } from './Pixel';
import { PixelDialog, PixelDialogActions } from './Game';

// Pixel version of DisputeModal (STE-136): same props and submission logic.
export function PixelDisputeModal(props: DisputeModalProps) {
  const { open, onOpenChange, questionText, correctAnswer, submittedAnswer } = props;
  const { explanation, setExplanation, isSubmitting, handleSubmit } = useDisputeForm(props);

  return (
    <PixelDialog
      open={open}
      onOpenChange={(next) => !isSubmitting && onOpenChange(next)}
      title="Dispute This Answer"
      description="Help us improve the game by explaining why you think this answer is incorrect."
      testId="dispute-modal"
    >
      <dl className="tc-sub tc-recap">
        <div>
          <dt>Question</dt>
          <dd>{questionText}</dd>
        </div>
        <div>
          <dt>Game&rsquo;s Answer</dt>
          <dd>{correctAnswer}</dd>
        </div>
        <div>
          <dt>Your Answer</dt>
          <dd>{submittedAnswer || '(Passed)'}</dd>
        </div>
      </dl>
      <label htmlFor="pixel-dispute-why" className="tc-label">
        Why do you dispute this answer?
      </label>
      <textarea
        id="pixel-dispute-why"
        className="tc-field"
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        placeholder="Explain why you think the game's answer is incorrect or provide evidence..."
      />
      <p className="tc-hint">Your feedback helps us verify and fix incorrect answers.</p>
      <PixelDialogActions>
        <PixelButton variant="stone" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
          Cancel
        </PixelButton>
        <PixelButton variant="red" onClick={() => void handleSubmit()} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <PixelBusy />
              Submitting…
            </>
          ) : (
            'Submit Dispute'
          )}
        </PixelButton>
      </PixelDialogActions>
    </PixelDialog>
  );
}

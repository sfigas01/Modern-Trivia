import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { saveDispute } from '@/lib/disputes';
import { useToast } from '@/hooks/use-toast';

interface DisputeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionId: string;
  questionText: string;
  correctAnswer: string;
  teamName: string;
  submittedAnswer: string | null;
  /** Callback invoked after a dispute is successfully submitted. */
  onDisputeSubmitted: () => void;
  /** Optional room-scoped submission. Solo callers omit this and keep using saveDispute. */
  submitDispute?: (explanation: string) => Promise<void>;
}

export function DisputeModal({
  open,
  onOpenChange,
  questionId,
  questionText,
  correctAnswer,
  teamName,
  submittedAnswer,
  onDisputeSubmitted,
  submitDispute,
}: DisputeModalProps) {
  const [explanation, setExplanation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!explanation.trim()) {
      toast({
        title: 'Error',
        description: 'Please provide an explanation for the dispute.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (submitDispute) {
        await submitDispute(explanation.trim());
      } else {
        const result = await saveDispute({
          questionId,
          questionText,
          correctAnswer,
          teamName,
          submittedAnswer,
          teamExplanation: explanation,
        });

        if (!result.success) throw new Error(result.message || 'Failed to submit dispute.');
      }
    } catch (error) {
      if ((error as { status?: number }).status !== 409) {
        toast({
          title: 'Error',
          description:
            error instanceof Error && error.message
              ? error.message
              : 'Failed to submit dispute. Please try again.',
          variant: 'destructive',
        });
      }
      return;
    } finally {
      setIsSubmitting(false);
    }

    if (!submitDispute) {
      toast({
        title: 'Dispute Submitted',
        description: "Thank you for helping us improve the game. We'll review this.",
      });
    }

    onDisputeSubmitted();

    setExplanation('');
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Dispute This Answer</AlertDialogTitle>
          <AlertDialogDescription>
            Help us improve the game by explaining why you think this answer is incorrect.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 my-4">
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-4 space-y-2">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Question</div>
                <div className="font-semibold">{questionText}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Game's Answer</div>
                <div className="font-semibold text-primary">{correctAnswer}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Your Answer</div>
                <div className="font-semibold">{submittedAnswer || '(Passed)'}</div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <label className="text-sm font-medium">Why do you dispute this answer?</label>
            <Textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Explain why you think the game's answer is incorrect or provide evidence..."
              className="min-h-32 bg-white/5 border-white/10"
            />
            <p className="text-xs text-muted-foreground">
              Your feedback helps us verify and fix incorrect answers.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className="bg-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting…' : 'Submit Dispute'}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

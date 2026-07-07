import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, ExternalLink, Flag } from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { AdvanceRoomResponse, RoomActionResponse, RoomSnapshot } from '@shared/models/rooms';

import { isRoomConflict } from '@/hooks/use-room';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DisputeModal } from '@/components/DisputeModal';
import { cn, getDifficultyBadgeClass } from '@/lib/utils';

type RevealSnapshot = Extract<RoomSnapshot, { phase: 'REVEAL' }>;

export interface RevealViewProps {
  snapshot: RevealSnapshot;
  currentPlayerId: string;
  advance: UseMutationResult<AdvanceRoomResponse, Error, void>;
  awardDispute: UseMutationResult<RoomActionResponse, Error, void>;
  refetch: () => void;
}

export function RevealView({
  snapshot,
  currentPlayerId,
  advance,
  awardDispute,
  refetch,
}: RevealViewProps) {
  const attempt = snapshot.currentAttempt;
  const isActive = snapshot.activePlayerId === currentPlayerId;
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const canAdvance = isActive || isHost;
  const answeringPlayer = attempt
    ? snapshot.players.find((player) => player.id === attempt.playerId)
    : undefined;

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);

  // Show dispute button when the attempt is INCORRECT and hasn't been disputed yet
  const canDispute = attempt?.verdict === 'INCORRECT' && !disputeSubmitted;
  // Show award-points button after a dispute has been submitted (and points not yet awarded)
  const canAwardPoints = disputeSubmitted && attempt?.verdict === 'INCORRECT';

  function handleNext() {
    if (advance.isPending) return;
    advance.mutate(undefined, {
      onError: (error) => {
        if (isRoomConflict(error)) {
          refetch();
          return;
        }
        toast.error(error.message || 'Something went wrong. Please try again.');
      },
    });
  }

  function handleAwardDisputedPoints() {
    if (awardDispute.isPending) return;
    awardDispute.mutate(undefined, {
      onSuccess: () => {
        toast.success(`Points awarded to ${answeringPlayer?.nickname || 'player'}.`);
        setDisputeSubmitted(false);
      },
      onError: (error) => {
        if (isRoomConflict(error)) {
          refetch();
          return;
        }
        toast.error(error.message || 'Failed to award points.');
      },
    });
  }

  return (
    <div className="w-full max-w-lg space-y-4">
      <Card className="border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
        <CardContent className="p-6 space-y-2 text-center">
          <div className="flex flex-wrap gap-2 justify-center">
            <Badge variant="outline" className="border-white/20 bg-white/5">
              {snapshot.currentQuestion.category}
            </Badge>
            <Badge
              className={cn(
                'border-none',
                getDifficultyBadgeClass(snapshot.currentQuestion.difficulty)
              )}
            >
              {snapshot.currentQuestion.difficulty}
            </Badge>
          </div>
          <h1 className="text-xl md:text-2xl font-bold leading-tight font-display">
            {snapshot.currentQuestion.question}
          </h1>
        </CardContent>
      </Card>

      {attempt && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card
            className={cn(
              'border-2',
              attempt.verdict === 'CORRECT'
                ? 'border-green-500/50 bg-green-500/10'
                : attempt.verdict === 'PASS'
                  ? 'border-yellow-500/50 bg-yellow-500/10'
                  : 'border-red-500/50 bg-red-500/10'
            )}
            data-testid="card-attempt-verdict"
          >
            <CardContent className="p-4 text-center">
              <div className="text-sm uppercase tracking-widest opacity-70 mb-1">
                {answeringPlayer?.nickname ?? 'Player'} answered
              </div>
              <div className="text-xl font-bold">{attempt.submittedAnswer || '(Passed)'}</div>
              <div className="mt-2 font-mono font-bold text-lg" data-testid="text-verdict">
                {attempt.verdict} ({attempt.pointsDelta > 0 ? '+' : ''}
                {attempt.pointsDelta})
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="p-4 text-center">
              <div className="text-sm uppercase tracking-widest opacity-70 mb-1">
                Correct Answer
              </div>
              <div className="text-xl font-bold text-primary">
                {snapshot.currentQuestion.answer}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="bg-white/5 p-4 rounded-lg text-center text-muted-foreground italic">
        {snapshot.currentQuestion.explanation}
      </div>

      {snapshot.currentQuestion.sourceUrl && (
        <div className="flex justify-center">
          <a
            href={snapshot.currentQuestion.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {snapshot.currentQuestion.sourceName || 'Verify Source'}
          </a>
        </div>
      )}

      <div className="flex gap-4">
        {canAdvance ? (
          <Button
            onClick={handleNext}
            disabled={advance.isPending}
            className="flex-1 h-14 text-lg font-bold"
            data-testid="button-next"
          >
            {advance.isPending ? 'Continuing…' : 'Next'} <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        ) : (
          <p
            className="flex-1 text-center text-muted-foreground self-center"
            data-testid="text-waiting-continue"
          >
            Waiting to continue…
          </p>
        )}

        {canAwardPoints && (
          <Button
            onClick={handleAwardDisputedPoints}
            disabled={awardDispute.isPending}
            variant="secondary"
            className="h-14 px-6 font-bold"
          >
            {awardDispute.isPending ? 'Awarding…' : 'Group agreed — award points'}
          </Button>
        )}

        {canDispute && (
          <Button
            onClick={() => setDisputeOpen(true)}
            variant="outline"
            className="h-14 px-6 border-white/20 hover:bg-red-500/10 hover:text-red-500 transition-colors"
          >
            <Flag className="w-5 h-5" />
            <span className="hidden sm:inline ml-2">Dispute</span>
          </Button>
        )}
      </div>

      {attempt && (
        <DisputeModal
          open={disputeOpen}
          onOpenChange={setDisputeOpen}
          questionId={snapshot.currentQuestion.id}
          questionText={snapshot.currentQuestion.question}
          correctAnswer={snapshot.currentQuestion.answer}
          teamName={answeringPlayer?.nickname || 'Unknown'}
          submittedAnswer={attempt.submittedAnswer}
          onDisputeSubmitted={() => setDisputeSubmitted(true)}
        />
      )}
    </div>
  );
}

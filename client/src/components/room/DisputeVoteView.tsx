import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Ban, Check, Clock } from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  CancelDisputeVoteResponse,
  CastDisputeVoteRequest,
  CastDisputeVoteResponse,
  RoomSnapshot,
} from '@shared/models/rooms';

import { isRoomConflict } from '@/hooks/use-room';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, getDifficultyBadgeClass } from '@/lib/utils';

type DisputeVoteSnapshot = Extract<RoomSnapshot, { phase: 'DISPUTE_VOTE' }>;

interface DisputeVoteViewProps {
  snapshot: DisputeVoteSnapshot;
  currentPlayerId: string;
  castDisputeVote: UseMutationResult<CastDisputeVoteResponse, Error, CastDisputeVoteRequest>;
  cancelDisputeVote: UseMutationResult<CancelDisputeVoteResponse, Error, void>;
  refetch: () => void;
}

function secondsRemaining(closesAt: string): number {
  return Math.max(0, Math.ceil((new Date(closesAt).getTime() - Date.now()) / 1000));
}

export function DisputeVoteView({
  snapshot,
  currentPlayerId,
  castDisputeVote,
  cancelDisputeVote,
  refetch,
}: DisputeVoteViewProps) {
  const vote = snapshot.currentDisputeVote;
  const attempt = snapshot.currentAttempt;
  const [remaining, setRemaining] = useState(() => secondsRemaining(vote.closesAt));
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const isDisputingPlayer = vote.disputingPlayerId === currentPlayerId;
  const isEligible = vote.eligibleVoterIds.includes(currentPlayerId);
  const hasVoted = vote.submittedVoterIds.includes(currentPlayerId);
  const canVote = isEligible && !hasVoted;
  const submittedCount = vote.submittedVoterIds.length;
  const eligibleCount = vote.eligibleVoterIds.length;

  useEffect(() => {
    const updateRemaining = () => setRemaining(secondsRemaining(vote.closesAt));
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [vote.closesAt]);

  function handleVote(approve: boolean) {
    if (castDisputeVote.isPending || !canVote) return;
    castDisputeVote.mutate(
      { approve },
      {
        onError: (error) => {
          if (isRoomConflict(error)) {
            refetch();
            return;
          }
          toast.error(error.message || 'Failed to submit vote.');
        },
      }
    );
  }

  function handleCancel() {
    if (cancelDisputeVote.isPending || !isHost) return;
    cancelDisputeVote.mutate(undefined, {
      onError: (error) => {
        if (isRoomConflict(error)) {
          refetch();
          return;
        }
        toast.error(error.message || 'Failed to cancel dispute vote.');
      },
    });
  }

  return (
    <div className="w-full max-w-lg space-y-4" data-testid="dispute-vote-view">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="p-4 text-center">
            <div className="text-sm uppercase tracking-widest opacity-70 mb-1">
              {vote.disputingPlayerName} answered
            </div>
            <div className="text-xl font-bold">{attempt?.submittedAnswer || '(Passed)'}</div>
          </CardContent>
        </Card>
        <Card className="bg-primary/10 border-primary/20">
          <CardContent className="p-4 text-center">
            <div className="text-sm uppercase tracking-widest opacity-70 mb-1">Expected answer</div>
            <div className="text-xl font-bold text-primary">{snapshot.currentQuestion.answer}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Why this answer is disputed</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{vote.explanation}</CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-semibold">Opponent vote in progress</div>
              <div
                className="text-sm text-muted-foreground"
                aria-live="polite"
                data-testid="text-vote-progress"
              >
                {submittedCount} of {eligibleCount} votes submitted
              </div>
            </div>
            <div
              className="flex items-center gap-2 font-mono font-bold"
              aria-label={`${remaining} seconds remaining`}
              data-testid="text-vote-countdown"
            >
              <Clock className="size-4" /> {remaining}s
            </div>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Votes submitted"
            aria-valuemin={0}
            aria-valuemax={eligibleCount}
            aria-valuenow={submittedCount}
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${eligibleCount ? (submittedCount / eligibleCount) * 100 : 0}%` }}
            />
          </div>

          {isDisputingPlayer && (
            <p className="text-center text-muted-foreground" data-testid="text-disputant-waiting">
              Your dispute was submitted. Waiting for eligible opponents to vote…
            </p>
          )}
          {!isDisputingPlayer && hasVoted && (
            <p
              className="text-center font-medium"
              aria-live="polite"
              data-testid="text-vote-locked"
            >
              Vote submitted. Your choice is locked.
            </p>
          )}
          {!isDisputingPlayer && !isEligible && (
            <p className="text-center text-muted-foreground" data-testid="text-observer-waiting">
              Waiting for eligible opponents to vote…
            </p>
          )}

          {canVote && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button
                onClick={() => handleVote(true)}
                disabled={castDisputeVote.isPending}
                className="h-12"
                aria-label="Agree and award points"
              >
                <Check className="size-4 mr-2" /> Agree, award points
              </Button>
              <Button
                onClick={() => handleVote(false)}
                disabled={castDisputeVote.isPending}
                variant="outline"
                className="h-12"
                aria-label="Disagree with dispute"
              >
                <Ban className="size-4 mr-2" /> Disagree
              </Button>
            </div>
          )}

          {isHost && (
            <Button
              onClick={handleCancel}
              disabled={cancelDisputeVote.isPending}
              variant="ghost"
              className="w-full"
              aria-label="Cancel dispute vote"
            >
              {cancelDisputeVote.isPending ? 'Canceling…' : 'Cancel vote'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { Badge } from '@/components/ui/badge';
import type { AdminDispute, DisputeBallot, DisputeVoterSnapshot } from '@shared/schema';

interface DisputeVoteAuditProps {
  dispute: AdminDispute;
}

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function signedPoints(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

function outcomeClasses(outcome: AdminDispute['outcome']): string {
  switch (outcome) {
    case 'approved':
      return 'border-green-500/30 bg-green-500/10 text-green-400';
    case 'rejected':
    case 'tied':
      return 'border-red-500/30 bg-red-500/10 text-red-400';
    case 'expired':
    case 'canceled':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-400';
    default:
      return 'border-white/20 bg-white/5 text-muted-foreground';
  }
}

function ballotForVoter(ballots: DisputeBallot[], playerId: string): DisputeBallot | undefined {
  return ballots.find((ballot) => ballot.voterPlayerId === playerId);
}

export function DisputeVoteAudit({ dispute }: DisputeVoteAuditProps) {
  const ballots = dispute.ballots ?? [];
  const eligibleVoters: DisputeVoterSnapshot[] = dispute.eligibleVoterSnapshot ?? [];
  const eligibleIds = new Set(eligibleVoters.map((voter) => voter.playerId));
  const eligibleBallots = ballots.filter((ballot) => eligibleIds.has(ballot.voterPlayerId));
  const countedBallots = eligibleVoters.length > 0 ? eligibleBallots : ballots;
  const yesCount = countedBallots.filter((ballot) => ballot.approve).length;
  const noCount = countedBallots.filter((ballot) => !ballot.approve).length;
  const nonResponseCount = Math.max(eligibleVoters.length - eligibleBallots.length, 0);
  const isMultiplayer = Boolean(dispute.roomId || dispute.roomCode || dispute.attemptKey);
  const mode = !isMultiplayer
    ? 'Solo dispute'
    : dispute.votingEnabled
      ? 'Opponent vote'
      : 'Manual multiplayer';
  const orphanBallots = ballots.filter((ballot) => !eligibleIds.has(ballot.voterPlayerId));
  const scoreDeltaAvailable =
    dispute.originalPointsDelta !== null && dispute.finalPointsDelta !== null;

  return (
    <section
      className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4 space-y-4"
      aria-label="Dispute decision audit"
      data-testid={`vote-audit-${dispute.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">
            Gameplay decision audit
          </p>
          <p className="text-xs text-muted-foreground">
            Gameplay scoring and content QA are reviewed independently.
          </p>
        </div>
        <Badge variant="outline">{mode}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="rounded-md bg-black/10 p-3">
          <p className="text-xs uppercase text-muted-foreground">Gameplay outcome</p>
          <Badge variant="outline" className={`mt-1 capitalize ${outcomeClasses(dispute.outcome)}`}>
            {dispute.outcome ?? (isMultiplayer ? 'Not recorded' : 'Not applicable')}
          </Badge>
        </div>
        <div className="rounded-md bg-black/10 p-3">
          <p className="text-xs uppercase text-muted-foreground">Independent QA review</p>
          <p className="mt-1 font-semibold capitalize">{dispute.status}</p>
        </div>
        <div className="rounded-md bg-black/10 p-3">
          <p className="text-xs uppercase text-muted-foreground">Vote totals</p>
          <p className="mt-1 font-semibold">
            {yesCount} yes / {noCount} no / {nonResponseCount} no response
          </p>
          <p className="text-xs text-muted-foreground">
            Threshold: {dispute.threshold ?? 'Not recorded'}
          </p>
        </div>
        <div className="rounded-md bg-black/10 p-3">
          <p className="text-xs uppercase text-muted-foreground">Score delta</p>
          <p className="mt-1 font-semibold">
            {scoreDeltaAvailable
              ? `${signedPoints(dispute.originalPointsDelta!)} → ${signedPoints(dispute.finalPointsDelta!)}`
              : 'Not recorded'}
          </p>
        </div>
      </div>

      {isMultiplayer && (
        <div className="grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
          <p>
            Room: <span className="font-mono text-foreground">{dispute.roomCode ?? 'Unknown'}</span>
          </p>
          <p className="min-w-0 break-all">
            Attempt:{' '}
            <span className="font-mono text-foreground">
              {dispute.attemptKey ?? 'Not recorded'}
            </span>
          </p>
          <p>
            Disputing player:{' '}
            <span className="text-foreground">
              {dispute.disputingPlayerName ?? dispute.teamName ?? 'Unknown'}
            </span>
          </p>
          <p>
            Voting:{' '}
            <span className="text-foreground">
              {dispute.votingEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </p>
          <p>
            Submitted: <span className="text-foreground">{formatTimestamp(dispute.timestamp)}</span>
          </p>
          <p>
            Decided: <span className="text-foreground">{formatTimestamp(dispute.decidedAt)}</span>
          </p>
        </div>
      )}

      {isMultiplayer && (
        <details className="rounded-md border border-white/10 bg-black/10">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {eligibleVoters.length > 0
              ? `Ballot details (${eligibleBallots.length}/${eligibleVoters.length} responded)`
              : `Ballot details (${ballots.length} recorded; eligible snapshot unavailable)`}
          </summary>
          <div className="space-y-2 border-t border-white/10 p-3">
            {eligibleVoters.length === 0 && ballots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No eligible-voter snapshot was recorded.
              </p>
            ) : (
              <>
                {eligibleVoters.map((voter) => {
                  const ballot = ballotForVoter(ballots, voter.playerId);
                  return (
                    <div
                      key={voter.playerId}
                      className="grid gap-1 rounded-md bg-white/5 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                      data-testid={`ballot-row-${voter.playerId}`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{voter.displayName}</p>
                        <p className="break-all font-mono text-[11px] text-muted-foreground">
                          {voter.playerId}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          !ballot
                            ? 'border-amber-500/30 text-amber-400'
                            : ballot.approve
                              ? 'border-green-500/30 text-green-400'
                              : 'border-red-500/30 text-red-400'
                        }
                      >
                        {!ballot ? 'No response' : ballot.approve ? 'Agree' : 'Disagree'}
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        {ballot ? formatTimestamp(ballot.castAt) : 'Not cast'}
                      </p>
                    </div>
                  );
                })}
                {orphanBallots.map((ballot) => (
                  <div
                    key={ballot.id}
                    className="grid gap-1 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{ballot.voterPlayerName}</p>
                      <p className="break-all font-mono text-[11px] text-muted-foreground">
                        {ballot.voterPlayerId} · missing from eligible snapshot
                      </p>
                    </div>
                    <Badge variant="outline">{ballot.approve ? 'Agree' : 'Disagree'}</Badge>
                    <p className="text-xs text-muted-foreground">
                      {formatTimestamp(ballot.castAt)}
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

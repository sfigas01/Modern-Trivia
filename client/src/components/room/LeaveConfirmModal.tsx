import type { RoomSnapshot } from '@shared/models/rooms';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface LeaveConfirmModalProps {
  snapshot: RoomSnapshot;
  currentPlayerId: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function getDialogVariant(
  snapshot: RoomSnapshot,
  currentPlayerId: string
): 'lobby' | 'ends-game' | 'host-continues' | 'player-continues' {
  if (snapshot.phase === 'LOBBY') {
    return 'lobby';
  }

  const activePlayers = snapshot.players.filter((p) => !p.leftAt);
  const remainingAfterLeave = activePlayers.length - 1;

  if (remainingAfterLeave < 2) {
    return 'ends-game';
  }

  const isHost = snapshot.hostPlayerId === currentPlayerId;
  return isHost ? 'host-continues' : 'player-continues';
}

export function LeaveConfirmModal({
  snapshot,
  currentPlayerId,
  isPending,
  onConfirm,
  onCancel,
}: LeaveConfirmModalProps) {
  const variant = getDialogVariant(snapshot, currentPlayerId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      data-testid="leave-confirm-modal"
    >
      <Card className="w-full max-w-sm border-white/10 bg-background shadow-2xl">
        {variant === 'lobby' && (
          <>
            <CardHeader>
              <CardTitle>Leave Room?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                You'll be removed from this game room.
              </p>
              <ModalButtons
                cancelLabel="Stay"
                confirmLabel="Leave"
                isPending={isPending}
                onConfirm={onConfirm}
                onCancel={onCancel}
              />
            </CardContent>
          </>
        )}

        {variant === 'ends-game' && (
          <>
            <CardHeader>
              <CardTitle>End Game for Everyone?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Only 2 players remain. Leaving will end the game.
              </p>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Current Scores
                </p>
                {[...snapshot.players]
                  .filter((p) => !p.leftAt)
                  .sort((a, b) => b.score - a.score)
                  .map((player) => (
                    <div key={player.id} className="flex justify-between text-sm">
                      <span>
                        {player.nickname}
                        {player.id === currentPlayerId && (
                          <span className="text-muted-foreground"> (you)</span>
                        )}
                      </span>
                      <span className="font-mono font-bold">{player.score}</span>
                    </div>
                  ))}
              </div>
              <ModalButtons
                cancelLabel="Keep Playing"
                confirmLabel="Leave & End"
                isPending={isPending}
                onConfirm={onConfirm}
                onCancel={onCancel}
                destructive
              />
            </CardContent>
          </>
        )}

        {variant === 'host-continues' && (
          <>
            <CardHeader>
              <CardTitle>Leave Game?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Host duties will pass to the next player. The game will continue without you.
              </p>
              <ModalButtons
                cancelLabel="Stay"
                confirmLabel="Leave"
                isPending={isPending}
                onConfirm={onConfirm}
                onCancel={onCancel}
              />
            </CardContent>
          </>
        )}

        {variant === 'player-continues' && (
          <>
            <CardHeader>
              <CardTitle>Leave Game?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                The game will continue without you. Your score won't count toward the final results.
              </p>
              <ModalButtons
                cancelLabel="Stay"
                confirmLabel="Leave"
                isPending={isPending}
                onConfirm={onConfirm}
                onCancel={onCancel}
              />
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

interface ModalButtonsProps {
  cancelLabel: string;
  confirmLabel: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

function ModalButtons({
  cancelLabel,
  confirmLabel,
  isPending,
  onConfirm,
  onCancel,
  destructive,
}: ModalButtonsProps) {
  return (
    <div className="flex gap-3">
      <Button
        variant="outline"
        className="flex-1 border-white/10"
        onClick={onCancel}
        disabled={isPending}
        data-testid="button-leave-cancel"
      >
        {cancelLabel}
      </Button>
      <Button
        variant={destructive ? 'destructive' : 'default'}
        className="flex-1"
        onClick={onConfirm}
        disabled={isPending}
        data-testid="button-leave-confirm"
      >
        {isPending ? 'Leaving…' : confirmLabel}
      </Button>
    </div>
  );
}

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

export type LeaveDialogVariant = 'lobby' | 'ends-game' | 'host-continues' | 'player-continues';

// Copy for each leave-dialog variant, shared by the classic and pixel dialogs.
export const LEAVE_DIALOG_COPY: Record<
  LeaveDialogVariant,
  { title: string; body: string; cancel: string; confirm: string }
> = {
  lobby: {
    title: 'Leave Room?',
    body: "You'll be removed from this game room.",
    cancel: 'Stay',
    confirm: 'Leave',
  },
  'ends-game': {
    title: 'End Game for Everyone?',
    body: 'Only 2 players remain. Leaving will end the game.',
    cancel: 'Keep Playing',
    confirm: 'Leave & End',
  },
  'host-continues': {
    title: 'Leave Game?',
    body: 'Host duties will pass to the next player. The game will continue without you.',
    cancel: 'Stay',
    confirm: 'Leave',
  },
  'player-continues': {
    title: 'Leave Game?',
    body: "The game will continue without you. Your score won't count toward the final results.",
    cancel: 'Stay',
    confirm: 'Leave',
  },
};

export function getDialogVariant(
  snapshot: RoomSnapshot,
  currentPlayerId: string
): LeaveDialogVariant {
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
  const copy = LEAVE_DIALOG_COPY[variant];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      data-testid="leave-confirm-modal"
    >
      <Card className="w-full max-w-sm border-white/10 bg-background shadow-2xl">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">{copy.body}</p>
          {variant === 'ends-game' && (
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
          )}
          <ModalButtons
            cancelLabel={copy.cancel}
            confirmLabel={copy.confirm}
            isPending={isPending}
            onConfirm={onConfirm}
            onCancel={onCancel}
            destructive={variant === 'ends-game'}
          />
        </CardContent>
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

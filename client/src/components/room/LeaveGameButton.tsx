import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LeaveGameButtonProps {
  onClick: () => void;
  isPending?: boolean;
}

export function LeaveGameButton({ onClick, isPending }: LeaveGameButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={isPending}
      className="fixed top-4 right-4 z-50 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
      aria-label="Leave game"
      data-testid="button-leave-game"
    >
      <LogOut className="w-5 h-5" />
    </Button>
  );
}

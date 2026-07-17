import { useEffect, useRef } from 'react';
import { addGuestSeenIds } from '@/lib/guest-seen';

// Records each room question a guest client actually sees, so consecutive
// guest games in this browser (hosted or joined) avoid repeats. Skips
// while auth status is still resolving so a guest is never misclassified,
// and skips entirely for signed-in players (server history covers them).
export function useRecordGuestRoomQuestion(
  questionId: string | null | undefined,
  isAuthenticated: boolean,
  authLoading: boolean
): void {
  const lastRecordedId = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading || isAuthenticated) return;
    if (!questionId) return;
    if (lastRecordedId.current === questionId) return;
    lastRecordedId.current = questionId;
    addGuestSeenIds([questionId]);
  }, [questionId, isAuthenticated, authLoading]);
}

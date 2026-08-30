import { useEffect, useRef } from 'react';
import { addGuestSeenIds } from '@/lib/guest-seen';

// Records each room question the current player actually sees, the moment it is
// presented -- so an abandoned game or an early leaver only ever records what
// was shown, never the unused remainder of the preselected pool. Guests write
// to browser-local history; signed-in players write to server-side
// seen_questions via POST /api/questions/seen. Skips while auth status is still
// resolving so a player is never misclassified.
export function useRecordRoomQuestion(
  questionId: string | null | undefined,
  isAuthenticated: boolean,
  authLoading: boolean
): void {
  const lastRecordedId = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!questionId) return;
    if (lastRecordedId.current === questionId) return;
    lastRecordedId.current = questionId;

    if (isAuthenticated) {
      // The endpoint's 24h replay guard keeps repeated posts (retries, a
      // rejoin) from inflating the seen count or over-extending cooldowns.
      fetch('/api/questions/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionIds: [questionId] }),
      }).catch((error) => console.error('Failed to record seen question:', error));
    } else {
      addGuestSeenIds([questionId]);
    }
  }, [questionId, isAuthenticated, authLoading]);
}

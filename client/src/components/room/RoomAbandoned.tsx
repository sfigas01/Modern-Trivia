import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import type { RoomSnapshot } from '@shared/models/rooms';

import { clearRoomSession } from '@/lib/room-session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export interface RoomAbandonedProps {
  snapshot: RoomSnapshot;
}

export function RoomAbandoned({ snapshot }: RoomAbandonedProps) {
  const [, setLocation] = useLocation();
  const ranked = [...snapshot.players].sort((a, b) => b.score - a.score);
  const homeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    homeButtonRef.current?.focus();
  }, []);

  function handleBackToHome() {
    clearRoomSession(snapshot.code);
    setLocation('/');
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      data-testid="room-abandoned"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-abandoned-title"
    >
      <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-md">
        <CardHeader>
          <CardTitle id="room-abandoned-title">Room Closed</CardTitle>
          <CardDescription>The host has ended this game.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ranked.length > 0 && (
            <div className="space-y-2">
              {ranked.map((player, index) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2"
                  data-testid={`abandoned-result-row-${player.id}`}
                >
                  <span>
                    #{index + 1} {player.nickname}
                  </span>
                  <span className="font-mono">{player.score}</span>
                </div>
              ))}
            </div>
          )}
          <Button
            ref={homeButtonRef}
            className="w-full"
            onClick={handleBackToHome}
            data-testid="button-abandoned-home"
          >
            Back to Home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

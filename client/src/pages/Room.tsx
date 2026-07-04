import { useEffect, useMemo } from 'react';
import { useLocation, useParams } from 'wouter';

import { Lobby } from '@/components/room/Lobby';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useRoom } from '@/hooks/use-room';
import { getRoomSession } from '@/lib/room-session';

export default function Room() {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const session = useMemo(() => getRoomSession(code), [code]);
  const { snapshot, isLoading, isDisconnected, error, start, end } = useRoom(code, {
    enabled: !!session,
  });

  useEffect(() => {
    if (!session) {
      setLocation('/');
    }
  }, [session, setLocation]);

  if (!session) {
    return null;
  }

  if (isLoading && !snapshot) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!snapshot) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
      {isDisconnected && (
        <p className="text-sm text-yellow-400" data-testid="text-disconnected" aria-live="polite">
          Connection lost. Reconnecting…
        </p>
      )}

      {snapshot.phase === 'LOBBY' ? (
        <Lobby snapshot={snapshot} currentPlayerId={session.playerId} start={start} end={end} />
      ) : (
        <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Room {snapshot.code}</CardTitle>
            <CardDescription>This screen isn't implemented yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Phase: {snapshot.phase}. Gameplay screens are coming soon (STE-211).
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

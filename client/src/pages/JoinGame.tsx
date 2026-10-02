import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { LogIn, UserPlus } from 'lucide-react';

import { useJoinGame } from '@/hooks/use-join-game';
import { PIXEL_UI } from '@/lib/featureFlags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

// The pixel redesign (STE-231) loads as its own chunk, only with VITE_PIXEL_UI on.
const PixelJoinGame = lazy(() => import('./JoinGamePixel'));

export default function JoinGame() {
  return PIXEL_UI ? (
    <Suspense fallback={<div className="min-h-screen bg-[#4aa3f7]" />}>
      <PixelJoinGame />
    </Suspense>
  ) : (
    <ClassicJoinGame />
  );
}

function ClassicJoinGame() {
  const {
    code,
    handleCodeChange,
    isCodeValid,
    isPrefilled,
    showInviteHint,
    nickname,
    setNickname,
    isNicknameValid,
    handleSubmit,
    isJoining,
  } = useJoinGame();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-background to-background">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] opacity-50" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px] opacity-50" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md z-10 space-y-8"
      >
        <div className="text-center space-y-2">
          <h1 className="text-6xl font-extrabold tracking-tighter bg-gradient-to-br from-white to-white/50 bg-clip-text text-transparent drop-shadow-sm">
            JOIN A
            <br />
            GAME
          </h1>
          <p className="text-muted-foreground font-medium tracking-wide">ENTER YOUR ROOM CODE</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <Card className="border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <LogIn className="w-5 h-5 text-primary" />
                Room Code
              </CardTitle>
              <CardDescription data-testid="text-code-hint">
                {showInviteHint
                  ? 'Code filled in from your invite. Just add a nickname to join.'
                  : 'Ask the host for the 5-character code.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="ABCDE"
                value={code}
                onChange={handleCodeChange}
                className="bg-white/5 border-white/10 focus:border-primary/50 text-lg py-6 tracking-[0.3em] text-center uppercase"
                autoFocus={!isPrefilled}
                maxLength={5}
                disabled={isJoining}
                data-testid="input-code"
              />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserPlus className="w-5 h-5 text-primary" />
                Your Nickname
              </CardTitle>
              <CardDescription>Shown to other players in the room.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Enter your nickname..."
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="bg-white/5 border-white/10 focus:border-primary/50 text-lg py-6"
                autoFocus={isPrefilled}
                maxLength={20}
                disabled={isJoining}
                data-testid="input-nickname"
              />
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="w-full h-16 text-xl font-bold tracking-wide rounded-2xl shadow-[0_0_40px_-10px_var(--color-primary)] hover:shadow-[0_0_60px_-10px_var(--color-primary)] transition-all"
            disabled={!isCodeValid || !isNicknameValid || isJoining}
            data-testid="button-join-room"
          >
            {isJoining ? (
              <>
                <Spinner className="mr-2" />
                Joining Room...
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5 mr-2" />
                Join Room
              </>
            )}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}

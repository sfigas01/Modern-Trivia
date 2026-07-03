import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { UserPlus, Zap } from 'lucide-react';
import {
  ROOM_ROUND_OPTIONS,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type RoomCategory,
  type RoomRounds,
} from '@shared/models/rooms';

import { useGame } from '@/lib/store';
import { saveRoomSession } from '@/lib/room-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

async function createRoom(body: CreateRoomRequest): Promise<CreateRoomResponse> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.message === 'string') message = data.message;
    } catch {
      // response had no JSON body; fall back to statusText
    }
    throw new Error(message);
  }

  return res.json() as Promise<CreateRoomResponse>;
}

export default function HostGame() {
  const [, setLocation] = useLocation();
  const { state, setCategory, setNumRounds } = useGame();
  const [nickname, setNickname] = useState('');

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    state.questions.forEach((q) => {
      counts[q.category] = (counts[q.category] || 0) + 1;
    });
    counts['All'] = state.questions.length;
    return counts;
  }, [state.questions]);

  const createRoomMutation = useMutation({
    mutationFn: createRoom,
    onSuccess: (response) => {
      saveRoomSession({ code: response.code, playerId: response.playerId, token: response.token });
      setLocation(`/room/${response.code}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create room. Please try again.');
    },
  });

  const trimmedNickname = nickname.trim();
  const isNicknameValid = trimmedNickname.length > 0;

  const handleCreateRoom = () => {
    if (!isNicknameValid) return;
    createRoomMutation.mutate({
      nickname: trimmedNickname,
      category: state.selectedCategory as RoomCategory,
      numRounds: state.numRounds as RoomRounds,
    });
  };

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
            HOST A
            <br />
            GAME
          </h1>
          <p className="text-muted-foreground font-medium tracking-wide">SET UP YOUR ROOM</p>
        </div>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <UserPlus className="w-5 h-5 text-primary" />
              Your Nickname
            </CardTitle>
            <CardDescription>Shown to players who join your room.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Enter your nickname..."
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="bg-white/5 border-white/10 focus:border-primary/50 text-lg py-6"
              autoFocus
              maxLength={20}
              disabled={createRoomMutation.isPending}
              data-testid="input-nickname"
            />
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">Category</CardTitle>
            <CardDescription>Choose a topic for this room.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
              <Button
                variant={state.selectedCategory === 'All' ? 'default' : 'outline'}
                onClick={() => setCategory('All')}
                disabled={createRoomMutation.isPending}
                className={`border-white/10 hover:bg-white/10 ${
                  state.selectedCategory === 'All'
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : ''
                }`}
              >
                All ({categoryCounts['All'] || 0})
              </Button>
              {state.categories
                .filter((c) => c !== 'All')
                .map((category) => (
                  <Button
                    key={category}
                    variant={state.selectedCategory === category ? 'default' : 'outline'}
                    onClick={() => setCategory(category)}
                    disabled={createRoomMutation.isPending}
                    className={`border-white/10 hover:bg-white/10 ${
                      state.selectedCategory === category
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                        : ''
                    }`}
                  >
                    {category} ({categoryCounts[category] || 0})
                  </Button>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="w-4 h-4 text-primary" />
              Number of Rounds
            </CardTitle>
            <CardDescription>How many questions to play.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {ROOM_ROUND_OPTIONS.map((rounds) => (
                <Button
                  key={rounds}
                  variant={state.numRounds === rounds ? 'default' : 'outline'}
                  onClick={() => setNumRounds(rounds)}
                  disabled={createRoomMutation.isPending}
                  className={`border-white/10 hover:bg-white/10 ${state.numRounds === rounds ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                >
                  {rounds}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Button
          className="w-full h-16 text-xl font-bold tracking-wide rounded-2xl shadow-[0_0_40px_-10px_var(--color-primary)] hover:shadow-[0_0_60px_-10px_var(--color-primary)] transition-all"
          disabled={!isNicknameValid || createRoomMutation.isPending}
          onClick={handleCreateRoom}
          data-testid="button-create-room"
        >
          {createRoomMutation.isPending ? (
            <>
              <Spinner className="mr-2" />
              Creating Room...
            </>
          ) : (
            <>
              <UserPlus className="w-5 h-5 mr-2" />
              Create Room
            </>
          )}
        </Button>
      </motion.div>
    </div>
  );
}

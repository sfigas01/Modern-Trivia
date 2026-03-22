import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useGame, QUESTIONS_PER_TEAM_ROTATION } from '@/lib/store';
import { useAuth } from '@/hooks/use-auth';
import { useAdmin } from '@/hooks/use-admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X, Plus, Settings, Users, Zap, LogIn, LogOut, Shield, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Home() {
  const [_, setLocation] = useLocation();
  const { state, addTeam, removeTeam, setCategory, setNumRounds, startGame } = useGame();
  const { user, isAuthenticated, logout } = useAuth();
  const { isAdmin } = useAdmin();
  const [newTeamName, setNewTeamName] = useState('');

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    state.questions.forEach((q) => {
      counts[q.category] = (counts[q.category] || 0) + 1;
    });
    counts['All'] = state.questions.length;
    return counts;
  }, [state.questions]);

  const totalNeeded = state.numRounds * state.teams.length * QUESTIONS_PER_TEAM_ROTATION;
  const availableCount = categoryCounts[state.selectedCategory] || 0;
  const hasInsufficientQuestions = state.teams.length >= 2 && availableCount < totalNeeded && availableCount > 0;

  const handleAddTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTeamName.trim()) {
      addTeam(newTeamName.trim());
      setNewTeamName('');
    }
  };

  const handleStart = async () => {
    await startGame();
    setLocation('/game');
  };

  const statusLabel =
    state.phase === 'SETUP'
      ? 'Not Started'
      : state.phase === 'GAME_OVER'
        ? 'Completed'
        : 'In Progress';

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
            TRIVIA
            <br />
            CLASH
          </h1>
          <p className="text-muted-foreground font-medium tracking-wide">
            THE COMPETITIVE PARTY GAME
          </p>
          <div className="flex justify-center">
            <Badge variant="outline" className="border-primary/40 text-primary">
              {statusLabel}
            </Badge>
          </div>
        </div>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Users className="w-5 h-5 text-primary" />
              Team Setup
            </CardTitle>
            <CardDescription>Add 2-6 teams to begin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddTeam} className="flex gap-2">
              <Input
                placeholder="Enter team name..."
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="bg-white/5 border-white/10 focus:border-primary/50 text-lg py-6"
                autoFocus
              />
              <Button
                type="submit"
                size="icon"
                className="h-12 w-12 shrink-0 rounded-xl"
                disabled={!newTeamName.trim() || state.teams.length >= 6}
              >
                <Plus className="w-6 h-6" />
              </Button>
            </form>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {state.teams.map((team) => (
                  <motion.div
                    key={team.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 group"
                  >
                    <span className="font-medium text-lg truncate px-2">{team.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTeam(team.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>

              {state.teams.length === 0 && (
                <div className="text-center py-8 text-muted-foreground italic border-2 border-dashed border-white/5 rounded-lg">
                  No teams added yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">Category</CardTitle>
            <CardDescription>Choose a topic for this round.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
              <Button
                variant={state.selectedCategory === 'All' ? 'default' : 'outline'}
                onClick={() => setCategory('All')}
                className={`border-white/10 hover:bg-white/10 ${
                  state.selectedCategory === 'All'
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : ''
                }`}
              >
                All ({categoryCounts['All'] || 0})
              </Button>
              {state.categories.filter((c) => c !== 'All').map((category) => (
                <Button
                  key={category}
                  variant={state.selectedCategory === category ? 'default' : 'outline'}
                  onClick={() => setCategory(category)}
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
              {[5, 10, 15, 20].map((rounds) => (
                <Button
                  key={rounds}
                  variant={state.numRounds === rounds ? 'default' : 'outline'}
                  onClick={() => setNumRounds(rounds)}
                  className={`border-white/10 hover:bg-white/10 ${state.numRounds === rounds ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                >
                  {rounds}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {hasInsufficientQuestions && (
            <div
              className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-sm"
              data-testid="warning-insufficient-questions"
            >
              <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-yellow-300">Not enough questions</p>
                <p className="mt-1">
                  {state.selectedCategory === 'All' ? 'All categories have' : `"${state.selectedCategory}" has`} only{' '}
                  <span className="font-bold">{availableCount}</span> question{availableCount !== 1 ? 's' : ''}, but your
                  setup needs <span className="font-bold">{totalNeeded}</span> ({state.numRounds} rounds × {state.teams.length} teams × {QUESTIONS_PER_TEAM_ROTATION} questions/turn).
                  The game will use all {availableCount} available.
                </p>
              </div>
            </div>
          )}
          <Button
            className="w-full h-16 text-xl font-bold tracking-wide rounded-2xl shadow-[0_0_40px_-10px_var(--color-primary)] hover:shadow-[0_0_60px_-10px_var(--color-primary)] transition-all"
            disabled={state.teams.length < 2}
            onClick={handleStart}
            data-testid="button-start-game"
          >
            START GAME
          </Button>

          <div className="flex justify-center gap-4 items-center flex-wrap">
            {isAuthenticated && isAdmin && (
              <Button
                variant="link"
                className="text-muted-foreground text-xs"
                onClick={() => setLocation('/admin')}
                data-testid="link-admin"
              >
                <Shield className="w-3 h-3 mr-1" />
                Admin Panel
              </Button>
            )}

            {isAuthenticated ? (
              <Button
                variant="link"
                className="text-muted-foreground text-xs"
                onClick={() => logout()}
                data-testid="button-logout"
              >
                <LogOut className="w-3 h-3 mr-1" />
                Sign Out ({user?.email?.split('@')[0]})
              </Button>
            ) : (
              <Button
                variant="link"
                className="text-muted-foreground text-xs"
                onClick={() => (window.location.href = '/api/login')}
                data-testid="button-login"
              >
                <LogIn className="w-3 h-3 mr-1" />
                Sign In
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, UserPlus, Zap } from 'lucide-react';
import { ROOM_ROUND_OPTIONS } from '@shared/models/rooms';

import { useHostGame } from '@/hooks/use-host-game';
import { PIXEL_UI, THEME_ROUNDS } from '@/lib/featureFlags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';

// The pixel redesign (STE-231) loads as its own chunk, only with VITE_PIXEL_UI on.
const PixelHostGame = lazy(() => import('./HostGamePixel'));

export default function HostGame() {
  return PIXEL_UI ? (
    <Suspense fallback={<div className="min-h-screen bg-[#4aa3f7]" />}>
      <PixelHostGame />
    </Suspense>
  ) : (
    <ClassicHostGame />
  );
}

function ClassicHostGame() {
  const {
    state,
    toggleCategory,
    setNumRounds,
    categoryCounts,
    nickname,
    setNickname,
    isNicknameValid,
    theme,
    setTheme,
    trimmedTheme,
    handleSuggest,
    isSuggesting,
    opponentDisputeVotingEnabled,
    setOpponentDisputeVotingEnabled,
    handleSubmit,
    isCreating,
  } = useHostGame();

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

        <form onSubmit={handleSubmit} className="space-y-8">
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
                disabled={isCreating}
                data-testid="input-nickname"
              />
            </CardContent>
          </Card>

          {THEME_ROUNDS && (
            <Card className="border-white/10 bg-white/5 backdrop-blur-md">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Theme (optional)
                </CardTitle>
                <CardDescription>
                  Enter a theme (e.g. &ldquo;baseball&rdquo;) to play a themed game. We&rsquo;ll
                  suggest related categories you can adjust, then generate questions on start.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. baseball, organic chemistry, Friends"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    className="bg-white/5 border-white/10 focus:border-primary/50"
                    maxLength={60}
                    disabled={isCreating}
                    data-testid="input-theme"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="border-white/10 hover:bg-white/10 whitespace-nowrap"
                    onClick={handleSuggest}
                    disabled={trimmedTheme.length < 2 || isSuggesting || isCreating}
                    data-testid="button-suggest-categories"
                  >
                    {isSuggesting ? (
                      <Spinner className="mr-2" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-2" />
                    )}
                    Suggest
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-white/10 bg-white/5 backdrop-blur-md">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">Category</CardTitle>
              <CardDescription>Choose one or more topics for this room.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                <Button
                  type="button"
                  variant={state.selectedCategories.length === 0 ? 'default' : 'outline'}
                  onClick={() => toggleCategory('All')}
                  disabled={isCreating}
                  className={`border-white/10 hover:bg-white/10 ${
                    state.selectedCategories.length === 0
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
                      type="button"
                      variant={state.selectedCategories.includes(category) ? 'default' : 'outline'}
                      onClick={() => toggleCategory(category)}
                      disabled={isCreating}
                      className={`border-white/10 hover:bg-white/10 ${
                        state.selectedCategories.includes(category)
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
                    type="button"
                    variant={state.numRounds === rounds ? 'default' : 'outline'}
                    onClick={() => setNumRounds(rounds)}
                    disabled={isCreating}
                    className={`border-white/10 hover:bg-white/10 ${state.numRounds === rounds ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                  >
                    {rounds}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5 backdrop-blur-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-lg">Opponent dispute voting</CardTitle>
                  <CardDescription id="opponent-dispute-voting-description">
                    Opposing players vote on disputed incorrect answers; majority approval awards
                    normal points.
                  </CardDescription>
                </div>
                <Switch
                  checked={opponentDisputeVotingEnabled}
                  onCheckedChange={setOpponentDisputeVotingEnabled}
                  disabled={isCreating}
                  aria-label="Opponent dispute voting"
                  aria-describedby="opponent-dispute-voting-description"
                  data-testid="switch-opponent-dispute-voting"
                />
              </div>
            </CardHeader>
          </Card>

          <Button
            type="submit"
            className="w-full h-16 text-xl font-bold tracking-wide rounded-2xl shadow-[0_0_40px_-10px_var(--color-primary)] hover:shadow-[0_0_60px_-10px_var(--color-primary)] transition-all"
            disabled={!isNicknameValid || isCreating}
            data-testid="button-create-room"
          >
            {isCreating ? (
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
        </form>
      </motion.div>
    </div>
  );
}

import { ROOM_ROUND_OPTIONS } from '@shared/models/rooms';

import { useHostGame } from '@/hooks/use-host-game';
import { THEME_ROUNDS } from '@/lib/featureFlags';
import {
  PixelBusy,
  PixelButton,
  PixelCategoryGrid,
  PixelFrame,
  PixelPageHeader,
  PixelRoundPicker,
  PixelScreen,
  PixelSwitch,
} from '@/components/pixel/Pixel';

// Pixel-art Host a Game (STE-231), rendered by HostGame.tsx when VITE_PIXEL_UI
// is on. Behavior, copy and test ids match the classic page.
export default function HostGamePixel() {
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
    goHome,
  } = useHostGame();

  return (
    <PixelScreen>
      <PixelPageHeader title="Host a Game" />

      <form onSubmit={handleSubmit} className="tc-stack" style={{ gap: 24 }}>
        <PixelFrame title="Your Nickname">
          <label htmlFor="host-nickname" className="tc-hint">
            Shown to players who join your room.
          </label>
          <input
            id="host-nickname"
            className="tc-field"
            placeholder="Enter your nickname..."
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoFocus
            maxLength={20}
            disabled={isCreating}
            data-testid="input-nickname"
          />
        </PixelFrame>

        {THEME_ROUNDS && (
          <PixelFrame title="Theme (optional)">
            <label htmlFor="host-theme" className="tc-hint">
              Enter a theme (e.g. &ldquo;baseball&rdquo;) to play a themed game. We&rsquo;ll suggest
              related categories you can adjust, then generate questions on start.
            </label>
            <div className="tc-row" style={{ flexWrap: 'nowrap', gap: 8 }}>
              <input
                id="host-theme"
                className="tc-field"
                placeholder="e.g. baseball, Friends"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                maxLength={60}
                disabled={isCreating}
                data-testid="input-theme"
              />
              <PixelButton
                variant="magenta"
                size="sm"
                style={{ minHeight: 56 }}
                onClick={handleSuggest}
                disabled={trimmedTheme.length < 2 || isSuggesting || isCreating}
                data-testid="button-suggest-categories"
              >
                {isSuggesting && <PixelBusy />}
                Suggest
              </PixelButton>
            </div>
          </PixelFrame>
        )}

        <PixelFrame title="Category">
          <p className="tc-hint">Choose one or more topics for this room.</p>
          <PixelCategoryGrid
            categories={state.categories}
            selected={state.selectedCategories}
            counts={categoryCounts}
            onToggle={toggleCategory}
            disabled={isCreating}
          />
        </PixelFrame>

        <PixelFrame title="Number of Rounds">
          <p className="tc-hint">How many questions to play.</p>
          <PixelRoundPicker
            options={ROOM_ROUND_OPTIONS}
            value={state.numRounds}
            onChange={setNumRounds}
            disabled={isCreating}
          />
        </PixelFrame>

        <PixelFrame title="Dispute Voting">
          <div className="tc-row" style={{ flexWrap: 'nowrap', justifyContent: 'space-between' }}>
            <p className="tc-hint" id="opponent-dispute-voting-description">
              Opposing players vote on disputed incorrect answers; majority approval awards normal
              points.
            </p>
            <PixelSwitch
              checked={opponentDisputeVotingEnabled}
              onChange={setOpponentDisputeVotingEnabled}
              label="Opponent dispute voting"
              describedBy="opponent-dispute-voting-description"
              disabled={isCreating}
              testId="switch-opponent-dispute-voting"
            />
          </div>
        </PixelFrame>

        <PixelButton
          type="submit"
          variant="red"
          size="lg"
          block
          disabled={!isNicknameValid || isCreating}
          data-testid="button-create-room"
        >
          {isCreating ? (
            <>
              <PixelBusy />
              Creating Room...
            </>
          ) : (
            'Create Room'
          )}
        </PixelButton>
      </form>

      <div className="tc-row">
        <PixelButton variant="stone" size="sm" onClick={goHome}>
          Back
        </PixelButton>
      </div>
    </PixelScreen>
  );
}

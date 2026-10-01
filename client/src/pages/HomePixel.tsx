import { Link } from 'wouter';
import { QUESTIONS_PER_TEAM_ROTATION } from '@/lib/store';
import { useSoloSetup } from '@/hooks/use-solo-setup';
import { useAccount } from '@/hooks/use-account';
import {
  PixelAvatar,
  PixelButton,
  PixelFrame,
  PixelScreen,
  PixelWordmark,
  pixelButtonClass,
} from '@/components/pixel/Pixel';
import type { ModeChooserProps } from './Home';

// Pixel-art Home (STE-132), rendered by Home.tsx when VITE_PIXEL_UI is on.
// Behavior, copy and test ids match the classic Home; only the look differs.

const ROUND_OPTIONS = [5, 10, 15, 20];

export function PixelModeChooser({ rejoinSession, onPlaySolo, onHost, onJoin }: ModeChooserProps) {
  return (
    <PixelScreen>
      <PixelWordmark />
      <p className="tc-tagline">Trivia that everyone can play</p>

      <div className="tc-stack">
        {rejoinSession && (
          <Link
            href={`/room/${rejoinSession.code}`}
            className={pixelButtonClass({ variant: 'magenta', block: true })}
            data-testid="button-rejoin-room"
          >
            Rejoin game {rejoinSession.code}
          </Link>
        )}
        <PixelButton
          variant="coin"
          size="lg"
          block
          onClick={onPlaySolo}
          data-testid="button-mode-solo"
        >
          Play Solo
        </PixelButton>
        <PixelButton variant="red" block onClick={onHost} data-testid="button-mode-host">
          Host a Game
        </PixelButton>
        <PixelButton variant="green" block onClick={onJoin} data-testid="button-mode-join">
          Join a Game
        </PixelButton>
      </div>

      <AccountButtons />
    </PixelScreen>
  );
}

// Sign In / Sign Out, plus Admin for admins (STE-239). Shown on the mode
// chooser and on solo setup so the landing screen always offers sign-in.
function AccountButtons() {
  const { isAuthenticated, authLoading, isAdmin, accountName, logout, signIn, goToAdmin } =
    useAccount();
  if (authLoading) return null;
  return (
    <div className="tc-row">
      {isAdmin && (
        <PixelButton variant="green" size="sm" onClick={goToAdmin} data-testid="link-admin">
          Admin
        </PixelButton>
      )}
      {isAuthenticated ? (
        <PixelButton variant="stone" size="sm" onClick={() => logout()} data-testid="button-logout">
          Sign Out ({accountName})
        </PixelButton>
      ) : (
        <PixelButton variant="stone" size="sm" onClick={signIn} data-testid="button-login">
          Sign In
        </PixelButton>
      )}
    </div>
  );
}

const STATUS_PIP: Record<string, string> = {
  'Not Started': '#d83a2a',
  'In Progress': '#ffc92e',
  Completed: '#2e7c2e',
};

export function PixelSoloSetup() {
  const {
    state,
    removeTeam,
    toggleCategory,
    setNumRounds,
    authLoading,
    newTeamName,
    setNewTeamName,
    categoryCounts,
    totalNeeded,
    availableCount,
    hasInsufficientQuestions,
    insufficientSubject,
    handleAddTeam,
    handleStart,
    statusLabel,
  } = useSoloSetup();

  const allSelected = state.selectedCategories.length === 0;

  return (
    <PixelScreen>
      <PixelWordmark />
      <div className="tc-status tc-label">
        <span className="tc-pip" style={{ background: STATUS_PIP[statusLabel] }} />
        {statusLabel}
      </div>

      <PixelFrame title="Team Setup">
        <p className="tc-hint">Add 2-6 teams to begin.</p>
        <form onSubmit={handleAddTeam} className="tc-row" style={{ flexWrap: 'nowrap', gap: 8 }}>
          <label htmlFor="pixel-team-name" className="sr-only">
            Team name
          </label>
          <input
            id="pixel-team-name"
            className="tc-field"
            placeholder="Enter team name..."
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            autoFocus
          />
          <PixelButton
            type="submit"
            variant="red"
            size="sm"
            style={{ minHeight: 56 }}
            disabled={!newTeamName.trim() || state.teams.length >= 6}
          >
            Add Team
          </PixelButton>
        </form>

        <div className="tc-stack tc-scroll" style={{ gap: 8 }}>
          {state.teams.map((team, index) => (
            <div key={team.id} className="tc-sub tc-team">
              <PixelAvatar name={team.name} index={index} />
              <span className="tc-team__name">{team.name}</span>
              <PixelButton
                variant="stone"
                size="sm"
                onClick={() => removeTeam(team.id)}
                aria-label={`Remove ${team.name}`}
              >
                X
              </PixelButton>
            </div>
          ))}

          {state.teams.length === 0 && <div className="tc-empty">No teams added yet</div>}
        </div>
      </PixelFrame>

      <PixelFrame title="Category">
        <p className="tc-hint">Choose one or more topics for this round.</p>
        <div className="tc-grid-2 tc-scroll" style={{ maxHeight: 248 }}>
          <button
            type="button"
            className="tc-slot"
            aria-pressed={allSelected}
            onClick={() => toggleCategory('All')}
          >
            All <span className="tc-slot__count">({categoryCounts['All'] || 0})</span>
          </button>
          {state.categories
            .filter((c) => c !== 'All')
            .map((category) => (
              <button
                key={category}
                type="button"
                className="tc-slot"
                aria-pressed={state.selectedCategories.includes(category)}
                onClick={() => toggleCategory(category)}
              >
                {category} <span className="tc-slot__count">({categoryCounts[category] || 0})</span>
              </button>
            ))}
        </div>
      </PixelFrame>

      <PixelFrame title="Number of Rounds">
        <p className="tc-hint">How many questions to play.</p>
        <div className="tc-grid-4">
          {ROUND_OPTIONS.map((rounds) => (
            <button
              key={rounds}
              type="button"
              className="tc-slot"
              aria-pressed={state.numRounds === rounds}
              aria-label={`${rounds} rounds`}
              onClick={() => setNumRounds(rounds)}
            >
              <span className="tc-coin">
                <span className="tc-coin__face">{rounds}</span>
              </span>
            </button>
          ))}
        </div>
      </PixelFrame>

      {hasInsufficientQuestions && (
        <div className="tc-parchment" role="status" data-testid="warning-insufficient-questions">
          <p className="tc-parchment__title">Not enough questions</p>
          <p>
            {insufficientSubject} only <strong>{availableCount}</strong> question
            {availableCount !== 1 ? 's' : ''}, but your setup needs <strong>{totalNeeded}</strong> (
            {state.numRounds} rounds × {state.teams.length} teams × {QUESTIONS_PER_TEAM_ROTATION}{' '}
            questions/turn). The game will use all {availableCount} available.
          </p>
        </div>
      )}

      <PixelButton
        variant="red"
        size="lg"
        block
        disabled={state.teams.length < 2 || authLoading}
        onClick={handleStart}
        data-testid="button-start-game"
      >
        Start Game
      </PixelButton>

      <AccountButtons />
    </PixelScreen>
  );
}

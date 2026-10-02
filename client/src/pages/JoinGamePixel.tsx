import { useJoinGame } from '@/hooks/use-join-game';
import {
  PixelBusy,
  PixelButton,
  PixelFrame,
  PixelPageHeader,
  PixelScreen,
} from '@/components/pixel/Pixel';

// Pixel-art Join a Game (STE-231), rendered by JoinGame.tsx when VITE_PIXEL_UI
// is on. Behavior, copy and test ids match the classic page.
export default function JoinGamePixel() {
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
    goHome,
  } = useJoinGame();

  return (
    <PixelScreen>
      <PixelPageHeader title="Join a Game" />

      <form onSubmit={handleSubmit} className="tc-stack" style={{ gap: 24 }}>
        <PixelFrame title="Room Code">
          <label htmlFor="join-code" className="tc-hint" data-testid="text-code-hint">
            {showInviteHint
              ? 'Code filled in from your invite. Just add a nickname to join.'
              : 'Ask the host for the 5-character code.'}
          </label>
          <input
            id="join-code"
            className="tc-field tc-field--code"
            placeholder="ABCDE"
            value={code}
            onChange={handleCodeChange}
            autoFocus={!isPrefilled}
            maxLength={5}
            autoComplete="off"
            disabled={isJoining}
            data-testid="input-code"
          />
        </PixelFrame>

        <PixelFrame title="Your Nickname">
          <label htmlFor="join-nickname" className="tc-hint">
            Shown to other players in the room.
          </label>
          <input
            id="join-nickname"
            className="tc-field"
            placeholder="Enter your nickname..."
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoFocus={isPrefilled}
            maxLength={20}
            disabled={isJoining}
            data-testid="input-nickname"
          />
        </PixelFrame>

        <PixelButton
          type="submit"
          variant="green"
          size="lg"
          block
          disabled={!isCodeValid || !isNicknameValid || isJoining}
          data-testid="button-join-room"
        >
          {isJoining ? (
            <>
              <PixelBusy />
              Joining Room...
            </>
          ) : (
            'Join Room'
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

import type { Question, Team } from '@/lib/store';

interface Props {
  question: Question;
  activeTeam: Team;
  allTeams: Team[];
  questionNumber: number; // 1-based within the team's current rotation
  typedAnswer: string;
  onType: (val: string) => void;
  onSubmit: () => void;
  onPass: () => void;
}

function PixelAvatar({ variant }: { variant?: 'jane' }) {
  const baseStyle: React.CSSProperties = {
    width: 38,
    height: 38,
    flexShrink: 0,
    border: '3px solid var(--tc-ink)',
    position: 'relative',
    imageRendering: 'pixelated',
    background:
      variant === 'jane'
        ? 'linear-gradient(180deg, #ffd9a4 0 55%, #6f4ab8 55% 70%, #b23bb0 70% 100%)'
        : 'linear-gradient(180deg, #ffd9a4 0 55%, #c9572a 55% 70%, #2563b3 70% 100%)',
  };
  return (
    <div style={baseStyle}>
      {/* eyes — using a tiny inline svg so no pseudo-elements needed in TSX */}
      <svg
        aria-hidden="true"
        style={{ position: 'absolute', top: 8, left: 6, overflow: 'visible' }}
        width="4"
        height="4"
      >
        <rect width="4" height="4" fill="var(--tc-ink)" />
        <rect x="12" width="4" height="4" fill="var(--tc-ink)" />
      </svg>
      {/* hat sliver */}
      <div
        style={{
          position: 'absolute',
          inset: '-3px -3px auto -3px',
          height: 8,
          background: variant === 'jane' ? '#6f4ab8' : '#c9572a',
          borderBottom: '2px solid var(--tc-ink)',
        }}
      />
    </div>
  );
}

function ScoreTeam({
  team,
  avatarVariant,
  flip,
}: {
  team: Team;
  avatarVariant?: 'jane';
  flip?: boolean;
}) {
  const delta = team.lastRoundDelta;

  const avatar = <PixelAvatar variant={avatarVariant} />;
  const info = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div
        style={{
          fontFamily: 'var(--tc-font-pixel)',
          fontSize: 11,
          color: 'var(--tc-ink)',
          background: '#fff',
          border: '2px solid var(--tc-ink)',
          padding: '3px 7px',
          boxShadow: '2px 2px 0 0 var(--tc-ink)',
        }}
      >
        {delta > 0 ? `+${delta}` : delta}
      </div>
      <div
        style={{
          fontFamily: 'var(--tc-font-pixel)',
          fontSize: 14,
          color: 'var(--tc-coin-300)',
          textShadow: '2px 2px 0 var(--tc-ink)',
        }}
      >
        {team.score}
      </div>
    </div>
  );

  const nameEl = (
    <div
      style={{
        fontFamily: 'var(--tc-font-pixel)',
        fontSize: 9,
        color: '#fff',
        textShadow: '1px 1px 0 var(--tc-ink)',
        letterSpacing: '.04em',
        textAlign: 'center',
      }}
    >
      {team.name.toUpperCase().slice(0, 6)}
    </div>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {flip ? (
        <>
          {info}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            {avatar}
            {nameEl}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            {avatar}
            {nameEl}
          </div>
          {info}
        </>
      )}
    </div>
  );
}

export function QuestionScreen({
  question,
  activeTeam,
  allTeams,
  questionNumber,
  typedAnswer,
  onType,
  onSubmit,
  onPass,
}: Props) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && typedAnswer.trim()) onSubmit();
  };

  const isHard = question.difficulty === 'Hard';
  const isMedium = question.difficulty === 'Medium';

  const diffTagStyle: React.CSSProperties = isHard
    ? {
        background: 'var(--tc-red-500)',
        boxShadow:
          '3px 3px 0 0 var(--tc-ink), inset 2px 2px 0 0 var(--tc-red-300), inset -2px -2px 0 0 var(--tc-red-700)',
      }
    : isMedium
      ? {
          background: '#c47d00',
          boxShadow:
            '3px 3px 0 0 var(--tc-ink), inset 2px 2px 0 0 #f0a800, inset -2px -2px 0 0 #7a4d00',
        }
      : {
          background: '#2e7c2e',
          boxShadow:
            '3px 3px 0 0 var(--tc-ink), inset 2px 2px 0 0 #7fe26a, inset -2px -2px 0 0 #1a5c1f',
        };

  const diffIconStyle: React.CSSProperties = isHard
    ? {
        background: 'var(--tc-red-700)',
        boxShadow: 'inset 2px 2px 0 0 var(--tc-red-500), inset -2px -2px 0 0 #4b0a07',
        color: '#ffe89c',
      }
    : isMedium
      ? {
          background: '#7a4d00',
          boxShadow: 'inset 2px 2px 0 0 #f0a800, inset -2px -2px 0 0 #3a2200',
          color: '#ffe89c',
        }
      : {
          background: '#1a5c1f',
          boxShadow: 'inset 2px 2px 0 0 #7fe26a, inset -2px -2px 0 0 #0a2a0a',
          color: '#ffe89c',
        };

  const [leftTeam, rightTeam] =
    allTeams.length >= 2
      ? [allTeams[0], allTeams[1]]
      : allTeams.length === 1
        ? [allTeams[0], null]
        : [null, null];

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        maxWidth: 480,
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Sky backdrop */}
      <div className="tc-sky-bg" />

      {/* iOS-style status bar */}
      <div
        style={{
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          fontFamily: 'var(--tc-font-pixel)',
          fontSize: 10,
          color: 'var(--tc-ink)',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <span>●●●●○ 📶</span>
        <span>9:41</span>
        <span>▭▭▭</span>
      </div>

      {/* Top row: tags + active team */}
      <div
        style={{
          padding: '10px 16px 0',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          alignItems: 'start',
          gap: 12,
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Category + difficulty tags */}
        <div
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}
        >
          {/* Category tag */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--tc-font-pixel)',
              fontSize: 11,
              letterSpacing: '.04em',
              color: '#fff',
              textShadow: '1px 1px 0 var(--tc-ink)',
              background: 'var(--tc-panel-300)',
              border: '3px solid var(--tc-ink)',
              padding: '6px 12px 6px 6px',
              boxShadow:
                '3px 3px 0 0 var(--tc-ink), inset 2px 2px 0 0 var(--tc-panel-100), inset -2px -2px 0 0 var(--tc-panel-500)',
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--tc-panel-400)',
                border: '2px solid var(--tc-ink)',
                boxShadow:
                  'inset 2px 2px 0 0 var(--tc-panel-200), inset -2px -2px 0 0 var(--tc-panel-600)',
                fontSize: 14,
                color: 'var(--tc-coin-300)',
                lineHeight: 1,
              }}
            >
              ▣
            </span>
            {question.category}
          </span>

          {/* Difficulty tag */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--tc-font-pixel)',
              fontSize: 11,
              letterSpacing: '.04em',
              color: '#fff',
              textShadow: '1px 1px 0 var(--tc-ink)',
              border: '3px solid var(--tc-ink)',
              padding: '6px 12px 6px 6px',
              ...diffTagStyle,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                display: 'grid',
                placeItems: 'center',
                border: '2px solid var(--tc-ink)',
                fontSize: 14,
                lineHeight: 1,
                ...diffIconStyle,
              }}
            >
              ▤
            </span>
            {question.difficulty}
          </span>
        </div>

        {/* Active team panel */}
        <div
          style={{
            background: 'var(--tc-panel-300)',
            border: '4px solid var(--tc-ink)',
            boxShadow:
              '4px 4px 0 0 var(--tc-ink), inset 3px 3px 0 0 var(--tc-panel-100), inset -3px -3px 0 0 var(--tc-panel-500)',
            justifySelf: 'end',
            width: '100%',
            maxWidth: 200,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--tc-font-pixel)',
              fontSize: 11,
              letterSpacing: '.05em',
              color: '#fff',
              textShadow: '2px 2px 0 var(--tc-ink)',
              textAlign: 'center',
              padding: '6px 0 5px',
              background: 'var(--tc-panel-400)',
              borderBottom: '3px solid var(--tc-ink)',
              boxShadow:
                'inset 0 -3px 0 0 var(--tc-panel-600), inset 0 3px 0 0 var(--tc-panel-200)',
            }}
          >
            ACTIVE TEAM
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
            <PixelAvatar />
            <div>
              <div
                style={{
                  fontFamily: 'var(--tc-font-pixel)',
                  fontSize: 12,
                  color: '#fff',
                  textShadow: '2px 2px 0 var(--tc-ink)',
                  lineHeight: 1.1,
                }}
              >
                {activeTeam.name}
              </div>
              <div
                style={{
                  fontFamily: 'var(--tc-font-body)',
                  fontSize: 18,
                  color: 'var(--tc-sky-200)',
                  lineHeight: 1,
                  marginTop: 4,
                }}
              >
                Question {questionNumber}/4
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Question card */}
      <div
        style={{
          padding: '22px 18px 0',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div
          style={{
            background: 'var(--tc-panel-300)',
            border: '4px solid var(--tc-ink)',
            boxShadow:
              '6px 6px 0 0 var(--tc-ink), inset 3px 3px 0 0 var(--tc-panel-100), inset -3px -3px 0 0 var(--tc-panel-500)',
            padding: '22px 18px',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--tc-font-body)',
              fontSize: 26,
              lineHeight: 1.15,
              textAlign: 'center',
              color: '#fff',
              textShadow: '2px 2px 0 var(--tc-ink)',
              padding: '4px 4px 18px',
            }}
          >
            {question.question}
          </div>

          <input
            style={{
              fontFamily: 'var(--tc-font-body)',
              fontSize: 22,
              color: '#fff',
              background: '#1a3f8e',
              border: '3px solid var(--tc-ink)',
              padding: '10px 14px',
              width: '100%',
              outline: 'none',
              boxShadow: 'inset 3px 3px 0 0 #0e2858, inset -3px -3px 0 0 var(--tc-panel-200)',
            }}
            placeholder="Type answer here…"
            value={typedAnswer}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />

          <div
            style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12 }}
          >
            <button
              type="button"
              onClick={onPass}
              style={{
                fontFamily: 'var(--tc-font-pixel)',
                fontSize: 14,
                letterSpacing: '.04em',
                color: 'var(--tc-stone-700)',
                textShadow: '2px 2px 0 var(--tc-stone-100)',
                background: 'var(--tc-stone-300)',
                border: '3px solid var(--tc-ink)',
                cursor: 'pointer',
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 56,
                padding: '10px 14px',
                boxShadow:
                  '4px 4px 0 0 var(--tc-ink), inset 3px 3px 0 0 var(--tc-stone-100), inset -3px -3px 0 0 var(--tc-stone-500)',
                transition: 'transform 60ms steps(2), box-shadow 60ms steps(2)',
              }}
            >
              PASS
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!typedAnswer.trim()}
              style={{
                fontFamily: 'var(--tc-font-pixel)',
                fontSize: 16,
                letterSpacing: '.04em',
                color: '#fff',
                textShadow: '2px 2px 0 var(--tc-ink)',
                background: 'var(--tc-magenta-500)',
                border: '3px solid var(--tc-ink)',
                cursor: typedAnswer.trim() ? 'pointer' : 'not-allowed',
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                lineHeight: 1.05,
                minHeight: 56,
                padding: '10px 14px',
                boxShadow:
                  '4px 4px 0 0 var(--tc-ink), inset 3px 3px 0 0 var(--tc-magenta-300), inset -3px -3px 0 0 var(--tc-magenta-700)',
                transition: 'transform 60ms steps(2), box-shadow 60ms steps(2)',
                opacity: typedAnswer.trim() ? 1 : 0.55,
              }}
            >
              SUBMIT
              <br />
              ANSWER
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 24 }} />
      </div>

      {/* Scoreboard */}
      <div
        style={{
          marginTop: 16,
          background: 'var(--tc-panel-400)',
          borderTop: '4px solid var(--tc-ink)',
          boxShadow: 'inset 0 3px 0 0 var(--tc-panel-200)',
          padding: '10px 16px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          position: 'relative',
          zIndex: 2,
        }}
      >
        {leftTeam && <ScoreTeam team={leftTeam} />}
        <div style={{ flex: 1 }} />
        {rightTeam && <ScoreTeam team={rightTeam} avatarVariant="jane" flip />}
      </div>
    </div>
  );
}

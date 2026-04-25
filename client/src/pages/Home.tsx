import { useState } from 'react';
import { useLocation } from 'wouter';
import { useGame } from '@/lib/store';
import { PIXEL_UI } from '@/lib/featureFlags';
import HomeClassic from './HomeClassic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  SNES_COLORS,
  CAP_COLORS,
  SKY_GRADIENT,
  pixelText,
  teamRow,
  btnBase,
  CloudKingdomBg,
  BevelButton,
  GamePanel,
  GamePanelHeader,
  CSSAvatar,
  StatusOrb,
} from '@/components/snes';

function HomeSnes() {
  const [_, setLocation] = useLocation();
  const { state, addTeam, removeTeam, startGame } = useGame();
  const [newTeamName, setNewTeamName] = useState('');

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

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-between pb-8 pt-12 overflow-y-auto"
      style={{ background: SKY_GRADIENT, fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <CloudKingdomBg />

      {/* ── Header: 3D Bubbly Gold Title (SVG) ── */}
      <header className="w-full flex justify-center mb-4 z-10 px-4">
        <div className="w-full max-w-md">
          <h1 className="sr-only">TRIVIA CLASH</h1>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 800 450"
            width="100%"
            aria-hidden="true"
          >
            <defs>
              <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=swap');
                .title-text {
                  font-family: 'Luckiest Guy', sans-serif;
                  text-anchor: middle;
                  dominant-baseline: central;
                  letter-spacing: 2px;
                }
                .word-top { font-size: 130px; }
                .word-bottom { font-size: 155px; }
                .layer-shadow {
                  fill: #15295e;
                  stroke: #15295e;
                  stroke-width: 45px;
                  stroke-linejoin: round;
                }
                .layer-extrusion {
                  fill: #2d62c3;
                  stroke: #2d62c3;
                  stroke-width: 45px;
                  stroke-linejoin: round;
                }
                .layer-outline {
                  fill: #15295e;
                  stroke: #15295e;
                  stroke-width: 16px;
                  stroke-linejoin: round;
                }
                .layer-face {
                  fill: url(#goldGradient);
                }
              `}</style>
              <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffee73" />
                <stop offset="35%" stopColor="#ffc824" />
                <stop offset="70%" stopColor="#fa9c00" />
                <stop offset="100%" stopColor="#e36300" />
              </linearGradient>
            </defs>
            <g transform="translate(400, 140)" role="text" aria-label="TRIVIA">
              <text className="title-text word-top layer-shadow" y="22">
                TRIVIA
              </text>
              <text className="title-text word-top layer-extrusion" y="11">
                TRIVIA
              </text>
              <text className="title-text word-top layer-outline" y="0">
                TRIVIA
              </text>
              <text className="title-text word-top layer-face" y="0">
                TRIVIA
              </text>
            </g>
            <g transform="translate(400, 270)" role="text" aria-label="CLASH">
              <text className="title-text word-bottom layer-shadow" y="22">
                CLASH
              </text>
              <text className="title-text word-bottom layer-extrusion" y="11">
                CLASH
              </text>
              <text className="title-text word-bottom layer-outline" y="0">
                CLASH
              </text>
              <text className="title-text word-bottom layer-face" y="0">
                CLASH
              </text>
            </g>
          </svg>
        </div>
      </header>

      {/* ── Team Setup Panel ── */}
      <GamePanel className="w-11/12 max-w-md flex flex-col z-10">
        <GamePanelHeader>TEAM SETUP</GamePanelHeader>

        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {state.teams.map((team, i) => (
              <motion.div
                key={team.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <div className="mb-1 pl-3" style={{ ...pixelText, fontSize: 16 }}>
                  TEAM {i + 1}
                </div>
                <div
                  className="flex items-center justify-between relative overflow-hidden"
                  style={{ ...teamRow, minHeight: 64, padding: '10px 12px' }}
                >
                  {/* Diagonal shine overlay */}
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      right: 120,
                      top: 0,
                      width: 70,
                      height: '100%',
                      background:
                        'linear-gradient(135deg, transparent 0% 30%, rgba(255,255,255,.05) 30% 55%, transparent 55%)',
                      opacity: 0.6,
                    }}
                  />
                  <div className="flex items-center gap-3 min-w-0">
                    <CSSAvatar capColor={CAP_COLORS[i % CAP_COLORS.length]} />
                    <span
                      className="font-extrabold truncate"
                      style={{
                        color: '#fff',
                        fontSize: 14,
                        textShadow: '0 2px 0 rgba(0,0,0,.32)',
                        maxWidth: 140,
                      }}
                    >
                      {team.name}
                    </span>
                  </div>
                  <div className="flex flex-col items-start gap-2 ml-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <StatusOrb />
                      <span
                        style={{ ...pixelText, fontSize: 12, WebkitTextStroke: '1.5px #11204d' }}
                      >
                        NOT STARTED
                      </span>
                    </div>
                    <button
                      onClick={() => removeTeam(team.id)}
                      className="active:translate-y-1"
                      style={{
                        ...btnBase,
                        fontSize: 13,
                        WebkitTextStroke: '1.5px #5b0005',
                        textShadow: '0 3px 0 rgba(0,0,0,.25)',
                        background: `linear-gradient(180deg, ${SNES_COLORS.red1} 0%, ${SNES_COLORS.red2} 55%, ${SNES_COLORS.red3} 100%)`,
                        padding: '6px 16px',
                        width: 110,
                      }}
                    >
                      REMOVE
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {state.teams.length === 0 && (
            <div
              className="text-center py-8"
              style={{ ...pixelText, fontSize: 14, color: 'rgba(255,255,255,0.4)' }}
            >
              NO TEAMS YET
            </div>
          )}

          <div>
            <div className="mb-1 pl-3" style={{ ...pixelText, fontSize: 16 }}>
              ADD TEAM
            </div>
            <form
              onSubmit={handleAddTeam}
              className="flex items-center justify-between"
              style={{ ...teamRow, minHeight: 64, padding: '10px 12px' }}
            >
              <input
                placeholder="TEAM NAME..."
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="bg-transparent outline-none flex-1 min-w-0 mr-3"
                style={{
                  ...pixelText,
                  fontSize: 14,
                  WebkitTextStroke: '0px transparent',
                  textShadow: 'none',
                  color: '#fff',
                  borderBottom: '2px solid rgba(255,255,255,.2)',
                  padding: '4px 0',
                }}
                autoFocus
              />
              <button
                type="submit"
                disabled={!newTeamName.trim() || state.teams.length >= 6}
                className="active:translate-y-1 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                style={{
                  ...btnBase,
                  fontSize: 13,
                  WebkitTextStroke: '1.5px #5b0005',
                  textShadow: '0 3px 0 rgba(0,0,0,.25)',
                  background: `linear-gradient(180deg, ${SNES_COLORS.red1} 0%, ${SNES_COLORS.red2} 55%, ${SNES_COLORS.red3} 100%)`,
                  padding: '6px 16px',
                  width: 110,
                }}
              >
                ADD TEAM
              </button>
            </form>
          </div>
        </div>
      </GamePanel>

      {/* ── Primary Action Buttons ── */}
      <section className="w-11/12 max-w-md flex items-end justify-between gap-3 mt-4 z-10">
        <BevelButton
          className="disabled:opacity-40 disabled:cursor-not-allowed"
          bgTop="#fdd835"
          bgBottom="#e08a0e"
          borderColor="#8b5e0a"
          highlightColor="rgba(255,245,180,.55)"
          shadowColor="rgba(120,70,0,.5)"
          width="60%"
          height={86}
          fontSize={20}
          disabled={state.teams.length < 2}
          onClick={handleStart}
          data-testid="button-start-game"
        >
          QUICK
          <br />
          PLAY
        </BevelButton>

        <BevelButton
          bgTop="#5cdb5c"
          bgBottom="#238b23"
          borderColor="#145214"
          highlightColor="rgba(200,255,200,.45)"
          shadowColor="rgba(10,60,10,.5)"
          width="38%"
          height={56}
          fontSize={14}
          onClick={() => setLocation('/admin')}
          data-testid="link-admin"
        >
          ADMIN
        </BevelButton>
      </section>
    </main>
  );
}

export default function Home() {
  return PIXEL_UI ? <HomeSnes /> : <HomeClassic />;
}

import { gamePanel, panelHeader, pixelText } from './tokens';

/** Blue gradient SNES window panel */
export function GamePanel({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={className} style={{ ...gamePanel, padding: '18px 14px 20px', ...style }}>
      {children}
    </section>
  );
}

/** Panel section header bar */
export function GamePanelHeader({
  children,
  height = 52,
}: {
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <div className="grid place-items-center mb-4" style={{ ...panelHeader, height }}>
      <h2
        style={{
          ...pixelText,
          fontSize: height > 44 ? 26 : 18,
          WebkitTextStroke: height > 44 ? '3px #11204d' : '2px #11204d',
        }}
      >
        {children}
      </h2>
    </div>
  );
}

/** Full Cloud Kingdom background scene — clouds, islands, and bottom haze */
export function CloudKingdomBg() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Fluffy clouds */}
      <Cloud
        style={{ width: 82, height: 23, left: -4, top: '14%' }}
        bumps={[
          { w: 30, h: 30, left: 5, top: -13 },
          { w: 35, h: 35, left: 28, top: -16 },
        ]}
      />
      <Cloud
        style={{ width: 105, height: 25, right: -4, top: '12%' }}
        bumps={[
          { w: 32, h: 32, left: 8, top: -14 },
          { w: 41, h: 41, left: 30, top: -19 },
        ]}
      />
      <Cloud
        style={{ width: 82, height: 23, left: '32%', top: '32%', opacity: 0.92 }}
        bumps={[
          { w: 27, h: 27, left: 11, top: -12 },
          { w: 35, h: 35, left: 30, top: -17 },
        ]}
      />
      <Cloud
        style={{ width: 135, height: 34, left: -22, bottom: '16%', opacity: 0.9 }}
        bumps={[
          { w: 46, h: 46, left: 14, top: -19 },
          { w: 58, h: 58, left: 43, top: -25 },
        ]}
      />
      <Cloud
        style={{ width: 120, height: 31, right: -20, bottom: '26%', opacity: 0.9 }}
        bumps={[
          { w: 43, h: 43, left: 14, top: -18 },
          { w: 55, h: 55, left: 48, top: -23 },
        ]}
      />

      {/* Floating islands */}
      <Island style={{ right: 20, top: '22%', transform: 'scale(.5)' }} />
      <Island style={{ left: -5, bottom: '30%', transform: 'scale(.62)' }} />
      <Island style={{ right: -5, bottom: '24%', transform: 'scale(.9) rotate(-2deg)' }} />

      {/* Bottom haze */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          height: '28%',
          background:
            'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.10) 30%, rgba(255,255,255,.28) 100%)',
        }}
      />
    </div>
  );
}

/* ── Private helpers ── */

function Cloud({
  style,
  bumps,
}: {
  style: React.CSSProperties;
  bumps: { w: number; h: number; left: number; top: number }[];
}) {
  const cloudStyle: React.CSSProperties = {
    ...style,
    position: 'absolute',
    background: '#f7fcff',
    borderRadius: 999,
    boxShadow: 'inset 0 -4px 0 rgba(190,220,245,.85)',
  };
  return (
    <div style={cloudStyle}>
      {bumps.map((b, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: b.w,
            height: b.h,
            left: b.left,
            top: b.top,
            background: 'inherit',
            borderRadius: 'inherit',
            boxShadow: 'inherit',
          }}
        />
      ))}
    </div>
  );
}

function Island({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute"
      style={{
        ...style,
        width: 85,
        height: 55,
        background:
          'linear-gradient(180deg, #8cd44d 0%, #57ab39 32%, #63a83d 35%, #8e5d3c 36%, #8e5d3c 55%, #71452e 100%)',
        clipPath:
          'polygon(5% 28%, 23% 8%, 62% 8%, 82% 30%, 96% 35%, 100% 53%, 91% 76%, 72% 90%, 34% 100%, 10% 84%, 0 57%)',
        filter: 'drop-shadow(0 5px 0 rgba(0,0,0,.18))',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 20,
          top: -9,
          width: 11,
          height: 19,
          background: '#7d5a35',
          borderRadius: '50% 50% 35% 35%',
          boxShadow: '1px 0 0 rgba(0,0,0,.08)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 12,
          top: -17,
          width: 27,
          height: 16,
          background: '#63ad45',
          borderRadius: '50% 50% 35% 35%',
          boxShadow: '7px 1px 0 -5px #76bf54',
        }}
      />
    </div>
  );
}

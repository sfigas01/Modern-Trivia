/** 32×32 CSS-only character sprite with colored cap */
export function CSSAvatar({ capColor }: { capColor: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 3,
        background: 'linear-gradient(180deg, #8fb3ff 0%, #5d7fd8 100%)',
        border: '2px solid rgba(0,0,0,.15)',
        position: 'relative',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.18)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 5,
          top: 5,
          width: 22,
          height: 10,
          borderRadius: '10px 10px 3px 3px',
          background: capColor,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 6,
          top: 11,
          width: 16,
          height: 3,
          borderRadius: 2,
          background: 'rgba(0,0,0,.2)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 8,
          top: 10,
          width: 16,
          height: 14,
          background: '#f1c292',
          borderRadius: '7px 7px 5px 5px',
          boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.08)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 9,
          top: 18,
          width: 12,
          height: 4,
          borderRadius: 4,
          background: '#6a3d19',
        }}
      />
    </div>
  );
}

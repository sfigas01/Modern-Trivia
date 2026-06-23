/** Red radial-gradient status indicator (14px) */
export function StatusOrb() {
  return (
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        background:
          'radial-gradient(circle at 35% 35%, #ff8f8f 0%, #fa3232 45%, #b00010 80%, #7f000e 100%)',
        boxShadow: '0 0 0 2px rgba(255,255,255,.06), 0 2px 6px rgba(255,0,0,.35)',
      }}
    />
  );
}

import { FONT_STACKS } from './tokens';

/** Beveled pixel-art button with Press Start 2P font and two-tone gradient */
export function BevelButton({
  children,
  bgTop,
  bgBottom,
  borderColor,
  highlightColor,
  shadowColor,
  width,
  height,
  fontSize,
  className = '',
  ...rest
}: {
  children: React.ReactNode;
  bgTop: string;
  bgBottom: string;
  borderColor: string;
  highlightColor: string;
  shadowColor: string;
  width: string | number;
  height: number;
  fontSize: number;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`active:translate-y-1 cursor-pointer ${className}`}
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: 6,
        border: `4px solid ${borderColor}`,
        background: `linear-gradient(180deg, ${bgTop} 0%, ${bgTop} 48%, ${bgBottom} 52%, ${bgBottom} 100%)`,
        boxShadow: `
          0 6px 0 ${borderColor},
          inset 0 3px 0 ${highlightColor},
          inset 0 -3px 0 ${shadowColor}
        `,
        cursor: 'pointer',
        transition: 'transform 0.1s',
        padding: 0,
        display: 'grid',
        placeItems: 'center',
      }}
      {...rest}
    >
      <span
        style={{
          fontFamily: FONT_STACKS.pixel,
          fontSize,
          lineHeight: 1.4,
          color: '#fff',
          textShadow: `
            -2px -2px 0 ${borderColor},
             2px -2px 0 ${borderColor},
            -2px  2px 0 ${borderColor},
             2px  2px 0 ${borderColor},
             0   -2px 0 ${borderColor},
             0    2px 0 ${borderColor},
            -2px  0   0 ${borderColor},
             2px  0   0 ${borderColor},
             0    4px 0 rgba(0,0,0,.25)
          `,
          textTransform: 'uppercase' as const,
          textAlign: 'center' as const,
          letterSpacing: 1,
        }}
      >
        {children}
      </span>
    </button>
  );
}

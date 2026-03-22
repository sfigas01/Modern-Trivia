import { useTheme } from '@/lib/theme-provider';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-2 flex-wrap justify-center">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          className={cn(
            'px-4 py-2 text-sm font-medium border-2 transition-colors',
            'rounded-md',
            theme === t.id
              ? 'border-primary bg-primary/20 text-primary'
              : 'border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:text-foreground'
          )}
        >
          <span className="block font-bold">{t.label}</span>
          <span className="block text-xs opacity-70">{t.description}</span>
        </button>
      ))}
    </div>
  );
}

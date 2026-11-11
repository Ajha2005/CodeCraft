import { useTheme } from '../lib/theme';
import { sfx } from '../lib/sfx';
import { Icon } from './ui/Icon';

/**
 * Light / dark switch. A sun and a moon trade places inside one button, so the
 * state is obvious at a glance; the label spells out what a click will do.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { isLight, toggle } = useTheme();
  const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      onClick={() => {
        sfx.play('click');
        toggle();
      }}
      aria-label={label}
      title={label}
      className={`relative flex h-8 w-8 shrink-0 sm:h-9 sm:w-9 items-center justify-center overflow-hidden rounded-lg border transition-all hover:scale-105 active:scale-95 ${
        isLight
          ? 'border-amber-400/60 bg-amber-300/20 text-amber-500 shadow-[0_0_14px_-4px_rgba(245,158,11,0.7)]'
          : 'border-indigo-300/40 bg-indigo-400/10 text-indigo-200 hover:border-indigo-300/70'
      } ${className}`}
    >
      <Icon
        name="sun"
        className={`absolute h-[18px] w-[18px] transition-all duration-500 ease-out ${isLight ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'}`}
      />
      <Icon
        name="moon"
        filled
        className={`absolute h-[17px] w-[17px] transition-all duration-500 ease-out ${isLight ? '-rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'}`}
      />
    </button>
  );
}

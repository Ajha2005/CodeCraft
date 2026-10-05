import { useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { Icon } from './ui/Icon';

/**
 * The strip across the top of a demo visit. It stays put on every page so a
 * visitor always knows nothing they do here is saved, and has one click to a
 * real sign-in. It also tells the page layout it is there (--banner-h).
 */
export function DemoBanner() {
  const { logout } = useAuth();

  useEffect(() => {
    document.documentElement.dataset.demo = 'true';
    return () => {
      delete document.documentElement.dataset.demo;
    };
  }, []);

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-amber-400/30 bg-amber-950/70 px-3 text-amber-100 backdrop-blur-xl sm:px-6 md:px-8"
      style={{ height: 'var(--banner-h)' }}
    >
      <p className="flex min-w-0 items-center gap-2 text-xs font-semibold leading-tight">
        <Icon name="lock" className="h-3.5 w-3.5 shrink-0 text-amber-300" />
        <span className="truncate">
          <span className="uppercase tracking-[0.14em]">Demo mode: read-only.</span>
          <span className="hidden font-normal text-amber-200/80 md:inline"> Nothing you do here is saved. Browse, run code on the examples and explore the map.</span>
        </span>
      </p>
      <button
        type="button"
        onClick={logout}
        className="shrink-0 rounded-md border border-amber-300/50 px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide text-amber-100 transition-colors hover:bg-amber-300/15"
      >
        Sign in with a Thapar ID
      </button>
    </div>
  );
}

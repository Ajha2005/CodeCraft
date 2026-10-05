import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/ui/Icon';
import { useAuth } from './useAuth';

interface GuestGateProps {
  icon: IconName;
  title: string;
  body: string;
  children: ReactNode;
}

/**
 * For the pages that only mean something to a real account (duels, the personal
 * campaign report): a signed-in player gets the page, a demo visitor gets a
 * short explanation and a way to sign in.
 */
export function GuestGate({ icon, title, body, children }: GuestGateProps) {
  const { isGuest, logout } = useAuth();
  if (!isGuest) return <>{children}</>;

  return (
    <div className="hud-grid-bg flex min-h-[calc(100dvh-var(--nav-h))] flex-1 items-center justify-center px-4 py-10">
      <div className="hud-panel relative z-10 w-full max-w-md p-7 text-center animate-fade-in-up">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/40 bg-cyan-400/10 text-cyan-300">
          <Icon name={icon} className="h-7 w-7" />
        </div>
        <h1 className="font-display mt-4 text-3xl font-bold tracking-wide text-slate-50">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
        <p className="mt-1 text-xs text-slate-500">The demo is read-only, so this part needs a Thapar ID.</p>
        <button type="button" onClick={logout} className="btn-primary mt-6 h-11 rounded-lg px-6 text-sm">
          Sign in with a Thapar ID
        </button>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { usePlayerStats } from '../lib/playerStatsContext';
import { sfx } from '../lib/sfx';
import { LevelBadge } from './ui/LevelBadge';

/** Full-screen celebration when the player's level goes up. */
export function LevelUpOverlay() {
  const { levelUp, dismissLevelUp } = usePlayerStats();

  useEffect(() => {
    if (!levelUp) return;
    sfx.play('levelup');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      confetti({ particleCount: 140, spread: 100, origin: { y: 0.55 }, colors: ['#fbbf24', '#22d3ee', '#e879f9', '#34d399'], zIndex: 300 });
      const t = setTimeout(() => confetti({ particleCount: 90, spread: 140, startVelocity: 38, origin: { y: 0.45 }, zIndex: 300 }), 350);
      const auto = setTimeout(dismissLevelUp, 7000);
      return () => {
        clearTimeout(t);
        clearTimeout(auto);
      };
    }
    const auto = setTimeout(dismissLevelUp, 7000);
    return () => clearTimeout(auto);
  }, [levelUp, dismissLevelUp]);

  if (!levelUp) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in-up" onClick={dismissLevelUp} role="dialog" aria-label="Level up">
      <div className="relative flex max-w-sm flex-col items-center text-center">
        <div
          className="pointer-events-none absolute left-1/2 top-[7.5rem] h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 opacity-60 animate-spin-slow"
          style={{ background: 'repeating-conic-gradient(from 0deg, rgba(251,191,36,0.3) 0deg 6deg, transparent 6deg 20deg)', maskImage: 'radial-gradient(circle, black 15%, transparent 68%)', WebkitMaskImage: 'radial-gradient(circle, black 15%, transparent 68%)' }}
        />
        <div style={{ animation: 'level-burst 0.8s cubic-bezier(0.34,1.56,0.64,1) both' }}>
          <LevelBadge level={levelUp.to} size={150} />
        </div>
        <p className="font-display relative mt-6 text-5xl font-bold uppercase tracking-[0.2em] text-amber-200 drop-shadow-[0_0_24px_rgba(251,191,36,0.8)]">Level up!</p>
        <p className="relative mt-2 text-lg text-slate-200">
          Level {levelUp.from} <span className="mx-1 text-amber-300">→</span> <span className="font-bold text-white">Level {levelUp.to}</span>
        </p>
        <p className="font-display relative mt-1 text-sm font-bold uppercase tracking-[0.3em] text-cyan-300">New heights reached</p>
        <button type="button" className="btn-primary relative mt-7 h-11 rounded-lg px-8 text-sm" onClick={dismissLevelUp}>
          Keep conquering
        </button>
      </div>
    </div>
  );
}

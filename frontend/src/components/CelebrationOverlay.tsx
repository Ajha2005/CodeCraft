import { useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { useAuth } from '../auth/useAuth';
import { useTerritoryCells } from '../features/map/hooks/useTerritoryCells';
import type { Celebration } from '../lib/celebrations';
import { usePlayerStats } from '../lib/playerStatsContext';
import { sfx } from '../lib/sfx';
import { TIER_META } from '../lib/tiers';
import { CellMiniMap } from './ui/CellMiniMap';
import { Icon, type IconName } from './ui/Icon';
import { StreakFlame } from './ui/StreakFlame';
import type { AwardedCell } from '../features/problems/api';

const AUTO_DISMISS_MS = 9000;

interface Look {
  /** Small caps line above the title. */
  eyebrow: string;
  title: string;
  body: string;
  color: string;
  icon: IconName;
  sound: 'discover' | 'capture' | 'levelup';
  /** [colours] for the confetti; defaults to a mix of the main colour. */
  confetti: string[];
}

function lookOf(c: Celebration, flavor: boolean): Look {
  switch (c.kind) {
    case 'achievement':
      return {
        eyebrow: 'Achievement unlocked',
        title: c.achievement.name,
        body: c.achievement.description,
        color: c.achievement.color,
        icon: c.achievement.icon,
        sound: 'discover',
        confetti: [c.achievement.color, '#ffffff', '#fbbf24'],
      };
    case 'first-cell': {
      const meta = TIER_META[c.tier];
      return {
        eyebrow: 'First cell',
        title: flavor ? 'Your flag is planted' : 'First cell claimed',
        body: c.cell
          ? `${c.cell.territoryName} · row ${c.cell.row + 1}, column ${c.cell.col + 1}. Every empire starts with one cell.`
          : `A ${meta.label} cell is yours. Every empire starts with one cell.`,
        color: meta.accent === '#94a3b8' ? '#22d3ee' : meta.accent,
        icon: 'flag',
        sound: 'capture',
        confetti: ['#22d3ee', '#ffffff', meta.accent],
      };
    }
    case 'tier-first': {
      const meta = TIER_META[c.tier];
      return {
        eyebrow: `First ${meta.label} cell`,
        title: flavor ? `${meta.label} secured` : `${meta.label} cell claimed`,
        body: c.cell ? `${c.cell.territoryName} · row ${c.cell.row + 1}, column ${c.cell.col + 1}. ${meta.blurb}` : meta.blurb,
        color: meta.accent,
        icon: 'shield',
        sound: 'capture',
        confetti: [meta.accent, '#ffffff', '#fbbf24'],
      };
    }
    case 'majority':
      return {
        eyebrow: 'Zone majority',
        title: flavor ? `${c.zone.name} is yours` : `Majority in ${c.zone.name}`,
        body: `You hold ${c.zone.held} of ${c.zone.total} cells there. Rivals have to come through you now.`,
        color: '#fbbf24',
        icon: 'crown',
        sound: 'levelup',
        confetti: ['#fbbf24', '#ffffff', '#f97316'],
      };
    case 'streak':
      return {
        eyebrow: `${c.days}-day streak`,
        title: `${c.stage.name}!`,
        body: c.stage.blurb,
        color: c.stage.glow,
        icon: 'flame',
        sound: 'levelup',
        confetti: [c.stage.glow, c.stage.inner[0], '#ffffff'],
      };
  }
}

/** The cell's zone, drawn with the cell lit up. Pulls the zone grid from the live map data. */
function CellPicture({ cell, color }: { cell: AwardedCell; color: string }) {
  const { cellsByTerritory } = useTerritoryCells();
  const cells = cellsByTerritory[cell.territoryId] ?? [];
  if (cells.length === 0) return null;
  return <CellMiniMap cells={cells} highlight={{ row: cell.row, col: cell.col }} highlightColor={color} maxWidth={210} className="mx-auto mt-5" />;
}

/**
 * One celebration at a time, full screen: the thing you just earned, big, with
 * a burst of confetti in its colour. Waits for a level-up to finish first, and
 * queued ones follow each other.
 */
export function CelebrationOverlay() {
  const { celebration, celebrationsWaiting, dismissCelebration, levelUp } = usePlayerStats();
  const { user, flavorTextEnabled } = useAuth();
  const active = levelUp ? null : celebration;
  const look = active ? lookOf(active, flavorTextEnabled) : null;
  const activeId = active?.id ?? null;
  const confettiColors = look?.confetti;
  const sound = look?.sound;

  useEffect(() => {
    if (!activeId || !sound) return;
    sfx.play(sound);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      confetti({ particleCount: 110, spread: 85, origin: { y: 0.58 }, colors: confettiColors, zIndex: 300 });
    }
    const auto = setTimeout(dismissCelebration, AUTO_DISMISS_MS);
    return () => clearTimeout(auto);
    // keyed on the celebration itself: a re-render must not replay the burst
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  if (!active || !look) return null;

  const awarded: AwardedCell | null = active.kind === 'first-cell' || active.kind === 'tier-first' ? active.cell : null;

  return (
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in-up"
      onClick={dismissCelebration}
      role="dialog"
      aria-label={`${look.eyebrow}: ${look.title}`}
    >
      <div
        key={active.id}
        className="relative flex w-full max-w-sm flex-col items-center text-center"
        onClick={(e) => e.stopPropagation()}
        style={{ ['--celebrate' as string]: look.color } as CSSProperties}
      >
        <div
          className="pointer-events-none absolute left-1/2 top-[4.5rem] h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 opacity-50 animate-spin-slow"
          style={{
            background: `repeating-conic-gradient(from 0deg, ${look.color}55 0deg 6deg, transparent 6deg 20deg)`,
            maskImage: 'radial-gradient(circle, black 12%, transparent 66%)',
            WebkitMaskImage: 'radial-gradient(circle, black 12%, transparent 66%)',
          }}
        />

        <div style={{ animation: 'level-burst 0.8s cubic-bezier(0.34,1.56,0.64,1) both' }}>
          {active.kind === 'streak' ? (
            <div className="flex h-[132px] w-[132px] items-center justify-center">
              <StreakFlame days={active.days} size={120} />
            </div>
          ) : (
            <div className="relative h-[132px] w-[132px]" style={{ filter: `drop-shadow(0 0 22px ${look.color}99)` }}>
              <div className="hex absolute inset-0" style={{ background: `linear-gradient(160deg, ${look.color}, ${look.color}33)` }} />
              <div className="hex absolute inset-[4px] flex items-center justify-center bg-slate-950">
                <Icon name={look.icon} className="h-14 w-14" style={{ color: look.color }} />
              </div>
            </div>
          )}
        </div>

        <p className="font-display relative mt-5 text-xs font-bold uppercase tracking-[0.34em]" style={{ color: look.color }}>
          {look.eyebrow}
        </p>
        <h2 className="font-display relative mt-1.5 text-4xl font-bold uppercase leading-tight tracking-wide text-slate-50" style={{ textShadow: `0 0 28px ${look.color}aa` }}>
          {look.title}
        </h2>
        <p className="relative mt-2 text-[0.95rem] leading-snug text-slate-300">{look.body}</p>

        {awarded && <CellPicture cell={awarded} color={user?.color ?? look.color} />}

        <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" className="btn-primary h-11 rounded-lg px-7 text-sm" onClick={dismissCelebration} autoFocus>
            {celebrationsWaiting > 0 ? `Next (${celebrationsWaiting} more)` : 'Keep going'}
          </button>
          {awarded && (
            <Link to={`/map?territory=${awarded.territoryId}`} onClick={dismissCelebration} className="btn-ghost h-11 gap-2 rounded-lg px-5 text-sm font-semibold">
              <Icon name="map" className="h-4 w-4" />
              See it on the map
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

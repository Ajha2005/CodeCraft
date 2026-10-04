import type { ReactNode } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { TIER_META, type Tier } from '../../../lib/tiers';

function Row({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm text-slate-300">
      <span>{children}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <span key={k} className="keycap">
            {k}
          </span>
        ))}
      </span>
    </li>
  );
}

const TIERS: Tier[] = ['OUTPOST', 'SETTLEMENT', 'STRONGHOLD', 'CITADEL'];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="hud-panel max-h-full w-full max-w-2xl overflow-y-auto p-5 animate-pop-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Map controls">
        <div className="mb-3 flex items-center gap-2">
          <Icon name="help" className="h-5 w-5 text-cyan-300" />
          <h2 className="font-display flex-1 text-xl font-bold uppercase tracking-[0.18em] text-slate-50">Field manual</h2>
          <button type="button" onClick={onClose} aria-label="Close help" className="rounded p-1 text-slate-400 hover:text-white">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <div>
            <p className="hud-label mb-1 text-cyan-300">Move</p>
            <ul className="divide-y divide-slate-800">
              <Row keys={['W', 'A', 'S', 'D']}>Walk (or arrow keys)</Row>
              <Row keys={['Shift']}>Sprint</Row>
              <Row keys={['Click']}>Travel to a spot</Row>
              <Row keys={['Esc']}>Cancel route</Row>
            </ul>
          </div>
          <div>
            <p className="hud-label mb-1 text-cyan-300">Camera</p>
            <ul className="divide-y divide-slate-800">
              <Row keys={['Scroll']}>Zoom (or + / -)</Row>
              <Row keys={['Drag']}>Look around</Row>
              <Row keys={['C']}>Recenter on you</Row>
              <Row keys={['O']}>Campus overview</Row>
            </ul>
          </div>
          <div>
            <p className="hud-label mb-1 text-cyan-300">Act</p>
            <ul className="divide-y divide-slate-800">
              <Row keys={['E']}>Inspect this zone</Row>
              <Row keys={['Space']}>Dive in / out</Row>
              <Row keys={['T']}>Travel to selected zone</Row>
              <Row keys={['Click cell']}>Challenge a rival</Row>
              <Row keys={['Click name']}>Open a player’s profile</Row>
            </ul>
          </div>
          <div>
            <p className="hud-label mb-1 text-cyan-300">Panels</p>
            <ul className="divide-y divide-slate-800">
              <Row keys={['F']}>Fast travel</Row>
              <Row keys={['L']}>Leaderboard</Row>
              <Row keys={['?']}>This manual</Row>
            </ul>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="hud-label mb-2 text-cyan-300">Territory tiers</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TIERS.map((t) => (
              <div key={t} className="rounded-lg border border-slate-700/70 bg-slate-900/50 p-2">
                <div className="flex items-center gap-1.5" style={{ color: TIER_META[t].accent }}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <path d={TIER_META[t].icon} />
                  </svg>
                  <span className="font-display text-sm font-bold uppercase tracking-wide">{TIER_META[t].label}</span>
                </div>
                <p className="mt-1 text-[0.68rem] leading-snug text-slate-400">{TIER_META[t].blurb}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            Taller blocks are higher tiers. <span className="font-semibold text-orange-300">Orange dashes</span> mark contested zones, a
            <span className="font-semibold text-slate-200"> flag</span> means you hold ground there, and zones you haven’t visited yet sit under
            a hatched fog until you walk in.
          </p>
        </div>
      </div>
    </div>
  );
}

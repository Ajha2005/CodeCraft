import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../../components/ui/Icon';
import { TierBadge } from '../../../components/ui/TierBadge';
import { TIER_META, tierOf, type Tier } from '../../../lib/tiers';
import { listActiveContests } from '../../contest/api';

const DURATION_OPTIONS = [
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
  { label: '15 min', seconds: 900 },
];

/** One of the player's own cells, offered as the stake. */
export interface StakeCell {
  id: string;
  zoneName: string;
  tier: string;
  row: number;
  col: number;
}

interface ChallengeModalProps {
  zoneName: string;
  tier: string;
  cellLabel: string;
  /** Who holds the cell being challenged, if known. */
  rival: string | null;
  /** The player's own cells: one of them goes on the line. */
  stakes: StakeCell[];
  busy: boolean;
  onConfirm: (durationSeconds: number, pledgedCellId: string) => void;
  onCancel: () => void;
}

export function ChallengeModal({ zoneName, tier, cellLabel, rival, stakes, busy, onConfirm, onCancel }: ChallengeModalProps) {
  const [duration, setDuration] = useState(600);
  const [picked, setPicked] = useState('');
  // Cells already tied up in one of your open duels cannot be staked again
  // (the server enforces it too; this just keeps them from being offered).
  const [locked, setLocked] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    listActiveContests()
      .then((open) => {
        if (!cancelled) setLocked(new Set(open.flatMap((c) => [c.cell.id, ...(c.pledgedCell ? [c.pledgedCell.id] : [])])));
      })
      .catch(() => {
        if (!cancelled) setLocked(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Offered by tier, the lowest first (the cheapest stake leads), then by zone.
  const groups = useMemo(() => {
    const byTier = new Map<Tier, StakeCell[]>();
    for (const s of stakes) {
      const tier = tierOf(s.tier);
      byTier.set(tier, [...(byTier.get(tier) ?? []), s]);
    }
    return [...byTier.entries()]
      .sort(([a], [b]) => TIER_META[a].rank - TIER_META[b].rank)
      .map(([tier, cells]) => ({
        tier,
        cells: cells.sort((a, b) => a.zoneName.localeCompare(b.zoneName) || a.row - b.row || a.col - b.col),
      }));
  }, [stakes]);

  const free = stakes.filter((s) => !locked?.has(s.id));
  // A single free cell needs no choosing; otherwise the player picks, and a pick that stopped being available is dropped.
  const chosen = free.some((s) => s.id === picked) ? picked : free.length === 1 ? free[0].id : '';
  const checking = locked === null;
  const rivalName = rival ?? 'your rival';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={busy ? undefined : onCancel}>
      <div
        className="hud-panel max-h-full w-[min(22rem,100%)] overflow-y-auto p-6 animate-pop-in"
        style={{ borderColor: 'rgba(249,115,22,0.5)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Challenge for this cell"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-orange-400/60 bg-orange-500/15 text-orange-300 animate-glow-pulse">
            <Icon name="swords" className="h-5 w-5" />
          </div>
          <div>
            <p className="hud-label !text-orange-300">Duel challenge</p>
            <h3 className="font-display text-xl font-bold leading-tight text-slate-50">Take this cell?</h3>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-lg font-bold text-slate-100">{zoneName}</span>
            <TierBadge tier={tier} />
          </div>
          <p className="mt-0.5 font-mono text-xs text-slate-400">{cellLabel}</p>
        </div>

        <p className="hud-label mb-2 mt-4">Cell you put on the line</p>
        {stakes.length === 0 ? (
          <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2.5 text-sm text-slate-300">
            You need a cell of your own to stake. Solve a problem to claim one.
            <Link to="/" className="mt-1.5 block text-xs font-bold uppercase tracking-wide text-cyan-300 hover:text-cyan-200">
              Go solve one →
            </Link>
          </div>
        ) : !checking && free.length === 0 ? (
          <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2.5 text-sm text-slate-300">Every cell you hold is already in a duel.</div>
        ) : (
          <>
            <select
              aria-label="Cell you put on the line"
              value={chosen}
              onChange={(e) => setPicked(e.target.value)}
              disabled={checking || busy}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition-colors [color-scheme:dark] focus:border-orange-400/70 disabled:opacity-60"
            >
              <option value="" disabled>
                {checking ? 'Checking your cells…' : 'Choose one of your cells…'}
              </option>
              {groups.map((g) => (
                <optgroup key={g.tier} label={TIER_META[g.tier].label}>
                  {g.cells.map((c) => (
                    <option key={c.id} value={c.id} disabled={locked?.has(c.id)}>
                      {`${c.zoneName} · R${c.row + 1} · C${c.col + 1}`}
                      {locked?.has(c.id) ? ' — in a duel' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1.5 text-xs leading-snug text-slate-400">Lose the duel and {rivalName} takes it. Win, and it stays yours.</p>
          </>
        )}

        <p className="hud-label mb-2 mt-4">Match length</p>
        <div className="mb-5 grid grid-cols-3 gap-2">
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.seconds}
              type="button"
              onClick={() => setDuration(opt.seconds)}
              className={`rounded-lg border py-2 text-sm font-bold transition-all ${
                duration === opt.seconds
                  ? 'border-orange-400/70 bg-orange-500/20 text-orange-200 shadow-[0_0_16px_-4px_rgba(249,115,22,0.7)]'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onConfirm(duration, chosen)}
            disabled={busy || !chosen}
            className="btn-primary h-11 flex-1 rounded-lg text-sm"
            style={{ background: 'linear-gradient(135deg,#fb923c,#f97316)', boxShadow: '0 8px 24px -10px rgba(249,115,22,0.8)' }}
          >
            {busy ? 'Sending…' : 'Send challenge'}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost h-11 rounded-lg px-4 text-sm font-semibold">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

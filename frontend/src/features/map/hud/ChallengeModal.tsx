import { useState } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { TierBadge } from '../../../components/ui/TierBadge';

const DURATION_OPTIONS = [
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
  { label: '15 min', seconds: 900 },
];

interface ChallengeModalProps {
  zoneName: string;
  tier: string;
  cellLabel: string;
  busy: boolean;
  onConfirm: (durationSeconds: number) => void;
  onCancel: () => void;
}

export function ChallengeModal({ zoneName, tier, cellLabel, busy, onConfirm, onCancel }: ChallengeModalProps) {
  const [duration, setDuration] = useState(600);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={busy ? undefined : onCancel}>
      <div
        className="hud-panel w-[min(22rem,100%)] p-6 animate-pop-in"
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
            onClick={() => onConfirm(duration)}
            disabled={busy}
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

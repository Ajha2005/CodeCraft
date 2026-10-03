import { useMemo, useState } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { TIER_META } from '../../../lib/tiers';
import { STATUS_COLOR, STATUS_LABEL, type ZoneStatus, type ZoneSummary } from './zoneSummary';

type Filter = 'all' | ZoneStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'yours', label: 'Mine' },
  { id: 'contested', label: 'Contested' },
  { id: 'rival', label: 'Rival' },
  { id: 'unclaimed', label: 'Open' },
];

interface QuickTravelProps {
  zones: ZoneSummary[];
  /** Straight-line distance in metres from the commander, by zone id. */
  distances: Record<string, number>;
  explored: Set<string> | null;
  /** How many zones the commander has set foot in, out of all of them. */
  exploredCount: number;
  pinnedId: string | null;
  onTravel: (id: string) => void;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
  onClose: () => void;
}

/** Searchable fast-travel list. Sorted by distance at the moment it opens. */
export function QuickTravel({ zones, distances, explored, exploredCount, pinnedId, onTravel, onHover, onPin, onClose }: QuickTravelProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: zones.length, yours: 0, contested: 0, rival: 0, unclaimed: 0 };
    for (const z of zones) c[z.status]++;
    return c;
  }, [zones]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return zones
      .filter((z) => (filter === 'all' || z.status === filter) && (!q || z.name.toLowerCase().includes(q)))
      .sort((a, b) => (distances[a.id] ?? 0) - (distances[b.id] ?? 0));
  }, [zones, query, filter, distances]);

  return (
    <div className="hud-panel flex h-full w-[min(21rem,calc(100vw-1.5rem))] flex-col p-3 animate-slide-in-left" role="dialog" aria-label="Fast travel">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon name="compass" className="h-4 w-4 text-cyan-300" />
        <h2 className="font-display flex-1 text-sm font-bold uppercase tracking-[0.16em] text-slate-100">Fast travel</h2>
        <span className="font-mono text-[0.68rem] font-bold tabular-nums text-slate-400" title="Zones explored">
          {exploredCount}/{zones.length} explored
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 transition-colors hover:text-slate-100">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <label className="relative mb-2.5 block">
        <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && visible[0]) onTravel(visible[0].id);
          }}
          placeholder="Search zones…"
          className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950/70 pl-8 pr-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-400/70"
        />
      </label>

      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide transition-colors ${
              filter === f.id ? 'border-cyan-400/70 bg-cyan-400/15 text-cyan-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {f.label} <span className="opacity-60">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <ul className="-mr-1 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {visible.map((z, i) => {
          const meta = TIER_META[z.tier];
          const unseen = explored ? !explored.has(z.id) && z.mine === 0 : false;
          return (
            <li key={z.id} style={{ animation: `slide-in-left 0.3s ${Math.min(i, 10) * 25}ms cubic-bezier(0.22,1,0.36,1) both` }}>
              <div
                className="group flex items-center gap-2 rounded-lg border border-transparent bg-slate-900/50 pr-1.5 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/5"
                onMouseEnter={() => onHover(z.id)}
                onMouseLeave={() => onHover(null)}
              >
                <button type="button" onClick={() => onTravel(z.id)} onFocus={() => onHover(z.id)} onBlur={() => onHover(null)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill={meta.accent} aria-hidden="true">
                    <path d={meta.icon} />
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {z.name}
                      {unseen && <span className="ml-1.5 text-[0.6rem] font-bold uppercase text-amber-300/80">new</span>}
                    </span>
                    <span className="flex items-center gap-1.5 text-[0.66rem] font-semibold uppercase tracking-wide" style={{ color: STATUS_COLOR[z.status] }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: z.topColor ?? STATUS_COLOR[z.status] }} />
                      {STATUS_LABEL[z.status]}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[0.68rem] font-bold tabular-nums text-slate-400">{distances[z.id] ?? 0} m</span>
                </button>
                <button
                  type="button"
                  onClick={() => onPin(z.id)}
                  aria-label={pinnedId === z.id ? `Unpin ${z.name}` : `Pin ${z.name}`}
                  className={`rounded p-1 transition-colors ${pinnedId === z.id ? 'text-amber-300' : 'text-slate-600 hover:text-amber-300'}`}
                >
                  <Icon name="pin" filled={pinnedId === z.id} className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
        {visible.length === 0 && <li className="py-6 text-center text-sm italic text-slate-500">No zones match.</li>}
      </ul>
    </div>
  );
}

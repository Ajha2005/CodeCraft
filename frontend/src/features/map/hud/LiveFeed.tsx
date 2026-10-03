import { Icon } from '../../../components/ui/Icon';

export interface FeedItem {
  id: number;
  text: string;
  color: string;
  kind: 'capture' | 'mine' | 'discover' | 'info';
}

const ICON = { capture: 'swords', mine: 'flag', discover: 'sparkles', info: 'bell' } as const;

/** Recent campus events, newest first. Items expire on their own. */
export function LiveFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex w-[18.5rem] max-w-[calc(100vw-1.5rem)] flex-col gap-1.5" aria-live="polite">
      {items.map((it) => (
        <li
          key={it.id}
          className="hud-panel hud-panel-quiet flex items-center gap-2.5 !rounded-lg px-3 py-2 animate-slide-in-right"
          style={{ borderLeft: `3px solid ${it.color}` }}
        >
          <Icon name={ICON[it.kind]} className="h-3.5 w-3.5 shrink-0" style={{ color: it.color }} />
          <span className="min-w-0 text-xs font-medium leading-snug text-slate-200">{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

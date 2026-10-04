export interface FeedItem {
  id: number;
  text: string;
  color: string;
  kind: 'capture' | 'mine';
}

/** Recent news that concerns you, newest first. Items expire on their own. */
export function LiveFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex w-max max-w-[calc(100vw-1.5rem)] flex-col items-start gap-1" aria-live="polite">
      {items.map((it) => (
        <li key={it.id} className="hud-panel hud-panel-quiet flex max-w-full items-center gap-2 !rounded-full py-1 pl-2.5 pr-3.5 animate-slide-in-left">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.color }} />
          <span className="min-w-0 truncate text-xs font-medium text-slate-200">{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

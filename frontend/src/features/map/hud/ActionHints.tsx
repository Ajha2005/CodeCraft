import type { ReactNode } from 'react';

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
      {keys.map((k) => (
        <span key={k} className="keycap">
          {k}
        </span>
      ))}
      {children}
    </span>
  );
}

/** The only standing key prompt: it appears while you stand inside a zone. */
export function InspectHint() {
  return (
    <div className="hud-panel hud-panel-quiet hidden !rounded-full px-3.5 py-1.5 animate-fade-in-up lg:block">
      <Hint keys={['E']}>Inspect</Hint>
    </div>
  );
}

/** One-time welcome card for first-time map visitors. It leaves as soon as you move. */
export function FirstRunHint({ onDismiss, touch }: { onDismiss: () => void; touch: boolean }) {
  return (
    <div
      className="hud-panel w-[min(28rem,calc(100vw-1.5rem))] px-4 py-3.5 text-center animate-pop-in max-sm:w-[calc(100vw-5.25rem)] max-sm:px-3"
      role="dialog"
      aria-label="How to move"
    >
      <p className="font-display text-base font-bold uppercase tracking-[0.2em] text-cyan-300">Welcome to campus</p>
      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {touch ? (
          <>
            <Hint keys={['Stick']}>Move</Hint>
            <Hint keys={['Tap']}>Travel</Hint>
            <Hint keys={['Pinch']}>Zoom</Hint>
          </>
        ) : (
          <>
            <Hint keys={['W', 'A', 'S', 'D']}>Move</Hint>
            <Hint keys={['Click']}>Travel</Hint>
            <Hint keys={['Scroll']}>Zoom</Hint>
          </>
        )}
      </div>
      <button type="button" onClick={onDismiss} className="btn-primary mt-3 h-9 rounded-lg px-5 text-sm">
        Got it
      </button>
    </div>
  );
}

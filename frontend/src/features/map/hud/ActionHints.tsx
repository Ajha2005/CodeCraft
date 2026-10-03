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

/** Contextual key prompts along the bottom edge (desktop only). */
export function ActionHints({ inZone }: { inZone: boolean }) {
  return (
    <div className="hud-panel hud-panel-quiet hidden items-center gap-4 px-4 py-2 animate-fade-in-up lg:flex">
      <Hint keys={['W', 'A', 'S', 'D']}>Move</Hint>
      <Hint keys={['Shift']}>Sprint</Hint>
      {inZone && (
        <>
          <Hint keys={['E']}>Inspect</Hint>
          <Hint keys={['Space']}>Dive in</Hint>
        </>
      )}
      <Hint keys={['Click']}>Travel</Hint>
      <Hint keys={['F']}>Fast travel</Hint>
      <Hint keys={['?']}>Help</Hint>
    </div>
  );
}

/** One-time welcome card for first-time map visitors. */
export function FirstRunHint({ onDismiss, touch }: { onDismiss: () => void; touch: boolean }) {
  return (
    <div className="hud-panel w-[min(30rem,calc(100vw-1.5rem))] p-4 text-center animate-pop-in max-sm:w-[calc(100vw-5.25rem)] max-sm:p-3" role="dialog" aria-label="How to move">
      <p className="font-display text-xl font-bold uppercase tracking-[0.18em] text-cyan-300">Welcome to campus</p>
      <p className="mt-1 text-sm text-slate-300">You’re standing at the Main Gate. Walk the map, explore every zone, and take territory.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-left text-xs text-slate-300">
        {touch ? (
          <>
            <Hint keys={['Stick']}>Move</Hint>
            <Hint keys={['Tap']}>Select / travel</Hint>
            <Hint keys={['Drag']}>Look around</Hint>
            <Hint keys={['Pinch']}>Zoom</Hint>
          </>
        ) : (
          <>
            <Hint keys={['W', 'A', 'S', 'D']}>Move</Hint>
            <Hint keys={['Shift']}>Sprint</Hint>
            <Hint keys={['Click']}>Select zone / travel</Hint>
            <Hint keys={['Scroll']}>Zoom</Hint>
            <Hint keys={['Drag']}>Look around</Hint>
            <Hint keys={['E']}>Inspect zone</Hint>
          </>
        )}
      </div>
      <button type="button" onClick={onDismiss} className="btn-primary mt-4 h-10 rounded-lg px-6 text-sm">
        Let’s go
      </button>
    </div>
  );
}

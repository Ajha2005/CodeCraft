import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Eases a displayed number toward `target`; first paint counts up from 0. */
export function useAnimatedNumber(target: number, duration = 900): number {
  const [display, setDisplay] = useState(0);
  const shown = useRef(0);

  useEffect(() => {
    const from = shown.current;
    let raf = 0;

    if (prefersReducedMotion() || from === target) {
      raf = requestAnimationFrame(() => {
        shown.current = target;
        setDisplay(target);
      });
      return () => cancelAnimationFrame(raf);
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      shown.current = value;
      setDisplay(value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

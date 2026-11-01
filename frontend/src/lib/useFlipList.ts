import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Smoothly slides list rows to their new place when the order changes (FLIP:
 * First, Last, Invert, Play). Give each row `register(id)` as its `ref`; pass
 * a string that changes exactly when the order does.
 *
 * Positions are read as `offsetTop` (relative to the list), so scrolling between
 * two renders cannot make rows jump.
 */
export function useFlipList(orderKey: string, duration = 520) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [id, el] of nodes.current) {
      const top = el.offsetTop;
      const was = tops.current.get(id);
      if (!reduce && was !== undefined && Math.abs(was - top) > 1 && typeof el.animate === 'function') {
        el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'translateY(0)' }], { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
      tops.current.set(id, top);
    }
    for (const id of tops.current.keys()) if (!nodes.current.has(id)) tops.current.delete(id);
  }, [orderKey, duration]);

  return useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    [],
  );
}

import { useSyncExternalStore } from 'react';
import type { EngineStats, MapEngine } from '../world/engine';

/** Subscribes a component to the engine's throttled stats snapshot (~10 Hz). */
export function useEngineStats(engine: MapEngine) {
  return useSyncExternalStore(engine.subscribe, engine.getStats);
}

/**
 * Subscribe to a single value derived from the stats. The selector must return
 * a primitive (string / number / boolean), so a component only re-renders when
 * *that* value changes - not every time the commander takes a step.
 */
export function useEngineSelector<T extends string | number | boolean | null>(engine: MapEngine, select: (s: EngineStats) => T): T {
  return useSyncExternalStore(engine.subscribe, () => select(engine.getStats()));
}

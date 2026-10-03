import { useSyncExternalStore } from 'react';
import type { MapEngine } from '../world/engine';

/** Subscribes a component to the engine's throttled stats snapshot (~10 Hz). */
export function useEngineStats(engine: MapEngine) {
  return useSyncExternalStore(engine.subscribe, engine.getStats);
}

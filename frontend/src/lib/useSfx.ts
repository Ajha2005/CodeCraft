import { useSyncExternalStore } from 'react';
import { sfx } from './sfx';

/** [enabled, setEnabled] for the sound toggle. */
export function useSfxEnabled(): [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(sfx.subscribe, sfx.isEnabled);
  return [enabled, sfx.setEnabled];
}

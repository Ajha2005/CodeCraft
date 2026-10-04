// Tiny synthesized UI sound effects. No audio files, no dependencies: each
// sound is a few oscillator notes. OFF by default (people play this in
// libraries and labs) and remembered per browser once switched on.

export type SfxName = 'click' | 'hover' | 'zone' | 'discover' | 'capture' | 'travel' | 'arrive' | 'win' | 'levelup' | 'error';

const STORAGE_KEY = 'cc.sfx.v1';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let enabled = readEnabled();
let audio: AudioContext | null = null;
const listeners = new Set<() => void>();

function context(): AudioContext | null {
  if (!audio) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
  }
  if (audio.state === 'suspended') void audio.resume();
  return audio;
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const ctx = context();
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

const SOUNDS: Record<SfxName, () => void> = {
  click: () => tone(660, 0, 0.06, 'triangle', 0.05),
  hover: () => tone(1250, 0, 0.03, 'sine', 0.014),
  zone: () => {
    tone(523.25, 0, 0.14, 'sine', 0.06);
    tone(783.99, 0.08, 0.18, 'sine', 0.05);
  },
  discover: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.075, 0.2, 'triangle', 0.05)),
  capture: () => {
    tone(220, 0, 0.26, 'sawtooth', 0.04, 880);
    tone(1318.5, 0.2, 0.2, 'sine', 0.04);
  },
  travel: () => tone(420, 0, 0.14, 'triangle', 0.05, 640),
  arrive: () => {
    tone(784, 0, 0.12, 'triangle', 0.05);
    tone(987.77, 0.09, 0.16, 'triangle', 0.05);
  },
  win: () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.09, 0.28, 'triangle', 0.06)),
  levelup: () => {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.1, 0.3, 'triangle', 0.065));
    tone(1568, 0.55, 0.6, 'sine', 0.05);
  },
  error: () => tone(150, 0, 0.2, 'square', 0.04, 90),
};

export const sfx = {
  play(name: SfxName) {
    if (!enabled) return;
    try {
      SOUNDS[name]();
    } catch {
      // audio is a nicety; never let it break the app
    }
  },
  isEnabled: () => enabled,
  setEnabled(next: boolean) {
    enabled = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
    if (next) SOUNDS.click();
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

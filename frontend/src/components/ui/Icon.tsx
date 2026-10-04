import type { SVGProps } from 'react';

// A small stroke-icon set (24x24, Lucide-style geometry). Kept in-repo so the
// HUD does not need an icon dependency, and so every icon inherits
// `currentColor` and can be tinted with a text-* class.

const PATHS = {
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  code: 'M8 6 3 12l5 6M16 6l5 6-5 6M14 4l-4 16',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  swords: 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4 0-6 1-9z',
  trophy: 'M8 4h8v6a4 4 0 0 1-8 0zM8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 14v4M8 20h8',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  crown: 'M3 18 5 7l5 5 2-7 2 7 5-5 2 11z',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5',
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16 8l-2 6-6 2 2-6z',
  locate: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01',
  volume: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  mute: 'M11 5 6 9H3v6h3l5 4zM16 9l6 6M22 9l-6 6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  rocket: 'M5 15c-1 1-2 4-2 6 2 0 5-1 6-2M14 4c4-1 6-1 7-1 0 1 0 3-1 7-1 3-4 6-7 8l-5-5c2-3 5-6 6-9zM15 9h.01',
  skull: 'M12 3a8 8 0 0 0-8 8c0 3 1.5 4.5 3 5.5V20h10v-3.5c1.5-1 3-2.5 3-5.5a8 8 0 0 0-8-8zM9 12h.01M15 12h.01M10 17v3M14 17v3',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  pin: 'M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  home: 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  play: 'M6 4l14 8-14 8z',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Fill the shape with currentColor instead of just stroking it. */
  filled?: boolean;
  size?: number | string;
}

export function Icon({ name, filled = false, size = '1em', strokeWidth = 2, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

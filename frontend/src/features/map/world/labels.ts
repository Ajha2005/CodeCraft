// Block names on the map: how a name is fitted into its block, and where it goes
// when its usual spot is taken. Plain functions of numbers - the renderer
// measures text and draws it - so the rules can be read without a canvas.
//
// The rule they all serve: a block on screen always shows its name. A name that
// is too wide shrinks, then breaks onto a second line, then shrinks a little
// further; one that still does not fit spills over its block rather than being
// left out. A name whose spot is taken (by the avatar, or a neighbour's name)
// slides along its block before it is given up.

/** Width of `text` set at font size `size`, in world units. */
export type MeasureText = (text: string, size: number) => number;

/** Room kept between a name and the edge of its block, world units. */
const PAD = 5;

/** Line spacing of a two-line name, as a multiple of its font size. */
export const LINE_HEIGHT = 1.05;

export interface NameRequest {
  text: string;
  /** The size the name would like to be. */
  want: number;
  /** The smallest size worth reading: a name only goes below it by breaking onto two lines first. */
  min: number;
  /** Never smaller than this; a name that still does not fit spills over its block instead. */
  floor: number;
  /** The widest the name may be before it spills over its block. */
  maxW: number;
  /** Whether the name may break onto a second line (a tag above a roof may not). */
  wrap: boolean;
}

export interface FittedName {
  lines: string[];
  fs: number;
  /** One width per line, at `fs`. */
  widths: number[];
}

/** Where a two-word-or-longer name breaks best: the space that leaves the narrower of the two lines widest. */
function splitName(measure: MeasureText, text: string, fs: number): string[] | null {
  let best: { lines: string[]; width: number } | null = null;
  for (let i = text.indexOf(' '); i !== -1; i = text.indexOf(' ', i + 1)) {
    const lines = [text.slice(0, i).trimEnd(), text.slice(i + 1).trimStart()];
    if (!lines[0] || !lines[1]) continue;
    const width = Math.max(measure(lines[0], fs), measure(lines[1], fs));
    if (!best || width < best.width) best = { lines, width };
  }
  return best ? best.lines : null;
}

/** Size, line breaks and widths for a name that has `maxW` of room, in the order described at the top of the file. */
export function fitName(measure: MeasureText, req: NameRequest): FittedName {
  const room = req.maxW - PAD;
  const set = (lines: string[], fs: number): FittedName => ({ lines, fs, widths: lines.map((l) => measure(l, fs)) });
  const widest = (n: FittedName) => Math.max(...n.widths);
  // Scale to the room, but not below `lowest`. Text width is not exactly proportional
  // to size (hinting), so aim a hair under and measure again until it sits inside.
  const shrunk = (n: FittedName, lowest: number) => {
    let cur = n;
    for (let i = 0; i < 4 && widest(cur) > room && cur.fs > lowest; i++) {
      cur = set(cur.lines, Math.max((cur.fs * room * 0.99) / widest(cur), lowest));
    }
    return cur;
  };

  const natural = set([req.text], req.want);
  if (widest(natural) <= room) return natural;

  const oneLine = shrunk(natural, req.min);
  if (widest(oneLine) <= room) return oneLine;

  const parts = req.wrap ? splitName(measure, req.text, oneLine.fs) : null;
  if (!parts) return shrunk(oneLine, req.floor);

  const twoLines = set(parts, oneLine.fs);
  if (widest(twoLines) <= room) return twoLines;
  // Re-break at the smaller size: the best place to split can move as the text shrinks.
  const smaller = shrunk(twoLines, req.floor);
  return set(splitName(measure, req.text, smaller.fs) ?? parts, smaller.fs);
}

/**
 * Where a name tries to go when its usual spot is taken, as [across, down]
 * steps - an across step is half the label's width, a down step half its
 * height - nearest the usual spot first, up and down before sideways.
 */
export const NUDGES: readonly (readonly [dx: number, dy: number])[] = [
  [0, 0],
  [0, -1],
  [0, 1],
  [0, -2],
  [0, 2],
  [0, -3],
  [0, 3],
  [0, -4],
  [0, 4],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
];

/** A name that is being looked at stays where it is: the first step of NUDGES, alone. */
export const STAY: typeof NUDGES = NUDGES.slice(0, 1);

/**
 * Whether the box overlaps any box in `placed` (a flat run of x0, y0, x1, y1),
 * ignoring the first `skip` numbers - so the avatar's box, which comes first,
 * can be left out.
 */
export function overlapsAny(placed: readonly number[], x0: number, y0: number, x1: number, y1: number, skip = 0): boolean {
  for (let i = skip; i < placed.length; i += 4) {
    if (x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1]) return true;
  }
  return false;
}

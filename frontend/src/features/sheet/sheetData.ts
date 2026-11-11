import type { IconName } from '../../components/ui/Icon';
import type { ProblemStatus, ProblemSummary } from '../problems/api';
import { difficultyMeta } from '../problems/difficulty';

// THE WARPATH - CodeCraft's DSA sheet.
//
// A fixed order for someone starting DSA from zero: arrays first, then the
// recursion you need before trees, then trees, then graphs, then the endgame.
// Each "front" is one topic with a short briefing, a handful of core quests in
// the order to attempt them (easy to hard, one new idea at a time) and a boss
// at the end. Side quests are optional extra reps on the same idea.
//
// Every quest is a problem that really exists on the platform, referenced by
// its id; titles and difficulty always come from the live catalogue, so this
// file only decides ORDER and TEACHING NOTES. Nothing here is stored per
// player: progress is just "which of these problems have you cleared".

export interface Quest {
  id: number;
  /** One line: the idea this problem teaches. */
  lesson: string;
  /** Side quests are extra practice; they never gate a front. */
  side?: boolean;
}

export interface Front {
  id: string;
  name: string;
  /** What the topic is, in two sentences a beginner can follow. */
  briefing: string;
  /** The pattern to watch for: when you see X, reach for Y. */
  pattern: string;
  quests: Quest[];
}

export interface Realm {
  id: string;
  name: string;
  tagline: string;
  icon: IconName;
  /** Accent on the dark theme, and a deeper shade that stays readable on the light one. */
  color: string;
  deep: string;
  fronts: Front[];
}

export const SHEET_NAME = 'The Warpath';
export const SHEET_TAGLINE = 'From your first array to your first graph - one front at a time.';

export const REALMS: Realm[] = [
  {
    id: 'plains',
    name: 'Array Plains',
    tagline: 'Where every DSA journey starts: lists of numbers, and what you can do with them.',
    icon: 'flag',
    color: '#34d399',
    deep: '#047857',
    fronts: [
      {
        id: 'boot-camp',
        name: 'Boot Camp',
        briefing: 'Walk an array once and answer a question about it. This is the muscle every later topic leans on.',
        pattern: 'Need to ask "have I seen this before?" Reach for a set. Two sorted arrays? Walk both with two pointers.',
        quests: [
          { id: 132, lesson: 'One pass, compare neighbours.' },
          { id: 585, lesson: 'A set answers "seen before?" in one step.' },
          { id: 215, lesson: 'Same idea again, now as a habit.' },
          { id: 234, lesson: 'The same question worded differently.', side: true },
          { id: 370, lesson: 'Is one list fully inside another? Sets again.' },
          { id: 502, lesson: 'Two pointers walking two sorted arrays.' },
          { id: 497, lesson: 'Counting occurrences with a frequency map.' },
          { id: 485, lesson: 'Find the one out-of-order stretch.' },
        ],
      },
      {
        id: 'halve-and-conquer',
        name: 'Halve & Conquer',
        briefing: 'On sorted data you never need to look at everything. Check the middle, throw half away, repeat.',
        pattern: 'Sorted input, or a yes/no that flips once (like "is this version bad?"): binary search.',
        quests: [
          { id: 53, lesson: 'Plain binary search. Get the loop exactly right.' },
          { id: 78, lesson: 'Same search, fresh wording.', side: true },
          { id: 151, lesson: 'One more rep of the basic loop.', side: true },
          { id: 85, lesson: 'Keep searching after a hit: leftmost match.' },
          { id: 43, lesson: 'First occurrence with trickier inputs.' },
          { id: 22, lesson: 'Where would this value go? The loop ends on the answer.' },
          { id: 590, lesson: 'Binary search on answers, not on an array.' },
          { id: 32, lesson: 'Binary search on a yes/no that flips once.' },
        ],
      },
      {
        id: 'running-totals',
        name: 'Running Totals',
        briefing: 'Add things up once, then answer "what is the sum from here to there?" instantly. Prefix sums turn slow loops into subtraction.',
        pattern: 'Many range-sum questions on the same array: build prefix sums first. Many range updates: a difference array.',
        quests: [
          { id: 558, lesson: 'Build a prefix sum array.' },
          { id: 418, lesson: 'Use prefix sums to test a condition.' },
          { id: 441, lesson: 'Range sum = prefix[r] - prefix[l-1].' },
          { id: 504, lesson: 'Answer range questions without rescanning.' },
          { id: 489, lesson: 'Difference array: update a range in O(1).' },
          { id: 192, lesson: 'The array changes too: update and query together.' },
          { id: 203, lesson: 'Point updates plus range sums (Fenwick / segment tree).' },
        ],
      },
      {
        id: 'sliding-scouts',
        name: 'Sliding Scouts',
        briefing: 'A window slides across the array; add the new element, drop the old one, never start over. It turns O(n*k) into O(n).',
        pattern: 'Contiguous subarray or substring with a size or a sum limit: sliding window.',
        quests: [
          { id: 369, lesson: 'Fixed-size window: slide, add, drop.' },
          { id: 377, lesson: 'Fixed window with a comparison.' },
          { id: 460, lesson: 'Fixed window over a string, counting a property.' },
          { id: 399, lesson: 'Window that grows and shrinks to fit a sum.' },
          { id: 27, lesson: 'Boss: shrink and grow the window while counting distinct characters.' },
        ],
      },
      {
        id: 'word-warfare',
        name: 'Word Warfare',
        briefing: 'Strings are arrays of characters, with a few special tricks: prefixes, substrings, subsequences, counting letters.',
        pattern: 'Comparing two strings letter by letter: two pointers. Same letters in any order: count them.',
        quests: [
          { id: 442, lesson: 'Check every character against a rule.' },
          { id: 408, lesson: 'Prefix check: compare from the front.' },
          { id: 553, lesson: 'Prefix again.', side: true },
          { id: 424, lesson: 'Front and back checks.', side: true },
          { id: 465, lesson: 'Prefix and suffix together.' },
          { id: 503, lesson: 'Find a smaller string inside a bigger one.' },
          { id: 581, lesson: 'Substring search once more.', side: true },
          { id: 463, lesson: 'Clean the strings, then compare letter counts.' },
          { id: 64, lesson: 'Subsequence matching with two pointers.' },
        ],
      },
    ],
  },
  {
    id: 'ravine',
    name: 'Recursion Ravine',
    tagline: 'Functions that call themselves, and structures that point to each other. The bridge to trees and graphs.',
    icon: 'rotate',
    color: '#fb923c',
    deep: '#c2410c',
    fronts: [
      {
        id: 'echo-chamber',
        name: 'Echo Chamber',
        briefing: 'Solve a big problem by solving a slightly smaller copy of it. Every recursive function needs a base case and a step towards it.',
        pattern: 'Problem shrinks the same way each time (smaller string, shorter list): write the base case first.',
        quests: [
          { id: 434, lesson: 'Recursion on an array: base case, then the rest.' },
          { id: 131, lesson: 'Recursion on a string: compare ends, shrink inwards.' },
          { id: 175, lesson: 'The same palindrome idea, once more.', side: true },
          { id: 86, lesson: 'Your first overlapping subproblems. This is where DP begins.' },
        ],
      },
      {
        id: 'chains-and-stacks',
        name: 'Chains & Stacks',
        briefing: 'A linked list is a chain of nodes, each pointing to the next. A stack is last-in, first-out. Both reward careful pointer thinking.',
        pattern: 'Matching brackets or undoing the latest thing: stack. Walking a chain: one pointer, then two.',
        quests: [
          { id: 445, lesson: 'Walk a linked list node by node.' },
          { id: 356, lesson: 'Bracket matching, with a wildcard twist.' },
          { id: 130, lesson: 'Same bracket idea, different rules.', side: true },
          { id: 456, lesson: 'Boss: copy a list where nodes also point at random nodes.' },
        ],
      },
    ],
  },
  {
    id: 'woods',
    name: 'Tree Woods',
    tagline: 'Data that branches. Almost every tree problem is "do something at this node, then do it for the children".',
    icon: 'shield',
    color: '#2dd4bf',
    deep: '#0f766e',
    fronts: [
      {
        id: 'root-and-branches',
        name: 'Root & Branches',
        briefing: 'Visit every node with DFS (go deep) or BFS (go level by level). Binary search trees keep smaller values left and larger right.',
        pattern: 'Answer depends on the children: recurse on left and right, then combine. Level by level: BFS with a queue.',
        quests: [
          { id: 44, lesson: 'Preorder traversal: visit, left, right.' },
          { id: 304, lesson: 'The same traversal, in different words.', side: true },
          { id: 180, lesson: 'In a BST, every comparison discards half the tree.' },
          { id: 297, lesson: 'Carry a running sum down the tree.' },
          { id: 37, lesson: 'Work level by level.' },
        ],
      },
      {
        id: 'balance-of-power',
        name: 'Balance of Power',
        briefing: 'Trees can lean badly. Height, balance, and self-balancing trees (AVL, red-black, B-trees) keep search fast.',
        pattern: 'A tree property that depends on both subtrees: return a height (or a flag) up from the children.',
        quests: [
          { id: 407, lesson: 'Compute height from the bottom up, check balance on the way.' },
          { id: 201, lesson: 'Height balance again, stricter inputs.', side: true },
          { id: 233, lesson: 'Search in a self-balancing tree.' },
          { id: 202, lesson: 'Red-black trees: the idea behind the search.' },
          { id: 397, lesson: 'B-tree nodes hold sorted keys.' },
          { id: 529, lesson: 'Validate a tree: ordering and balance together.' },
          { id: 210, lesson: 'Boss: measure width across the whole tree.' },
        ],
      },
      {
        id: 'trie-territory',
        name: 'Trie Territory',
        briefing: 'A trie is a tree of letters. Words that share a start share a path, so prefix questions become walks down the tree.',
        pattern: 'Lots of words, lots of prefix questions: build a trie once, then walk it.',
        quests: [
          { id: 379, lesson: 'Build a trie and look a word up.' },
          { id: 353, lesson: 'Does any word start another word?' },
          { id: 438, lesson: 'The same question, solved with a trie.' },
          { id: 366, lesson: 'The same question, solved without one.', side: true },
          { id: 416, lesson: 'Boss: prefix and suffix at once.' },
        ],
      },
    ],
  },
  {
    id: 'citadel',
    name: 'Graph Citadel',
    tagline: 'Things connected to other things: roads, friends, courses. The most useful structure you will learn.',
    icon: 'crown',
    color: '#a78bfa',
    deep: '#6d28d9',
    fronts: [
      {
        id: 'pathfinders',
        name: 'Pathfinders',
        briefing: 'Can you get from A to B? DFS dives deep; BFS spreads out evenly, which also gives you the shortest path when every step costs the same.',
        pattern: 'Reachability: DFS or BFS with a visited set. Shortest path in steps: BFS. A grid is a graph too.',
        quests: [
          { id: 115, lesson: 'Your first graph traversal.' },
          { id: 172, lesson: 'The same traversal, on another input.', side: true },
          { id: 250, lesson: 'Directed edges: direction matters.' },
          { id: 505, lesson: 'A maze is a graph on a grid.' },
          { id: 209, lesson: 'DFS with backtracking on a grid.' },
          { id: 211, lesson: 'BFS finds the shortest path.' },
          { id: 240, lesson: 'Boss: paths that must respect a cost limit.' },
        ],
      },
      {
        id: 'alliances-and-orders',
        name: 'Alliances & Orders',
        briefing: 'Group things that are connected (components, union-find), and order things that depend on each other (topological sort).',
        pattern: 'Who is in the same group: union-find or DFS. A before B, no cycles allowed: topological order.',
        quests: [
          { id: 139, lesson: 'Count connected groups.' },
          { id: 162, lesson: 'Can every course be finished? Detect a cycle.' },
          { id: 592, lesson: 'Union-find: merge groups, then check conflicts.' },
          { id: 282, lesson: 'Which node removal shrinks the spread most?' },
          { id: 344, lesson: 'Boss: ordering with a limit on each round.' },
        ],
      },
      {
        id: 'spanning-and-matching',
        name: 'Spanning & Matching',
        briefing: 'Connect everything as cheaply as possible (spanning trees), and pair things up fairly (matching and flow). The graph world at its most powerful.',
        pattern: 'Cheapest way to connect all nodes: minimum spanning tree (Kruskal / Prim). Pairing two sets: matching.',
        quests: [
          { id: 520, lesson: 'A spanning tree of n nodes has exactly n-1 edges.' },
          { id: 243, lesson: 'Is this edge part of a minimum spanning tree?' },
          { id: 346, lesson: 'The same question, another angle.', side: true },
          { id: 429, lesson: 'Match one set to another without clashes.' },
          { id: 281, lesson: 'Boss: matching with costs, via min-cost max-flow.' },
        ],
      },
    ],
  },
  {
    id: 'summit',
    name: 'Endgame Summit',
    tagline: 'Where the big ideas meet: dynamic programming, greedy choices, heaps and bit tricks. Climb here once the three realms feel comfortable.',
    icon: 'trophy',
    color: '#f472b6',
    deep: '#be185d',
    fronts: [
      {
        id: 'greedy-and-dp',
        name: 'Greedy Gambit & DP',
        briefing: 'Greedy: take the best choice now and never look back. DP: remember answers to small problems so you never solve one twice.',
        pattern: 'Sort then pick: greedy. Same subproblem showing up again and again: write the recurrence, then memoise it.',
        quests: [
          { id: 73, lesson: 'Sort by end time, keep what fits.' },
          { id: 528, lesson: 'Intervals once more.', side: true },
          { id: 89, lesson: 'Activity selection, the classic greedy.' },
          { id: 199, lesson: 'Subset sum: can some subset hit the target?' },
          { id: 20, lesson: 'DP on a grid: best way to each cell.' },
          { id: 107, lesson: 'DP with a state for how many moves you have left.' },
          { id: 61, lesson: 'A window with wildcards.', side: true },
          { id: 334, lesson: 'A 2D prefix sum and a bit of number theory.', side: true },
          { id: 60, lesson: 'Boss: DP over a string with wildcards.' },
        ],
      },
      {
        id: 'heaps-bits-math',
        name: 'Heaps, Bits & Math',
        briefing: 'Heaps pull out the biggest or smallest quickly. Bit tricks and modular arithmetic make hard-looking problems small.',
        pattern: 'The k-th biggest or smallest of something: heap. Powers and remainders of huge numbers: fast exponentiation.',
        quests: [
          { id: 232, lesson: 'The k-th largest: sort, or keep a heap.' },
          { id: 226, lesson: 'One bit trick that checks a power of two.' },
          { id: 386, lesson: 'Divisors and a little number sense.' },
          { id: 599, lesson: 'k-th smallest in a sorted grid: heap or binary search.' },
          { id: 258, lesson: 'Fast exponentiation: square and halve.' },
          { id: 272, lesson: 'Counting inversions, the merge-sort way.' },
          { id: 235, lesson: 'Boss: maximum XOR with prefix XORs and a trie.' },
        ],
      },
    ],
  },
];

// -------------------------------------------------------------- derived data

export const ALL_FRONTS: Front[] = REALMS.flatMap((r) => r.fronts);

/** The quests that count: everything that is not a side quest. */
export const coreOf = (front: Front) => front.quests.filter((q) => !q.side);
export const sideOf = (front: Front) => front.quests.filter((q) => q.side);

export const CORE_IDS: number[] = ALL_FRONTS.flatMap((f) => coreOf(f).map((q) => q.id));
export const ALL_SHEET_IDS = new Set<number>(ALL_FRONTS.flatMap((f) => f.quests.map((q) => q.id)));

/** A front's boss is its last core quest. */
export const bossOf = (front: Front): Quest => {
  const core = coreOf(front);
  return core[core.length - 1];
};

export interface FrontProgress {
  total: number;
  cleared: number;
  attempted: number;
  sideTotal: number;
  sideCleared: number;
  done: boolean;
  /** XP the front's core quests are worth in all, and how much of it you have earned. */
  xp: number;
  xpEarned: number;
}

type Status = Record<number, ProblemStatus>;
type Catalog = Map<number, ProblemSummary>;

export function catalogMap(problems: ProblemSummary[]): Catalog {
  return new Map(problems.map((p) => [p.id, p]));
}

const xpOf = (catalog: Catalog, id: number) => difficultyMeta(catalog.get(id)?.difficultyLevel ?? '').xp;

export function frontProgress(front: Front, status: Status, catalog: Catalog): FrontProgress {
  const core = coreOf(front).filter((q) => catalog.has(q.id));
  const side = sideOf(front).filter((q) => catalog.has(q.id));
  const cleared = core.filter((q) => status[q.id] === 'AC');
  return {
    total: core.length,
    cleared: cleared.length,
    attempted: core.filter((q) => status[q.id] === 'ATTEMPTED').length,
    sideTotal: side.length,
    sideCleared: side.filter((q) => status[q.id] === 'AC').length,
    done: core.length > 0 && cleared.length === core.length,
    xp: core.reduce((n, q) => n + xpOf(catalog, q.id), 0),
    xpEarned: cleared.reduce((n, q) => n + xpOf(catalog, q.id), 0),
  };
}

export function realmProgress(realm: Realm, status: Status, catalog: Catalog) {
  const parts = realm.fronts.map((f) => frontProgress(f, status, catalog));
  const total = parts.reduce((n, p) => n + p.total, 0);
  const cleared = parts.reduce((n, p) => n + p.cleared, 0);
  return {
    total,
    cleared,
    done: total > 0 && cleared === total,
    frontsDone: parts.filter((p) => p.done).length,
    frontsTotal: parts.length,
    xp: parts.reduce((n, p) => n + p.xp, 0),
    xpEarned: parts.reduce((n, p) => n + p.xpEarned, 0),
  };
}

export function sheetProgress(status: Status, catalog: Catalog) {
  const realms = REALMS.map((r) => realmProgress(r, status, catalog));
  const total = realms.reduce((n, r) => n + r.total, 0);
  const cleared = realms.reduce((n, r) => n + r.cleared, 0);
  const fronts = ALL_FRONTS.map((f) => frontProgress(f, status, catalog));
  return {
    total,
    cleared,
    pct: total > 0 ? cleared / total : 0,
    frontsDone: fronts.filter((f) => f.done).length,
    frontsTotal: fronts.length,
    realmsDone: realms.filter((r) => r.done).length,
    realmsTotal: realms.length,
    xp: realms.reduce((n, r) => n + r.xp, 0),
    xpEarned: realms.reduce((n, r) => n + r.xpEarned, 0),
  };
}

/** Which fronts / realms are fully cleared, from just the set of cleared problem ids (no catalogue needed). */
export function clearedCounts(clearedIds: ReadonlySet<number>) {
  const frontsDone = ALL_FRONTS.filter((f) => coreOf(f).every((q) => clearedIds.has(q.id))).length;
  const realmsDone = REALMS.filter((r) => r.fronts.every((f) => coreOf(f).every((q) => clearedIds.has(q.id)))).length;
  const sheetSolved = CORE_IDS.filter((id) => clearedIds.has(id)).length;
  return { frontsDone, realmsDone, sheetSolved };
}

/** Ranks for walking the Warpath, by share of core quests cleared. */
const RANKS: { min: number; title: string }[] = [
  { min: 1, title: 'Warlord of the Warpath' },
  { min: 0.75, title: 'Grandmaster' },
  { min: 0.5, title: 'Captain' },
  { min: 0.25, title: 'Sergeant' },
  { min: 0.05, title: 'Scout' },
  { min: 0, title: 'Recruit' },
];

export function warpathRank(pct: number): string {
  return RANKS.find((r) => pct >= r.min)!.title;
}

export interface NextStep {
  quest: Quest;
  front: Front;
  realm: Realm;
  /** True when it is an attempted quest being picked up again. */
  retry: boolean;
}

/** The first core quest, in sheet order, you have not cleared yet. */
export function nextStep(status: Status, catalog: Catalog): NextStep | null {
  let firstOpen: NextStep | null = null;
  for (const realm of REALMS) {
    for (const front of realm.fronts) {
      for (const quest of coreOf(front)) {
        if (!catalog.has(quest.id) || status[quest.id] === 'AC') continue;
        const step = { quest, front, realm, retry: status[quest.id] === 'ATTEMPTED' };
        if (step.retry) return step;
        firstOpen ??= step;
      }
    }
  }
  return firstOpen;
}

import type { IconName } from '../components/ui/Icon';

// Achievements are derived entirely from numbers the app already has, so there
// is no new backend state and nothing to keep in sync: unlocked just means
// "your stats currently meet the bar".

export interface AchievementInput {
  solves: number;
  hardestWeight: number;
  longestStreak: number;
  territoriesHeld: number;
  hasCitadel: boolean;
  rank: number | null;
  dailyCapReached: boolean;
  explored: number;
  /** Fronts / realms of the Warpath (the DSA sheet) fully cleared. */
  frontsCleared: number;
  realmsCleared: number;
  /** Daily Quests cleared (kept on this device). */
  dailiesCleared: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  color: string;
  progress: number;
  target: number;
  unlocked: boolean;
}

export function computeAchievements(i: AchievementInput): Achievement[] {
  const defs: Omit<Achievement, 'unlocked'>[] = [
    { id: 'first-blood', name: 'First Blood', description: 'Get your first accepted solution.', icon: 'bolt', color: '#fbbf24', progress: i.solves, target: 1 },
    { id: 'regular', name: 'Regular', description: 'Solve 10 problems.', icon: 'code', color: '#22d3ee', progress: i.solves, target: 10 },
    { id: 'veteran', name: 'Veteran', description: 'Solve 25 problems.', icon: 'shield', color: '#34d399', progress: i.solves, target: 25 },
    { id: 'hard-hitter', name: 'Hard Hitter', description: 'Clear a Hard problem.', icon: 'skull', color: '#fb7185', progress: i.hardestWeight >= 50 ? 1 : 0, target: 1 },
    { id: 'on-fire', name: 'On Fire', description: 'Reach a 3-day streak.', icon: 'flame', color: '#fb923c', progress: i.longestStreak, target: 3 },
    { id: 'unstoppable', name: 'Unstoppable', description: 'Reach a 7-day streak.', icon: 'zap', color: '#f97316', progress: i.longestStreak, target: 7 },
    { id: 'land-baron', name: 'Land Baron', description: 'Hold ground in 3 zones.', icon: 'flag', color: '#a78bfa', progress: i.territoriesHeld, target: 3 },
    { id: 'citadel-keeper', name: 'Citadel Keeper', description: 'Hold a cell in a Citadel.', icon: 'crown', color: '#e879f9', progress: i.hasCitadel ? 1 : 0, target: 1 },
    { id: 'top-ten', name: 'Top Ten', description: 'Break into the top 10 of the college.', icon: 'trophy', color: '#fde047', progress: i.rank && i.rank <= 10 ? 1 : 0, target: 1 },
    { id: 'full-cap', name: 'Full Throttle', description: 'Hit the daily solve cap.', icon: 'target', color: '#2dd4bf', progress: i.dailyCapReached ? 1 : 0, target: 1 },
    { id: 'explorer', name: 'Explorer', description: 'Walk into 10 different zones.', icon: 'compass', color: '#38bdf8', progress: i.explored, target: 10 },
    { id: 'cartographer', name: 'Cartographer', description: 'Explore every zone on campus.', icon: 'map', color: '#60a5fa', progress: i.explored, target: 46 },
    { id: 'first-front', name: 'Front Cleared', description: 'Clear every core quest in one front of the Warpath.', icon: 'route', color: '#34d399', progress: i.frontsCleared, target: 1 },
    { id: 'campaigner', name: 'Campaigner', description: 'Clear 5 fronts of the Warpath.', icon: 'compass', color: '#2dd4bf', progress: i.frontsCleared, target: 5 },
    { id: 'realm-taker', name: 'Realm Taker', description: 'Clear a whole realm of the Warpath.', icon: 'gem', color: '#a78bfa', progress: i.realmsCleared, target: 1 },
    { id: 'warlord', name: 'Warlord', description: 'Clear every realm of the Warpath.', icon: 'trophy', color: '#f472b6', progress: i.realmsCleared, target: 5 },
    { id: 'daily-driver', name: 'Daily Driver', description: 'Clear 3 Daily Quests.', icon: 'gift', color: '#38bdf8', progress: i.dailiesCleared, target: 3 },
  ];
  return defs.map((d) => ({ ...d, progress: Math.min(d.progress, d.target), unlocked: d.progress >= d.target }));
}

/** The numbers the achievements are worked out from, taken from whatever the page has fetched. */
export function achievementInputFrom(parts: {
  solves: number;
  hardestWeight: number;
  longestStreak: number;
  territoriesHeld: number;
  hasCitadel: boolean;
  rank: number | null;
  daily: { qualifyingCount: number; cap: number } | null;
  explored: number;
  frontsCleared?: number;
  realmsCleared?: number;
  dailiesCleared?: number;
}): AchievementInput {
  return {
    solves: parts.solves,
    hardestWeight: parts.hardestWeight,
    longestStreak: parts.longestStreak,
    territoriesHeld: parts.territoriesHeld,
    hasCitadel: parts.hasCitadel,
    rank: parts.rank,
    dailyCapReached: !!parts.daily && parts.daily.qualifyingCount >= parts.daily.cap,
    explored: parts.explored,
    frontsCleared: parts.frontsCleared ?? 0,
    realmsCleared: parts.realmsCleared ?? 0,
    dailiesCleared: parts.dailiesCleared ?? 0,
  };
}

const EXPLORED_PREFIX = 'cc.map.explored.v1:';

/** How many different zones this player has walked into on the map (the map keeps the list in localStorage). */
export function readExploredCount(userId: string): number {
  try {
    const raw = localStorage.getItem(EXPLORED_PREFIX + userId);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

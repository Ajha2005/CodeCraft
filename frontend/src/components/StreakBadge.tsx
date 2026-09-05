import { useEffect, useState } from 'react';
import { fetchStreak, type StreakInfo } from '../lib/api';
import { streakLabel, MISSED_DAY_NUDGE } from '../lib/flavorText';
import { useAuth } from '../auth/AuthContext';

export function StreakBadge({ userId }: { userId: string }) {
  const { flavorTextEnabled } = useAuth();
  const [streak, setStreak] = useState<StreakInfo | null>(null);

  useEffect(() => {
    fetchStreak(userId).then(setStreak).catch(() => {});
  }, [userId]);

  if (!streak) return null;

  const flame = streak.current > 0 ? '🔥' : '💤';

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-lg leading-none">{flame}</span>
      <span className="text-slate-300">
        {flavorTextEnabled ? streakLabel(streak.current) : `${streak.current}-day streak`}
      </span>
      {streak.current === 0 && flavorTextEnabled && (
        <span className="text-slate-500 text-xs italic">{MISSED_DAY_NUDGE}</span>
      )}
    </div>
  );
}

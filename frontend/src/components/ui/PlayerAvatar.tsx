import { colorForUser, initialsOf } from '../../lib/playerColor';

interface PlayerAvatarProps {
  userId?: string | null;
  name?: string | null;
  size?: number;
  ring?: boolean;
  className?: string;
}

/** Round initials badge, colored exactly like the player's territory on the map. */
export function PlayerAvatar({ userId, name, size = 36, ring = true, className }: PlayerAvatarProps) {
  const color = colorForUser(userId);
  return (
    <div
      className={`relative shrink-0 rounded-full flex items-center justify-center font-display font-bold text-slate-950 select-none ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(145deg, ${color}, ${color}aa)`,
        boxShadow: ring ? `0 0 0 2px #070d16, 0 0 0 3.5px ${color}, 0 0 14px ${color}66` : undefined,
      }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </div>
  );
}

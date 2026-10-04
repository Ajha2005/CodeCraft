import { Icon } from '../../components/ui/Icon';
import { difficultyMeta } from './difficulty';

export function DifficultyBadge({ level }: { level: string }) {
  const meta = difficultyMeta(level);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-display text-[0.7rem] font-bold uppercase tracking-[0.12em] ${meta.border} ${meta.bg} ${meta.text}`}
    >
      <Icon name={meta.icon} className="h-3 w-3" />
      {level}
    </span>
  );
}

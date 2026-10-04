import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface SectionTitleProps {
  children: ReactNode;
  icon?: IconName;
  aside?: ReactNode;
  className?: string;
}

export function SectionTitle({ children, icon, aside, className }: SectionTitleProps) {
  return (
    <div className={`flex items-center gap-3 mb-4 ${className ?? ''}`}>
      {icon && <Icon name={icon} className="text-cyan-400 w-[18px] h-[18px]" />}
      <h2 className="font-display text-lg font-bold uppercase tracking-[0.16em] text-slate-100 whitespace-nowrap">{children}</h2>
      <div className="h-px flex-1 bg-gradient-to-r from-cyan-500/40 via-slate-700/60 to-transparent" />
      {aside}
    </div>
  );
}

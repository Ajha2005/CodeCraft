import type { ToastItem } from '../lib/useToasts';
import { Icon, type IconName } from './ui/Icon';

const TONES: Record<ToastItem['tone'], { accent: string; icon: IconName }> = {
  success: { accent: '#34d399', icon: 'check' },
  warning: { accent: '#fbbf24', icon: 'zap' },
  info: { accent: '#22d3ee', icon: 'bell' },
};

const PLACEMENT = {
  'bottom-right': 'bottom-4 right-4 items-end',
  'top-right': 'top-[calc(var(--nav-h)+0.75rem)] right-3 items-end',
  'top-center': 'top-[calc(var(--nav-h)+5rem)] left-1/2 -translate-x-1/2 items-center',
} as const;

interface ToastStackProps {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
  placement?: keyof typeof PLACEMENT;
}

export function ToastStack({ toasts, dismiss, placement = 'bottom-right' }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className={`pointer-events-none fixed z-[100] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 ${PLACEMENT[placement]}`}>
      {toasts.map((t) => {
        const tone = TONES[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            onClick={() => dismiss(t.id)}
            className="hud-panel hud-panel-quiet pointer-events-auto relative w-full cursor-pointer overflow-hidden !rounded-lg py-2.5 pl-3 pr-4 animate-slide-down"
            style={{ borderLeft: `3px solid ${tone.accent}` }}
          >
            <div className="flex items-start gap-2.5">
              <Icon name={tone.icon} className="mt-0.5 h-4 w-4 shrink-0" style={{ color: tone.accent }} />
              <p className="text-sm leading-snug text-slate-100">{t.text}</p>
            </div>
            <span
              className="absolute bottom-0 left-0 h-[2px] w-full origin-left"
              style={{ background: tone.accent, animation: `toast-life ${t.durationMs}ms linear forwards` }}
            />
          </div>
        );
      })}
      <style>{`
        @keyframes toast-life {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
}

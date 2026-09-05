import type { ToastItem } from '../lib/useToasts';

const TONE_STYLES: Record<ToastItem['tone'], string> = {
  success: 'border-emerald-500/60 bg-emerald-950/90 text-emerald-100',
  warning: 'border-amber-500/60 bg-amber-950/90 text-amber-100',
  info: 'border-slate-600 bg-slate-900/95 text-slate-100',
};

export function ToastStack({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto cursor-pointer rounded-lg border px-4 py-2.5 text-sm shadow-lg backdrop-blur animate-[toast-in_0.2s_ease-out] ${TONE_STYLES[t.tone]}`}
        >
          {t.text}
        </div>
      ))}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

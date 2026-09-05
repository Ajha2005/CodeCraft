import { useCallback, useRef, useState } from 'react';

export interface ToastItem {
  id: number;
  text: string;
  tone: 'success' | 'warning' | 'info';
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (text: string, tone: ToastItem['tone'] = 'info', durationMs = 4000) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, text, tone }]);
      const timer = setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

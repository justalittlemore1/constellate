import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';

export type ToastTone = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type Show = (message: string, tone?: ToastTone) => void;
const ToastContext = createContext<Show | null>(null);

const DURATION_MS = 4000;

/** Brief, non-blocking messages announced politely to screen readers (`role="status"`). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const show = useCallback<Show>((message, tone = 'info') => {
    const id = next.current++;
    setItems((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), DURATION_MS);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'surface rounded-full border px-4 py-2 text-sm font-semibold shadow-lg',
              t.tone === 'error'
                ? 'border-flag/60 text-flag'
                : t.tone === 'success'
                  ? 'border-topic/60'
                  : 'border-line',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Show {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}

import { useId } from 'react';
import { cx } from './cx';

export interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Labelled on/off switch (`role="switch"`); the whole row is a 44 px target. */
export function Toggle({ label, description, checked, onChange }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="block font-semibold">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-ink-2 text-sm">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        onClick={() => onChange(!checked)}
        className={cx(
          'hover-wash relative inline-flex h-11 w-16 shrink-0 items-center border transition-colors',
          checked ? 'border-topic bg-topic/25' : 'border-line bg-white/5',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'absolute top-1/2 size-7 -translate-y-1/2 transition-[left]',
            checked ? 'bg-topic left-[calc(100%-2rem)]' : 'bg-ink-2 left-1',
          )}
        />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

const FIELD =
  'w-full rounded-xl border border-line bg-white/5 px-3 text-ink placeholder:text-ink-2/70 focus:border-topic';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  /** visually hide the label (still read by screen readers) */
  hideLabel?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, hideLabel, className, id: idProp, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <div className={className}>
      <label htmlFor={id} className={cx('mb-1 block text-sm font-semibold text-ink-2', hideLabel && 'sr-only')}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cx(FIELD, 'min-h-11')}
        {...rest}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-2">
          {hint}
        </p>
      )}
    </div>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextArea({ label, className, id: idProp, ...rest }: TextAreaProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink-2">
        {label}
      </label>
      <textarea id={id} rows={3} className={cx(FIELD, 'min-h-11 py-2')} {...rest} />
    </div>
  );
}

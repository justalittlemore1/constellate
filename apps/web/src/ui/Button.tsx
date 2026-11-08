import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brain' | 'editorial';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-topic text-bg font-semibold',
  secondary: 'border border-line text-ink',
  ghost: 'text-ink',
  danger: 'bg-flag text-bg font-semibold',
  brain: 'brain-gradient text-bg font-semibold shadow-[0_0_24px_rgba(199,155,255,0.35)]',
  /** editorial style: hairline rules above and below, spaced serif capitals, no fill */
  editorial: 'border-y border-line font-semibold uppercase tracking-[0.14em] text-ink',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * Hover / press feedback: the app-wide grey `wash` (default), or a yellow `border` — used only by
   * "Try a demo conversation", the one deliberate exception.
   */
  feedback?: 'wash' | 'border';
  icon?: ReactNode;
  block?: boolean;
}

/** Text button. Always at least 44 px tall; `type="button"` unless set. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', feedback = 'wash', icon, block, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        feedback === 'wash' ? 'hover-wash' : 'hover:border-thread active:border-thread',
        'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 px-5 text-[1.0625rem] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

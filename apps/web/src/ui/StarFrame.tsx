import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from './cx';

/** The class behind every star-chart frame; use it directly when a wrapper element is awkward. */
export const STAR_FRAME_CLASS = 'star-frame';

type StarFrameProps<T extends ElementType> = {
  /** element to render (default `div`), e.g. `section` or `aside` */
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

/**
 * The "star-chart frame" of the editorial style: square corners, a 1 px top hairline in
 * `--thread` at ~60 % and 10 px corner ticks at the top-left and top-right (CSS in index.css,
 * tokens `--frame-line` / `--frame-tick`). `ui/Sheet` uses it; A3 and A6 can reuse it for their
 * own sheets and panels.
 */
export function StarFrame<T extends ElementType = 'div'>({ as, className, children, ...rest }: StarFrameProps<T>) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={cx(STAR_FRAME_CLASS, className)} {...rest}>
      {children}
    </Tag>
  );
}

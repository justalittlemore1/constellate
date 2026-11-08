import type { ReactNode } from 'react';
import { cx } from './cx';

export type ChipTone = 'neutral' | 'topic' | 'revisit' | 'thread' | 'highlight' | 'flag';

const TONES: Record<ChipTone, string> = {
  neutral: 'border-line text-ink-2',
  topic: 'border-topic/50 text-topic',
  revisit: 'border-revisit/50 text-revisit',
  thread: 'border-thread/50 text-thread',
  highlight: 'border-highlight/50 text-highlight',
  flag: 'border-flag/50 text-flag',
};

/** Small static label (Solo / Group, status). Meaning always lives in the text, not the colour. */
export function Chip({ tone = 'neutral', icon, children }: { tone?: ChipTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 border px-2 py-0.5 text-[0.72rem] font-semibold leading-tight',
        TONES[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

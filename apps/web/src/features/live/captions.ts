/**
 * The caption strip shows one line. Long captions keep their newest words: whole words only,
 * with a leading ellipsis when something was cut, so the left edge never shows half a word.
 * (A CSS fade on the left edge covers widths the character budget misjudges.)
 */
export const CAPTION_TAIL_CHARS = 44;

export interface CaptionTail {
  /** something before `final` was dropped */
  cut: boolean;
  final: string;
  interim: string;
}

export function captionTail(final: string, interim: string | null, maxChars = CAPTION_TAIL_CHARS): CaptionTail {
  const words = [
    ...final.split(/\s+/).filter(Boolean).map((w) => ({ w, interim: false })),
    ...(interim ?? '').split(/\s+/).filter(Boolean).map((w) => ({ w, interim: true })),
  ];
  const kept: typeof words = [];
  let used = 0;
  for (let i = words.length - 1; i >= 0; i--) {
    const add = words[i]!.w.length + (kept.length ? 1 : 0);
    // always keep the newest word, even if it alone is too long
    if (kept.length && used + add > maxChars) break;
    kept.unshift(words[i]!);
    used += add;
  }
  return {
    cut: kept.length < words.length,
    final: kept.filter((k) => !k.interim).map((k) => k.w).join(' '),
    interim: kept.filter((k) => k.interim).map((k) => k.w).join(' '),
  };
}

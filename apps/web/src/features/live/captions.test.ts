import { describe, expect, it } from 'vitest';
import { captionTail } from './captions';

describe('captionTail', () => {
  it('keeps short captions whole', () => {
    expect(captionTail('So I went to church.', 'and', 44)).toEqual({ cut: false, final: 'So I went to church.', interim: 'and' });
  });

  it('drops whole words from the start, never half a word', () => {
    const t = captionTail('Whether Jesus existed as a historical figure and what historians agree on.', null, 30);
    expect(t.cut).toBe(true);
    expect(t.final).toBe('and what historians agree on.');
    expect('Whether Jesus existed as a historical figure and what historians agree on.'.endsWith(t.final)).toBe(true);
    expect(t.final.length).toBeLessThanOrEqual(30);
  });

  it('keeps the interim words first when space runs out', () => {
    const t = captionTail('A long final sentence that came before', 'the newest interim words', 31);
    expect(t).toEqual({ cut: true, final: 'before', interim: 'the newest interim words' });
  });

  it('keeps the newest word even if it alone is too long', () => {
    expect(captionTail('a supercalifragilisticexpialidocious', null, 10)).toEqual({
      cut: true,
      final: 'supercalifragilisticexpialidocious',
      interim: '',
    });
  });

  it('handles empty input', () => {
    expect(captionTail('', null)).toEqual({ cut: false, final: '', interim: '' });
  });
});

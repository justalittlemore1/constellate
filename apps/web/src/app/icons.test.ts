import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// tests run with apps/web as the working directory
const web = (rel: string) => resolve(process.cwd(), rel);
const PNG_SIGNATURE = '89504e470d0a1a0a';

/** Width and height from a PNG's IHDR chunk (bytes 16–23), after checking the signature. */
function pngSize(publicPath: string): { width: number; height: number } {
  const buf = readFileSync(web(`public${publicPath}`));
  expect(buf.subarray(0, 8).toString('hex'), `${publicPath} is a PNG`).toBe(PNG_SIGNATURE);
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const viteConfig = readFileSync(web('vite.config.ts'), 'utf8');
const indexHtml = readFileSync(web('index.html'), 'utf8');

/** `{ src: '/icons/…png', sizes: 'WxH' … }` entries of the PWA manifest. */
const manifestIcons = [...viteConfig.matchAll(/src:\s*'([^']+\.png)',\s*sizes:\s*'(\d+)x(\d+)'/g)].map((m) => ({
  src: m[1]!,
  width: Number(m[2]),
  height: Number(m[3]),
}));

describe('app icons', () => {
  it('lists the PWA icons in the manifest (192, 512 and a maskable 512)', () => {
    expect(manifestIcons.map((i) => i.src)).toEqual([
      '/icons/pwa-192.png',
      '/icons/pwa-512.png',
      '/icons/maskable-512.png',
    ]);
  });

  it.each(manifestIcons)('$src is really $width×$height, as the manifest says', ({ src, width, height }) => {
    expect(pngSize(src)).toEqual({ width, height });
  });

  it('the apple-touch-icon is 180×180 and the favicon 64×64', () => {
    const href = (rel: string) => indexHtml.match(new RegExp(`rel="${rel}"[^>]*href="([^"]+)"`))?.[1];
    expect(href('apple-touch-icon')).toBe('/icons/apple-touch-icon.png');
    expect(pngSize(href('apple-touch-icon')!)).toEqual({ width: 180, height: 180 });
    expect(href('icon')).toBe('/icons/favicon-64.png');
    expect(pngSize(href('icon')!)).toEqual({ width: 64, height: 64 });
  });
});

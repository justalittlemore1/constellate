import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { usePrefs } from '../lib/prefs';
import { renderApp } from '../test/render';
import { FILAMENTS } from './RecordStar';

afterEach(() => usePrefs.getState().reset());

describe('Home record button — "F4: filaments ending in stars"', () => {
  it('is a large button named "Start recording" that replaces the mic orb', async () => {
    renderApp();
    const button = screen.getByRole('button', { name: 'Start recording' });
    expect(button).toHaveClass('size-36'); // 144 px target
    expect(button).not.toHaveAttribute('aria-describedby'); // the hint text is hidden
    expect(screen.queryByRole('button', { name: 'Start a conversation' })).not.toBeInTheDocument();
    expect(button.querySelector('.orb, .orb-still')).toBeNull(); // no circle, no glow
    await userEvent.click(button);
    expect(screen.getByTestId('location')).toHaveTextContent('/live/new');
  });

  it('draws six fine filaments, each ending in a small star, around a two-part core', () => {
    renderApp();
    const svg = within(screen.getByRole('button', { name: 'Start recording' })).getByTestId('record-star');
    expect(svg).toHaveAttribute('viewBox', '-60 -60 120 120');
    expect(svg).toHaveAttribute('aria-hidden', 'true');

    const lines = [...svg.querySelectorAll('[data-part="filaments"] line')];
    expect(lines).toHaveLength(6);
    expect(lines.map((l) => ['x1', 'y1', 'x2', 'y2'].map((a) => Number(l.getAttribute(a))))).toEqual([
      [0, -11, 0, -48],
      [10, -5, 40, -23],
      [8, 8, 30, 34],
      [-3, 11, -12, 50],
      [-10, 4, -46, 16],
      [-8, -8, -30, -36],
    ]);
    for (const l of lines) {
      expect(l).toHaveAttribute('stroke', '#FFD58A');
      expect(l).toHaveAttribute('stroke-width', '0.8');
      expect(l).toHaveAttribute('stroke-opacity', '0.75');
      expect(l).toHaveAttribute('stroke-linecap', 'round');
    }

    const tips = [...svg.querySelectorAll('[data-part="tip"]')];
    expect(tips).toHaveLength(6);
    tips.forEach((t, i) => {
      expect(t).toHaveAttribute('fill', '#FFF6E0');
      expect(Number(t.getAttribute('cx'))).toBe(FILAMENTS[i]!.to[0]);
      expect(Number(t.getAttribute('cy'))).toBe(FILAMENTS[i]!.to[1]);
      const r = Number(t.getAttribute('r'));
      expect(r).toBeGreaterThanOrEqual(1.3);
      expect(r).toBeLessThanOrEqual(1.8);
    });

    const core = svg.querySelector('[data-part="core"]')!;
    expect(core).toHaveAttribute('r', '10');
    expect(core).toHaveAttribute('fill', '#FFF3D6');
    const centre = svg.querySelector('[data-part="centre"]')!;
    expect(centre).toHaveAttribute('r', '4.5');
    expect(centre).toHaveAttribute('fill', '#fff');
  });

  it('turns slowly and shifts its core colour, but is static under reduced motion', () => {
    const { unmount } = renderApp();
    let svg = screen.getByTestId('record-star');
    expect(svg).toHaveAttribute('data-still', 'false');
    expect(svg.querySelector('[data-part="filaments"]')).toHaveClass('record-star-spin');
    expect(svg.querySelector('[data-part="core"]')).toHaveClass('record-star-core');
    unmount();

    usePrefs.getState().set({ reduceMotion: true });
    renderApp();
    svg = screen.getByTestId('record-star');
    expect(svg).toHaveAttribute('data-still', 'true');
    expect(svg.querySelector('[data-part="filaments"]')).not.toHaveClass('record-star-spin');
    expect(svg.querySelector('[data-part="core"]')).not.toHaveClass('record-star-core');
  });

  it('turns once per ~26 s and loops its colour over 10 s (CSS), with reduced-motion rules stopping all animation', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toMatch(/\.record-star-spin\s*\{[^}]*animation:\s*record-spin 26s linear infinite/);
    expect(css).toMatch(
      /\.record-star-core\s*\{[^}]*animation:\s*record-core-shift 10s ease-in-out infinite alternate/,
    );
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  });

  it('the first Tab lands on it, so it is reachable without a pointer', async () => {
    renderApp();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Start recording' })).toHaveFocus();
  });
});

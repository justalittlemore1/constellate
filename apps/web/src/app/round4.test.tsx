import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { nodeRadius } from '../features/brain/brainLayout';
import { STAR_ART, starRenderers } from '../features/brain/brainRenderers';
import { BrainScreen } from '../features/brain/BrainScreen';
import { installFlowDomStubs } from '../features/map/testing';
import { createMockApi, mockBrainFromGraphs } from '../lib/api';
import { loadDemoGraph } from '../lib/fixtures';
import { usePrefs } from '../lib/prefs';
import { renderApp } from '../test/render';
import { PHONE_FRAME, PhoneFrame } from './PhoneFrame';

// the Brain canvas needs a real browser: one button per visible star
vi.mock('react-force-graph-2d', () => ({
  default: (props: {
    graphData: { nodes: { id: string; name: string }[] };
    nodeVisibility?: (n: { id: string }) => boolean;
  }) => (
    <div data-testid="force-graph">
      {props.graphData.nodes
        .filter((n) => !props.nodeVisibility || props.nodeVisibility(n))
        .map((n) => (
          <button key={n.id} type="button">
            star {n.name}
          </button>
        ))}
    </div>
  ),
}));

// /c/:id renders A3's React Flow map, which needs these jsdom stubs
beforeAll(() => installFlowDomStubs());
afterEach(() => {
  vi.restoreAllMocks();
  usePrefs.getState().reset();
});

const demo = loadDemoGraph();
const payload = mockBrainFromGraphs([demo]);
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('1. wider phone frame on desktop', () => {
  it('is 430 × 932 (shorter only when the window is), and invisible on phones', () => {
    expect(PHONE_FRAME).toEqual({ width: 430, height: 932 });
    render(<PhoneFrame>app</PhoneFrame>);
    const frame = screen.getByTestId('phone-frame');
    expect(frame.className).toContain('min-[600px]:w-[430px]');
    expect(frame.className).toContain('min-[600px]:h-[min(932px,calc(100dvh-3rem))]');
    expect(frame.className).toContain('h-dvh w-full'); // full screen below 600 px: no frame on phones
  });
});

describe('2. larger text by default', () => {
  it('body 18 px, smallest 15 px, headings scaled up', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/body \{[^}]*font-size: 1\.125rem/); // 18 px
    expect(css).toMatch(/--text-xs: 0\.9375rem/); // 15 px, the smallest step
    expect(css).toMatch(/--text-base: 1\.125rem/);
    expect(css).toMatch(/--text-lg: 1\.375rem/);
    expect(css).toMatch(/--text-2xl: 1\.75rem/);
    expect(css).toMatch(/--text-4xl: 2\.5rem/);
    expect(read('src/ui/Chip.tsx')).toContain('text-[0.9375rem]');
    expect(read('src/ui/Button.tsx')).toContain('text-[1.0625rem]');
  });
});

/** Records canvas calls. */
function recordingCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, name) =>
        (...args: unknown[]) =>
          void calls.push({ name: String(name), args }),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('3. Brain star proportions', () => {
  it('a smaller core (60 % of the old size) and longer spikes (1.65 ×), same fine strokes, size by mentions', () => {
    expect(STAR_ART.coreRatio).toBe(0.6);
    expect(STAR_ART.spikeRatio / 2.0).toBeGreaterThanOrEqual(1.5); // was 2.0 node radii
    expect(STAR_ART.spikeRatio / 2.0).toBeLessThanOrEqual(1.8);
    for (const mentions of [1, 4, 9]) {
      const radius = nodeRadius(mentions);
      const { ctx, calls } = recordingCtx();
      starRenderers.drawNode({
        ctx,
        x: 0,
        y: 0,
        radius,
        name: 'X',
        scale: 1,
        opacity: 1,
        dimmed: false,
        selected: false,
        showLabel: false,
        glow: 1,
        textSize: 1,
        reduced: true,
      });
      const arcs = calls.filter((c) => c.name === 'arc').map((c) => Number(c.args[2]));
      expect(arcs[0]).toBeCloseTo(radius * 0.6); // core
      expect(arcs[1]).toBeCloseTo(radius * 0.6 * 0.4); // white centre
      const firstMove = calls.find((c) => c.name === 'moveTo')!.args as [number, number];
      expect(Math.abs(firstMove[1])).toBeCloseTo(radius * STAR_ART.spikeRatio); // vertical spike half-length
    }
  });
});

describe('4. the Brain reveal plays on every entry', () => {
  async function apiWithBrain() {
    const api = createMockApi();
    await api.rebuildBrain();
    return api;
  }
  const stars = () => within(screen.getByTestId('force-graph')).queryAllByRole('button').length;

  function giveCanvasASize() {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  }

  it('opening the page starts with no stars, reveals them one by one, and again after leaving and coming back', async () => {
    giveCanvasASize();
    const api = await apiWithBrain();
    const first = renderApp({ route: '/brain', api, element: <BrainScreen /> });
    await screen.findByTestId('force-graph');
    expect(stars()).toBeLessThan(payload.concepts.length); // not all at once
    await waitFor(() => expect(stars()).toBe(payload.concepts.length), { timeout: 4000 });
    first.unmount();

    // come back: the reveal starts over
    renderApp({ route: '/brain', api, element: <BrainScreen /> });
    await screen.findByTestId('force-graph');
    expect(stars()).toBeLessThan(payload.concepts.length);
    await waitFor(() => expect(stars()).toBe(payload.concepts.length), { timeout: 4000 });
  });

  it('the galaxy hint sits below the canvas (in the flow), not over the lowest labels', async () => {
    giveCanvasASize();
    const api = await apiWithBrain();
    renderApp({ route: '/brain', api, element: <BrainScreen /> });
    const hint = await screen.findByTestId('galaxy-hint');
    expect(hint.className).not.toMatch(/absolute/);
    expect(screen.getByTestId('brain-canvas').contains(hint)).toBe(false);
  });

  it('is instant under reduced motion', async () => {
    usePrefs.getState().set({ reduceMotion: true });
    giveCanvasASize();
    const api = await apiWithBrain();
    renderApp({ route: '/brain', api, element: <BrainScreen /> });
    await screen.findByTestId('force-graph');
    await act(async () => {});
    expect(stars()).toBe(payload.concepts.length);
  });
});

describe('5. the diary is a bottom sheet', () => {
  it('the phone frame clips instead of hiding overflow, so focus can never scroll it (which lifted sheets to the top)', () => {
    render(<PhoneFrame>app</PhoneFrame>);
    const frame = screen.getByTestId('phone-frame');
    expect(frame).toHaveClass('overflow-clip');
    expect(frame).not.toHaveClass('overflow-hidden');
  });

  it('attached to the bottom, capped at 58 %, content scrolling inside', async () => {
    renderApp({ route: `/c/${demo.conversation.id}?diary=1` });
    const diary = await screen.findByRole('dialog', { name: 'Diary' });
    expect(diary).toHaveAttribute('data-side', 'bottom');
    expect(diary).toHaveClass('bottom-0');
    expect(diary).not.toHaveClass('top-0');
    expect(diary).toHaveStyle({ maxHeight: '58%' });
    expect(diary.querySelector('[data-sheet-body]')).toHaveClass('overflow-y-auto');
  });
});

describe('6. one hover / press style on text items', () => {
  it('sidebar conversation rows, Brain and Settings use the grey wash', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const sidebar = screen.getByRole('dialog', { name: 'Constellate' });
    await within(sidebar).findByRole('link', { name: new RegExp(demo.conversation.title) });
    for (const name of [new RegExp(demo.conversation.title), /^Highlights$/, /^Brain$/, /^Settings$/]) {
      const link = within(sidebar).getByRole('link', { name });
      expect(link).toHaveClass('hover-wash');
      expect(link.className).not.toMatch(/hover:(text|border|bg)-/);
    }
  });

  it('every item on the Highlights page is a washed link (no yellow, no other variant)', async () => {
    renderApp({ route: '/favorites' });
    const highlights = await screen.findByRole('region', { name: 'Highlighted topics' });
    await within(highlights).findAllByRole('link');
    const links = screen.getAllByRole('link').filter((l) => l.closest('main'));
    expect(links.length).toBeGreaterThanOrEqual(5); // 1 starred conversation, 2 highlights, 2 flags
    for (const link of links) {
      expect(link).toHaveClass('hover-wash');
      expect(link.className).not.toMatch(/hover:(text|border|bg)-/);
    }
    // the link's name starts with its visible text (axe: label-content-name-mismatch)
    for (const link of within(highlights).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-label');
      expect(link.textContent!.startsWith('Resurrection Accounts')).toBe(true);
    }
    // each moment is one link (the separate map icon is behind a flag)
    expect(
      within(highlights).getAllByRole('link', { name: /^Resurrection Accounts.*highlighted topic.*open in the map$/ }),
    ).toHaveLength(2);
  });

  it('the only exception: "Try a demo conversation" keeps its yellow border', () => {
    renderApp();
    const demoButton = screen.getByRole('button', { name: 'Try a demo conversation' });
    expect(demoButton).toHaveClass('hover:border-thread');
    expect(demoButton).not.toHaveClass('hover-wash');
    expect(screen.getByRole('button', { name: 'Start a conversation' })).toHaveClass('hover-wash');
  });
});

describe('7. the diary promise cue field', () => {
  async function openPromises() {
    renderApp({ route: `/c/${demo.conversation.id}?diary=1` });
    const diary = await screen.findByRole('dialog', { name: 'Diary' });
    return within(diary).getByRole('region', { name: 'Promises' });
  }

  it('is one clean, solid underline across the input on the text line, with a 44 px touch target', async () => {
    const promises = await openPromises();
    const cue = within(promises).getByRole('textbox', { name: 'When should you do this?' });
    expect(cue).toHaveClass('border-b', 'border-solid', 'w-40', 'h-[1.35em]', 'align-baseline');
    expect(cue.className).not.toMatch(/border-dashed|min-h-11/); // no second line below the text
    expect(cue).not.toHaveAttribute('placeholder', '___'); // the "3 underscores" were a placeholder
    const target = within(promises).getByTestId('promise-cue-target');
    expect(target).toContainElement(cue);
    expect(target).toHaveClass('py-3'); // 1.35em line + 2 × 12 px ≥ 44 px
  });

  it('has no stray dotted line: open-thread rows dash only their left edge', async () => {
    renderApp({ route: `/c/${demo.conversation.id}?diary=1` });
    const diary = await screen.findByRole('dialog', { name: 'Diary' });
    const rows = within(within(diary).getByRole('region', { name: 'Open threads' })).getAllByRole('listitem');
    for (const row of rows) {
      expect(row.className).not.toMatch(/(^|\s)border-dashed(\s|$)/); // would dash the hairline divider too
      expect(row.className).toContain('[border-left-style:dashed]');
    }
  });
});

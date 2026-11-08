import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  drawConstellationLink,
  LABEL_PX,
  starRenderers,
  CONSTELLATION_LINE_PX,
} from '../features/brain/brainRenderers';
import { installFlowDomStubs } from '../features/map/testing';
import { createMockApi } from '../lib/api';
import { loadDemoGraph } from '../lib/fixtures';
import { setUiFlags } from '../lib/uiFlags';
import { renderApp } from '../test/render';
import { BOTTOM_SHEET_MAX_HEIGHT, BottomSheet, Button, IconButton, Sheet } from '../ui';

// /c/:id renders A3's React Flow map, which needs these jsdom stubs
beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('font: Fraunces, self-hosted', () => {
  it('is the --font and --font-display token, loaded from the package with its optical-size axis', () => {
    const tokens = read('src/ui/tokens.css');
    expect(tokens).toMatch(/--font: 'Fraunces Variable'/);
    expect(tokens).toMatch(/--font-display: 'Fraunces Variable'/);
    expect(tokens).not.toMatch(/Cormorant/);
    const main = read('src/main.tsx');
    expect(main).toMatch(/@fontsource-variable\/fraunces\/opsz\.css/);
    expect(read('src/index.css')).toMatch(/font-optical-sizing: auto/);
    expect(read('index.html')).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  it('is large enough: body 18 px, nothing below 15 px, small text at weight 500', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/body \{[^}]*font-size: 1\.125rem/); // 18 px
    expect(css).toMatch(/--text-xs: 0\.9375rem/); // the smallest step: 15 px
    expect(css).toMatch(/\.text-xs,\s*\.text-sm,\s*small \{\s*font-weight: 500/);
    // no fixed sizes below 15 px in A4 components (0.9375rem = 15 px)
    for (const file of ['src/ui/Chip.tsx', 'src/ui/Button.tsx']) {
      for (const m of read(file).matchAll(/text-\[([\d.]+)rem\]/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(0.9375);
    }
    expect(LABEL_PX).toBeGreaterThanOrEqual(15); // Brain canvas labels
  });
});

/** Records canvas calls and property writes. */
function recordingCtx() {
  const log: { kind: 'call' | 'set'; name: string; args: unknown[] }[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, name) =>
        (...args: unknown[]) => {
          log.push({ kind: 'call', name: String(name), args });
          return String(name).endsWith('Gradient') ? { addColorStop() {} } : undefined;
        },
      set: (_t, name, value) => (log.push({ kind: 'set', name: String(name), args: [value] }), true),
    },
  ) as unknown as CanvasRenderingContext2D;
  const calls = (n: string) => log.filter((e) => e.kind === 'call' && e.name === n);
  const sets = (n: string) => log.filter((e) => e.kind === 'set' && e.name === n).map((e) => e.args[0]);
  return { ctx, calls, sets };
}

function drawLink(relation: 'broader' | 'related' | 'co_discussed', progress = 1) {
  const rec = recordingCtx();
  drawConstellationLink({
    ctx: rec.ctx,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    relation,
    weight: 0.5,
    lit: false,
    opacity: 1,
    scale: 1,
    progress,
  });
  return rec;
}

describe('Brain links: classic constellation lines', () => {
  it('are the default; the comet renderer only draws behind its flag', () => {
    const rec = recordingCtx();
    const d = {
      ctx: rec.ctx,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      relation: 'broader' as const,
      weight: 0.5,
      lit: false,
      opacity: 1,
      scale: 1,
    };
    starRenderers.drawLink(d);
    expect(rec.calls('createLinearGradient')).toHaveLength(0); // no comet trail
    setUiFlags({ brainCometLinks: true });
    const comet = recordingCtx();
    starRenderers.drawLink({ ...d, ctx: comet.ctx });
    expect(comet.calls('createLinearGradient')).toHaveLength(1);
  });

  it('broader and related are thin, even lines of the same width', () => {
    const broader = drawLink('broader');
    const related = drawLink('related');
    expect(broader.sets('lineWidth')).toEqual([CONSTELLATION_LINE_PX]);
    expect(related.sets('lineWidth')).toEqual([CONSTELLATION_LINE_PX]);
    expect(CONSTELLATION_LINE_PX).toBeLessThanOrEqual(1);
    expect(related.calls('setLineDash')[0]!.args[0]).toEqual([]); // solid
  });

  it('broader carries a tiny chevron at the midpoint pointing broader → narrower; related has none', () => {
    const broader = drawLink('broader');
    expect(broader.calls('stroke')).toHaveLength(2); // the line, then the chevron
    const arm1 = broader.calls('moveTo')[1]!.args as [number, number];
    const tip = broader.calls('lineTo')[1]!.args as [number, number];
    const arm2 = broader.calls('lineTo')[2]!.args as [number, number];
    expect(tip[0]).toBeGreaterThan(50); // tip just past the midpoint, toward the narrower end (x = 100)
    expect(tip[0]).toBeLessThan(56);
    expect(arm1[0]).toBeLessThan(tip[0]); // arms trail back toward the broader end
    expect(arm2[0]).toBeLessThan(tip[0]);
    expect(Math.sign(arm1[1])).toBe(-Math.sign(arm2[1])); // one on each side
    expect(drawLink('related').calls('stroke')).toHaveLength(1);
  });

  it('co-discussed stays dotted: evenly spaced dots, no line', () => {
    const rec = drawLink('co_discussed');
    expect(rec.calls('lineTo')).toHaveLength(0);
    const xs = rec.calls('arc').map((c) => Number(c.args[0]));
    expect(xs.length).toBeGreaterThan(5);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!);
  });

  it('draw in with the reveal (no chevron until the line reaches the midpoint)', () => {
    expect(drawLink('broader', 0).calls('stroke')).toHaveLength(0);
    expect(drawLink('broader', 0.3).calls('stroke')).toHaveLength(1);
    expect(drawLink('broader', 0.6).calls('stroke')).toHaveLength(2);
  });
});

describe('sheets attach to the bottom, capped at ~58 % of the screen', () => {
  function Harness({ side }: { side?: 'bottom' | 'left' }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Sheet" side={side}>
          <p>Long content</p>
        </Sheet>
      </>
    );
  }

  it('is capped at 58 % with the content scrolling inside', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Sheet' });
    expect(BOTTOM_SHEET_MAX_HEIGHT).toBe('58%');
    expect(dialog).toHaveStyle({ maxHeight: '58%' });
    expect(dialog).toHaveClass('bottom-0');
    expect(dialog.querySelector('[data-sheet-body]')).toHaveClass('overflow-y-auto');
  });

  it('closes on a scrim tap or Escape, with focus handling unchanged', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    await user.click(opener);
    await user.click(document.querySelector('.sheet-scrim')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it('the left drawer (sidebar) is not capped', async () => {
    render(<Harness side="left" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Sheet' }).style.maxHeight).toBe('');
  });

  it('BottomSheet is exported for A6', () => {
    render(
      <BottomSheet open onClose={() => {}} title="Consent">
        x
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Consent' });
    expect(dialog).toHaveAttribute('data-side', 'bottom');
    expect(dialog).toHaveClass('star-frame');
  });

  it('the diary and the concept sheet use it', async () => {
    const user = userEvent.setup();
    renderApp({ route: `/c/${demo.conversation.id}?diary=1` });
    expect(await screen.findByRole('dialog', { name: 'Diary' })).toHaveStyle({ maxHeight: '58%' });
    await user.keyboard('{Escape}');
  });
});

describe('the sidebar closes, navigates, and focuses the new screen’s heading', () => {
  async function choose(name: string | RegExp) {
    const user = userEvent.setup();
    renderApp({ api: createMockApi() });
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const sidebar = screen.getByRole('dialog', { name: 'Constellate' });
    await within(sidebar).findByRole('link', { name: new RegExp(demo.conversation.title) });
    await user.click(within(sidebar).getByRole('link', { name }));
    expect(screen.queryByRole('dialog', { name: 'Constellate' })).not.toBeInTheDocument();
  }

  it('a conversation', async () => {
    await choose(new RegExp(demo.conversation.title));
    expect(screen.getByTestId('location')).toHaveTextContent(`/c/${demo.conversation.id}`);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
  });

  it('Highlights', async () => {
    await choose('Highlights');
    expect(screen.getByTestId('location')).toHaveTextContent('/favorites');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Highlights' })).toHaveFocus());
  });

  it('Brain', async () => {
    await choose('Brain');
    expect(screen.getByTestId('location')).toHaveTextContent('/brain');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Brain' })).toHaveFocus());
  });

  it('Settings', async () => {
    await choose('Settings');
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toHaveFocus());
  });

  it('“BRAIN” keeps its capitals and letter-spacing', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const brain = within(screen.getByRole('dialog', { name: 'Constellate' })).getByRole('link', { name: 'Brain' });
    expect(brain).toHaveClass('uppercase');
    expect(brain.className).toMatch(/tracking-\[0\.14em\]/);
  });
});

describe('one hover / press effect app-wide', () => {
  it('is defined once: a ~7.5 % white wash on hover (mouse) and on press (touch)', () => {
    expect(read('src/ui/tokens.css')).toMatch(/--fill-ghost-hover: rgba\(255, 255, 255, 0\.075\)/);
    const css = read('src/index.css');
    expect(css).toMatch(
      /@media \(hover: hover\) \{\s*\.hover-wash:hover \{\s*background-image: linear-gradient\(var\(--fill-ghost-hover\)/,
    );
    expect(css).toMatch(/\.hover-wash:active \{\s*background-image: linear-gradient\(var\(--fill-ghost-hover\)/);
  });

  it('every button, icon button and sidebar row uses it; nothing turns yellow on hover', async () => {
    render(
      <>
        <Button>Text</Button>
        <IconButton label="Icon">i</IconButton>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Text' })).toHaveClass('hover-wash');
    expect(screen.getByRole('button', { name: 'Icon' })).toHaveClass('hover-wash');

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const sidebar = screen.getByRole('dialog', { name: 'Constellate' });
    await within(sidebar).findByRole('link', { name: new RegExp(demo.conversation.title) });
    for (const link of within(sidebar).getAllByRole('link')) {
      expect(link).toHaveClass('hover-wash');
      expect(link.className).not.toMatch(/hover:text-thread|hover:bg-/);
    }
  });

  it('A4 components carry no other hover colour changes', () => {
    // the one exception, "Try a demo conversation", is Button's `feedback="border"`
    expect(read('src/ui/Button.tsx').match(/hover:(text|bg|border)-[^\s'"]+/g)).toEqual(['hover:border-thread']);
    const files = [
      'src/ui/IconButton.tsx',
      'src/features/library/LibraryDrawer.tsx',
      'src/features/library/FavoritesScreen.tsx',
      'src/features/library/DiarySheet.tsx',
      'src/features/brain/BrainScreen.tsx',
      'src/features/brain/ConceptSheet.tsx',
    ];
    for (const f of files) expect(read(f)).not.toMatch(/hover:(text|bg|border)-/);
  });
});

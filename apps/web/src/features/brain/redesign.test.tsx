import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi, mockBrainFromGraphs } from '../../lib/api';
import { loadDemoGraph } from '../../lib/fixtures';
import { usePrefs } from '../../lib/prefs';
import { renderApp } from '../../test/render';
import { BrainCanvas } from './BrainCanvas';
import { dotRenderers, type BrainRenderers } from './brainRenderers';
import { BrainScreen } from './BrainScreen';
import { LINK_DRAW_MS, revealOrder, revealPlan, STAR_FADE_MS, starOpacity, useStarReveal } from './starReveal';

/** A canvas context that ignores every call (enough for the renderers to run). */
function fakeCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, name) =>
        name === 'createRadialGradient'
          ? () => ({ addColorStop() {} })
          : (...args: unknown[]) => void calls.push({ name: String(name), args }),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// The canvas needs a real browser: render one button per *visible* node and run the node renderer.
vi.mock('react-force-graph-2d', () => ({
  default: (props: {
    graphData: { nodes: { id: string; name: string; radius: number }[] };
    nodeVisibility?: (n: { id: string }) => boolean;
    nodeCanvasObject?: (n: unknown, ctx: CanvasRenderingContext2D, scale: number) => void;
    onNodeClick: (n: { id: string }) => void;
  }) => {
    const visible = props.graphData.nodes.filter((n) => !props.nodeVisibility || props.nodeVisibility(n));
    for (const n of visible) props.nodeCanvasObject?.({ ...n, x: 0, y: 0 }, fakeCtx().ctx, 1);
    return (
      <div data-testid="force-graph">
        {visible.map((n) => (
          <button key={n.id} type="button" onClick={() => props.onNodeClick(n)}>
            node {n.name}
          </button>
        ))}
      </div>
    );
  },
}));

const demo = loadDemoGraph();
const payload = mockBrainFromGraphs([demo]);

function giveCanvasASize() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  usePrefs.getState().reset();
});

describe('Brain page (wave 1)', () => {
  it('hides search, the Galaxy/List toggle and the header regenerate icon; a single "Text view" icon toggles the list', async () => {
    const api = createMockApi();
    await api.rebuildBrain();
    giveCanvasASize();
    const user = userEvent.setup();
    renderApp({ route: '/brain', api, element: <BrainScreen /> });

    const textView = await screen.findByRole('button', { name: 'Text view' });
    expect(textView).toHaveClass('size-11'); // 44 px target
    expect(textView).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Brain' })).not.toBeInTheDocument();
    expect(screen.getByTestId('force-graph')).toBeInTheDocument();

    await user.click(textView);
    expect(textView).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'All concepts' })).toBeInTheDocument();
    await user.click(textView);
    expect(screen.getByTestId('force-graph')).toBeInTheDocument();
  });

  it('"Generate" calls POST /brain/rebuild and the stars appear a few at a time until all are shown', async () => {
    const api = createMockApi();
    await api.rebuildBrain(); // a Brain already exists; Generate refreshes it
    const rebuild = vi.spyOn(api, 'rebuildBrain');
    giveCanvasASize();
    const user = userEvent.setup();
    renderApp({ route: '/brain', api, element: <BrainScreen /> });
    await screen.findByTestId('force-graph');

    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect(rebuild).toHaveBeenCalledOnce();
    // part-way through, only some of the stars are out…
    await waitFor(() => {
      const shown = within(screen.getByTestId('force-graph')).queryAllByRole('button').length;
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(payload.concepts.length);
    });
    // …and then all of them
    await waitFor(
      () =>
        expect(within(screen.getByTestId('force-graph')).getAllByRole('button')).toHaveLength(payload.concepts.length),
      { timeout: 3000 },
    );
  });

  it('under reduced motion every star appears at once', async () => {
    usePrefs.getState().set({ reduceMotion: true });
    const api = createMockApi();
    await api.rebuildBrain();
    giveCanvasASize();
    const user = userEvent.setup();
    renderApp({ route: '/brain', api, element: <BrainScreen /> });
    await screen.findByTestId('force-graph');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText(/Your Brain is up to date|Added/);
    expect(within(screen.getByTestId('force-graph')).getAllByRole('button')).toHaveLength(payload.concepts.length);
  });

  it('the empty Brain offers an editorial "Generate" button', async () => {
    renderApp({ route: '/brain', element: <BrainScreen /> });
    const generate = await screen.findByRole('button', { name: 'Generate' });
    expect(generate.className).toContain('uppercase');
    expect(generate.className).not.toContain('brain-gradient');
  });
});

describe('star reveal timing', () => {
  it('spreads the stars over ~2.4 s, brightest first, then draws the links, then settles', () => {
    vi.useFakeTimers();
    const order = revealOrder(payload.concepts);
    expect(payload.concepts.find((c) => c.id === order[0])!.mentionCount).toBe(2);
    const plan = revealPlan(order.length);
    expect(plan.steps * plan.stepMs).toBeGreaterThanOrEqual(2000);
    expect(plan.steps * plan.stepMs).toBeLessThanOrEqual(3000);

    const { result } = renderHook(() => useStarReveal(false));
    act(() => result.current.start(order));
    expect([...result.current.revealedAt!.keys()]).toEqual(order.slice(0, plan.perStep));
    expect(result.current.linksFrom).toBeNull(); // links wait for the stars
    act(() => vi.advanceTimersByTime(plan.stepMs));
    expect(result.current.revealedAt!.size).toBe(Math.min(order.length, 2 * plan.perStep));
    while (result.current.revealedAt && result.current.revealedAt.size < order.length) {
      act(() => vi.advanceTimersByTime(plan.stepMs));
    }
    expect(result.current.revealedAt!.size).toBe(order.length);
    expect(result.current.linksFrom).toBeNull();
    act(() => vi.advanceTimersByTime(STAR_FADE_MS)); // last star has faded in: links start
    expect(result.current.linksFrom).not.toBeNull();
    act(() => vi.advanceTimersByTime(LINK_DRAW_MS));
    expect(result.current.revealedAt).toBeNull(); // settled: everything visible
  });

  it('scales the step size with the Brain so big Brains still take ~2.4 s', () => {
    expect(revealPlan(8)).toEqual({ perStep: 1, steps: 8, stepMs: 300 });
    expect(revealPlan(100)).toEqual({ perStep: 9, steps: 12, stepMs: 200 });
    expect(revealPlan(0).steps).toBe(0);
  });

  it('a single star leaves no interval running', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStarReveal(false));
    act(() => result.current.start(['a']));
    expect(vi.getTimerCount()).toBe(2); // links-start and settle timeouts only
    act(() => vi.advanceTimersByTime(STAR_FADE_MS + LINK_DRAW_MS));
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.revealedAt).toBeNull();
  });

  it('reduced motion skips the reveal', () => {
    const { result } = renderHook(() => useStarReveal(true));
    act(() => result.current.start(['a', 'b', 'c', 'd']));
    expect(result.current.revealedAt).toBeNull();
  });

  it('each star fades in over STAR_FADE_MS', () => {
    expect(starOpacity(undefined, 100)).toBe(0);
    expect(starOpacity(0, STAR_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(starOpacity(0, STAR_FADE_MS * 2)).toBe(1);
  });
});

describe('swappable drawing (wave 2 star art and comet trails)', () => {
  it('BrainCanvas draws nodes with the renderers it is given', () => {
    giveCanvasASize();
    const renderers: BrainRenderers = { drawNode: vi.fn(), drawLink: vi.fn() };
    render(<BrainCanvas payload={payload} selectedId={null} onSelect={() => {}} reduced renderers={renderers} />);
    expect(renderers.drawNode).toHaveBeenCalledTimes(payload.concepts.length);
    expect(vi.mocked(renderers.drawNode).mock.calls[0]![0]).toMatchObject({ opacity: 1, dimmed: false });
  });

  it('the wave-1 dot renderer (kept) shows the relation by dash pattern, not colour alone', () => {
    const { ctx, calls } = fakeCtx();
    const base = { ctx, from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, weight: 0.5, lit: false, opacity: 1, scale: 1 };
    dotRenderers.drawLink({ ...base, relation: 'broader' });
    dotRenderers.drawLink({ ...base, relation: 'related' });
    dotRenderers.drawLink({ ...base, relation: 'co_discussed' });
    const dashes = calls.filter((c) => c.name === 'setLineDash').map((c) => c.args[0]);
    expect(dashes).toEqual([[], [6, 4], [1.5, 3.5]]);
  });
});

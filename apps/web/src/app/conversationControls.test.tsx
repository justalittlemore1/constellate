import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetUiFlags, setUiFlags } from '../lib/uiFlags';
import { loadDemoGraph } from '../lib/fixtures';
import { renderApp } from '../test/render';

// Stand in for A3's SavedMap and record the controlled props this screen passes it
// (`view` / `onViewChange` / `revealHold`, being added in A3's PR).
const calls: { view?: string; revealHold?: boolean; onViewChange?: (v: 'map' | 'outline') => void }[] = [];
vi.mock('../features/map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/map')>()),
  SavedMap: (props: { view?: string; revealHold?: boolean; onViewChange?: (v: 'map' | 'outline') => void }) => {
    calls.push(props);
    return <div data-testid="saved-map" data-view={props.view} data-hold={String(props.revealHold)} />;
  },
}));

afterEach(() => void (calls.length = 0));

const demo = loadDemoGraph();
const map = () => screen.getByTestId('saved-map');

describe('/c/:id "Text view" button (as on the Brain)', () => {
  // behind uiFlags.conversationTextView until A3's controlled SavedMap props land
  beforeEach(() => setUiFlags({ conversationTextView: true }));

  it('is off by default until A3’s view prop lands (so it never shows as a dead button)', async () => {
    resetUiFlags();
    renderApp({ route: `/c/${demo.conversation.id}` });
    await screen.findByTestId('saved-map');
    expect(screen.queryByRole('button', { name: 'Text view' })).not.toBeInTheDocument();
  });

  it('sits directly below the Diary icon: labelled, 44 px, the shared hover wash', async () => {
    renderApp({ route: `/c/${demo.conversation.id}` });
    await screen.findByTestId('saved-map');
    const actions = screen.getByTestId('conversation-actions');
    expect(actions).toHaveClass('flex-col'); // stacked, not side by side
    const [diary, textView] = within(actions).getAllByRole('button');
    expect(diary).toHaveAccessibleName('Open diary');
    expect(textView).toHaveAccessibleName('Text view');
    expect(textView).toHaveClass('size-11', 'hover-wash');
  });

  it('opens the nodes as a list (A3’s outline) and toggles back to the map', async () => {
    const user = userEvent.setup();
    renderApp({ route: `/c/${demo.conversation.id}` });
    await screen.findByTestId('saved-map');
    const textView = screen.getByRole('button', { name: 'Text view' });
    expect(textView).toHaveAttribute('aria-pressed', 'false');
    expect(map()).toHaveAttribute('data-view', 'map');
    await user.click(textView);
    expect(textView).toHaveAttribute('aria-pressed', 'true');
    expect(map()).toHaveAttribute('data-view', 'outline');
    await user.click(textView);
    expect(map()).toHaveAttribute('data-view', 'map');
  });

  it('follows view changes made inside the map', async () => {
    renderApp({ route: `/c/${demo.conversation.id}` });
    await screen.findByTestId('saved-map');
    const { act } = await import('@testing-library/react');
    act(() => calls.at(-1)!.onViewChange!('outline'));
    expect(screen.getByRole('button', { name: 'Text view' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('after a recording, the reveal waits until the diary is closed', () => {
  it('arriving with ?diary=1: an empty sky until the diary closes, then the reveal', async () => {
    const user = userEvent.setup();
    renderApp({ route: `/c/${demo.conversation.id}?diary=1` });
    await screen.findByRole('dialog', { name: 'Diary' });
    expect(map()).toHaveAttribute('data-hold', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Diary' })).not.toBeInTheDocument());
    expect(map()).toHaveAttribute('data-hold', 'false');
  });

  it('arriving without the diary: the reveal plays at once', async () => {
    renderApp({ route: `/c/${demo.conversation.id}` });
    await screen.findByTestId('saved-map');
    expect(map()).toHaveAttribute('data-hold', 'false');
    expect(calls.every((p) => p.revealHold === false)).toBe(true);
  });

  it('reopening the diary later keeps the stars visible', async () => {
    const user = userEvent.setup();
    renderApp({ route: `/c/${demo.conversation.id}?diary=1` });
    await screen.findByRole('dialog', { name: 'Diary' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(map()).toHaveAttribute('data-hold', 'false');
    await user.click(screen.getByRole('button', { name: 'Open diary' }));
    expect(screen.getByRole('dialog', { name: 'Diary' })).toBeInTheDocument();
    expect(map()).toHaveAttribute('data-hold', 'false');
  });
});

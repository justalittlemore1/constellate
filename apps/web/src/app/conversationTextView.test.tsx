import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { installFlowDomStubs } from '../features/map/testing';
import { loadDemoGraph } from '../lib/fixtures';
import { renderApp } from '../test/render';

// The REAL SavedMap (no stand-in), so a mismatch between the values this screen sends and the ones
// A3's map understands (e.g. 'outline' vs 'list') fails here.
beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();

describe('/c/:id header "Text view" with A3’s real SavedMap', () => {
  it('shows the outline, and a second click returns to the map', async () => {
    const user = userEvent.setup();
    renderApp({ route: `/c/${demo.conversation.id}` });
    await screen.findByTestId('conversation-map');
    // the header button (A3's map has its own focus-only "Text view" link too)
    const textView = within(screen.getByTestId('conversation-actions')).getByRole('button', { name: 'Text view' });
    expect(screen.queryByTestId('outline')).not.toBeInTheDocument();

    await user.click(textView);
    expect(textView).toHaveAttribute('aria-pressed', 'true');
    const outline = screen.getByRole('tree', { name: 'Conversation outline, in order' });
    const first = Object.values(demo.nodes).sort((a, b) => a.seq - b.seq)[0]!;
    expect(within(outline).getByTestId(`outline-item-${first.id}`)).toBeInTheDocument();

    await user.click(textView);
    expect(textView).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('outline')).not.toBeInTheDocument();
  });

  it('stays in step when the view is changed from inside the map (A3’s focus-only link)', async () => {
    const user = userEvent.setup();
    renderApp({ route: `/c/${demo.conversation.id}` });
    await user.click(await screen.findByTestId('text-view-link'));
    expect(screen.getByTestId('outline')).toBeInTheDocument();
    const textView = within(screen.getByTestId('conversation-actions')).getByRole('button', { name: 'Text view' });
    expect(textView).toHaveAttribute('aria-pressed', 'true');
    await user.click(textView);
    expect(screen.queryByTestId('outline')).not.toBeInTheDocument();
  });
});

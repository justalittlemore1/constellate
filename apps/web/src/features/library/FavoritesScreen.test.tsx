import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../../lib/api';
import { loadDemoGraph } from '../../lib/fixtures';
import { renderApp } from '../../test/render';

const demo = loadDemoGraph();

describe('favourites', () => {
  it('lists favourite conversations, highlighted nodes and flagged moments', async () => {
    renderApp({ route: '/favorites' });
    const convs = await screen.findByRole('region', { name: 'Starred conversations' });
    expect(await within(convs).findByRole('link', { name: new RegExp(demo.conversation.title) })).toBeInTheDocument();

    const highlights = screen.getByRole('region', { name: 'Highlighted topics' });
    const highlighted = Object.values(demo.nodes).filter((n) => n.highlighted);
    expect(await within(highlights).findAllByText('Resurrection Accounts')).toHaveLength(highlighted.length);

    const flags = screen.getByRole('region', { name: 'Flagged moments' });
    expect(within(flags).getAllByRole('listitem')).toHaveLength(demo.flags.length);

    // every moment is playable and opens in the map at its time
    const first = highlighted.sort((a, b) => a.seq - b.seq)[0]!;
    expect(within(highlights).getAllByRole('button', { name: /^Play Resurrection Accounts at/ })).toHaveLength(2);
    expect(
      within(highlights).getAllByRole('link', {
        name: /^Resurrection Accounts.*highlighted topic.*open in the map$/,
      })[0],
    ).toHaveAttribute('href', `/c/${demo.conversation.id}?node=${first.id}&t=${first.startMs}`);
  });

  it('with no recording (mock mode), plays the moment as its transcript in the now-playing bar', async () => {
    renderApp({ route: '/favorites' });
    const highlights = await screen.findByRole('region', { name: 'Highlighted topics' });
    const [play] = await within(highlights).findAllByRole('button', { name: /^Play / });
    await userEvent.click(play!);
    const bar = await screen.findByRole('region', { name: 'Now playing' });
    expect(bar).toHaveTextContent('Transcript · no audio recorded');
    expect(play).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(bar).getByRole('button', { name: 'Stop' }));
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument();
  });

  it('shows helpful empty states', async () => {
    const api = createMockApi([]);
    renderApp({ route: '/favorites', api });
    expect(await screen.findByText(/Star a conversation in the library/)).toBeInTheDocument();
    expect(await screen.findByText(/Use the highlighter on a map/)).toBeInTheDocument();
    expect(screen.getByText(/Flag a moment during a conversation/)).toBeInTheDocument();
  });
});

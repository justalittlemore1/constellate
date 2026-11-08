import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { installFlowDomStubs } from '../features/map/testing';
import { loadDemoGraph } from '../lib/fixtures';
import { renderApp } from '../test/render';

beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();

describe('/c/:id', () => {
  it('mounts A3’s conversation map, with the title and date above it', async () => {
    renderApp({ route: `/c/${demo.conversation.id}` });
    const map = await screen.findByTestId('conversation-map');
    expect(await within(map).findAllByText('Sunday Service')).not.toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(demo.conversation.title);
    expect(screen.getByText(/10 min/)).toBeInTheDocument();
    expect(screen.queryByText(/Placeholder/)).not.toBeInTheDocument();
  });

  it('keeps the Diary button, which opens the diary over the map', async () => {
    const user = userEvent.setup();
    renderApp({ route: `/c/${demo.conversation.id}` });
    await screen.findByTestId('conversation-map');
    await user.click(screen.getByRole('button', { name: 'Open diary' }));
    expect(screen.getByRole('dialog', { name: 'Diary' })).toBeInTheDocument();
  });

  it('offers no play button on the map when there is no recording (mock mode)', async () => {
    renderApp({ route: `/c/${demo.conversation.id}` });
    const map = await screen.findByTestId('conversation-map');
    expect(within(map).queryByRole('button', { name: /play this moment/i })).not.toBeInTheDocument();
  });
});

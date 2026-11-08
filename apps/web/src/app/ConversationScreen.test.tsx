import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { installFlowDomStubs } from '../features/map/testing';
import { createMockApi } from '../lib/api';
import { loadDemoGraph } from '../lib/fixtures';
import { renderApp } from '../test/render';

beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();

describe('/c/:id', () => {
  it('mounts A3’s SavedMap in the Conversation map region, with the title and date above it', async () => {
    renderApp({ route: `/c/${demo.conversation.id}` });
    const map = await screen.findByTestId('conversation-map');
    expect(screen.getByRole('region', { name: 'Conversation map' })).toContainElement(map);
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

  it('keeps the header, Diary button and loading state while the graph loads', () => {
    const api = createMockApi();
    api.getGraph = () => new Promise(() => {});
    renderApp({ route: `/c/${demo.conversation.id}`, api });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Conversation');
    expect(screen.getByText('Loading conversation…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Open diary' })).toBeDisabled();
    expect(screen.getByRole('region', { name: 'Conversation map' })).toBeEmptyDOMElement();
  });
});

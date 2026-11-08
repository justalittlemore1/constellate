import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installFlowDomStubs } from '../features/map/testing';
import { renderApp } from '../test/render';
import { createMockApi, createMockModeApi } from './api';
import { stopPlayback } from './audio';
import { loadDemoGraph, loadMockDemos } from './fixtures';

beforeAll(() => {
  installFlowDomStubs();
  HTMLMediaElement.prototype.pause = function pause() {}; // jsdom has no media playback
});
afterEach(() => {
  stopPlayback();
  vi.restoreAllMocks();
});

const demo = loadDemoGraph();
const demos = loadMockDemos();
const TITLES = [
  'Sourdough, Hydration, and Pre-Run Carbs',
  'Coast Road Trip Planning',
  'Church, Historical Jesus, Camus, Road Trip',
];

describe('mock mode’s exported demo conversations', () => {
  it('parse with the shared schemas, belong to the mock user, and every node’s utterances resolve', () => {
    expect(demos.map((d) => d.graph.conversation.title)).toEqual(TITLES);
    for (const { graph, utterances } of demos) {
      expect(graph.conversation.userId).toBe(demo.conversation.userId);
      expect(graph.conversation.status).toBe('ready');
      const ids = new Set(utterances.map((u) => u.id));
      expect(utterances.every((u) => u.conversationId === graph.conversation.id)).toBe(true);
      for (const n of Object.values(graph.nodes)) for (const u of n.utteranceIds) expect(ids.has(u)).toBe(true);
    }
  });

  it('the mock-mode API lists the contract demo plus the 3, newest first', async () => {
    const titles = (await createMockModeApi().listConversations()).map((c) => c.title);
    expect(titles).toHaveLength(4);
    expect(titles).toEqual(expect.arrayContaining([demo.conversation.title, ...TITLES]));
  });

  it('serves their transcripts from listUtterances (none for the contract demo graph)', async () => {
    const api = createMockModeApi();
    const bread = demos[0]!;
    const lines = await api.listUtterances(bread.graph.conversation.id);
    expect(lines).toHaveLength(bread.utterances.length);
    expect(lines[0]!.text).toBe('Okay, what is that jar? It looks alive.');
    expect(await api.listUtterances(demo.conversation.id)).toEqual([]);
  });

  it('createMockApi() keeps its default seed (the contract demo alone) for unit tests', async () => {
    expect(await createMockApi().listConversations()).toHaveLength(1);
  });

  it('Play on one of them shows a real caption line in the now-playing bar', async () => {
    const user = userEvent.setup();
    const bread = demos[0]!;
    const node = Object.values(bread.graph.nodes).find((n) => n.label === 'Dough Hydration')!;
    renderApp({ route: `/c/${bread.graph.conversation.id}`, api: createMockModeApi() });
    fireEvent.click(await screen.findByTestId(`map-node-${node.id}`));
    const sheet = screen.getByRole('dialog', { name: node.label });
    await user.click(within(sheet).getByRole('button', { name: 'Play this moment' }));
    const bar = await screen.findByRole('region', { name: 'Now playing' });
    expect(within(bar).getByTestId('now-playing-line')).toHaveTextContent(/^Hydration\. It's how much water/);
  });
});

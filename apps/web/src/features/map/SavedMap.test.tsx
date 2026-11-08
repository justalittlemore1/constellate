import type { GraphState } from '@constellate/shared';
import { QueryClientProvider, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiProvider, createMockApi, useApi, type Api } from '../../lib/api';
import { AuthProvider } from '../../lib/auth';
import { stopPlayback } from '../../lib/audio';
import { loadDemoGraph } from '../../lib/fixtures';
import { renderApp } from '../../test/render';
import { highlightOps } from './edits';
import { deepLinkTarget, parseDeepLink, playStartMs, SavedMap } from './SavedMap';
import { installFlowDomStubs } from './testing';
import { graphKey, useUserOps } from './userOps';

beforeAll(() => {
  installFlowDomStubs();
  // jsdom implements no media playback; the shared player calls pause() when a screen unmounts
  HTMLMediaElement.prototype.pause = function pause() {};
});
afterEach(() => {
  stopPlayback();
  vi.restoreAllMocks();
});

const demo = loadDemoGraph();
const id = demo.conversation.id;
const byLabel = (label: string, nth = 0) =>
  Object.values(demo.nodes)
    .filter((n) => n.label === label)
    .sort((a, b) => a.seq - b.seq)[nth]!;
const tile = (nodeId: string) => screen.getByTestId(`map-node-${nodeId}`);

/** What A4's ConversationScreen does: load the graph through the shared query, mount SavedMap. */
function Harness({ onClient }: { onClient?: (qc: QueryClient) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  useEffect(() => {
    onClient?.(qc);
  }, [onClient, qc]);
  const g = useQuery({ queryKey: graphKey(id), queryFn: () => api.getGraph(id) });
  return g.data ? <SavedMap graph={g.data} /> : <p>loading</p>;
}

function renderSaved(route = `/c/${id}`, api: Api = createMockApi()) {
  let qc: QueryClient | null = null;
  const utils = renderApp({ route, api, element: <Harness onClient={(c) => (qc = c)} />, path: '/c/:id' });
  return { ...utils, client: () => qc! };
}

describe('deep links', () => {
  it('parses ?node= and ?t=', () => {
    expect(parseDeepLink(new URLSearchParams('node=abc&t=250000'))).toEqual({ nodeId: 'abc', atMs: 250000 });
    expect(parseDeepLink(new URLSearchParams('t=oops'))).toEqual({ nodeId: null, atMs: null });
  });

  it('?t= picks the topic being discussed then; past the end, the last one started', () => {
    expect(deepLinkTarget(demo, { nodeId: null, atMs: 250_000 })!.label).toBe('Resurrection Accounts');
    expect(deepLinkTarget(demo, { nodeId: null, atMs: 9_999_999 })!.label).toBe('Faith vs Evidence');
    expect(deepLinkTarget(demo, { nodeId: 'missing', atMs: null })).toBeNull();
  });

  it('Play starts at the linked time inside the linked node, else at the node start', () => {
    const n = byLabel('Resurrection Accounts');
    const link = { nodeId: null, atMs: 250_000 };
    expect(playStartMs(n, link, n)).toBe(250_000);
    const other = byLabel('Sunday Service');
    expect(playStartMs(other, link, n)).toBe(other.startMs);
  });

  it('/c/:id?node= opens with that node selected (preview showing)', async () => {
    const n = byLabel('Camus and Absurdism');
    renderSaved(`/c/${id}?node=${n.id}`);
    expect(await screen.findByTestId('preview-card')).toHaveTextContent(n.label);
    expect(within(tile(n.id)).getByText(n.label)).toBeInTheDocument();
  });

  it('/c/:id?t= selects the topic covering that time', async () => {
    renderSaved(`/c/${id}?t=250000`);
    expect(await screen.findByTestId('preview-card')).toHaveTextContent('Resurrection Accounts');
  });
});

describe('playback through the shared player', () => {
  it('plays the node from 1 s before its start and marks it as playing', async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const api = createMockApi();
    api.audioUrl = async () => 'https://example.test/rec.webm';
    renderSaved(`/c/${id}`, api);
    const n = byLabel('Gospel Sources');
    fireEvent.click(await screen.findByTestId(`map-node-${n.id}`));
    // Play appears once the recording URL has resolved
    await user.click(await screen.findByRole('button', { name: `Play ${n.label}` }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    const audio = play.mock.contexts[0] as HTMLAudioElement;
    expect(audio.src).toBe('https://example.test/rec.webm');
    // the playing node gets the "playing" word under its label
    await waitFor(() => expect(within(tile(n.id)).getByText('playing')).toBeInTheDocument());
  });

  it('offers no Play at all when there is no recording (mock mode)', async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    const audioUrl = vi.fn(async () => null);
    api.audioUrl = audioUrl;
    renderSaved(`/c/${id}`, api);
    const n = byLabel('Gospel Sources');
    fireEvent.click(await screen.findByTestId(`map-node-${n.id}`));
    await waitFor(() => expect(audioUrl).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: `Play ${n.label}` })).toBeNull();
    await user.click(screen.getByRole('button', { name: `Open details for ${n.label}` }));
    const sheet = screen.getByRole('dialog', { name: n.label });
    expect(within(sheet).queryByRole('button', { name: /play/i })).toBeNull();
  });
});

describe('edits on the saved map', () => {
  it('Highlight in the detail sheet paints the node gold at once', async () => {
    const user = userEvent.setup();
    renderSaved();
    const n = byLabel('Sunday Service');
    fireEvent.click(await screen.findByTestId(`map-node-${n.id}`));
    await user.click(screen.getByRole('button', { name: `Open details for ${n.label}` }));
    const sheet = screen.getByRole('dialog', { name: n.label });
    // the sheet's button is the only control whose name starts with "Highlight" (voice control, e2e)
    expect(screen.getAllByRole('button', { name: /^highlight/i, hidden: true })).toHaveLength(1);
    await user.click(within(sheet).getByRole('button', { name: 'Highlight' }));
    expect(tile(n.id)).toHaveAttribute('data-highlighted', 'true');
    expect(within(sheet).getByRole('button', { name: 'Remove highlight' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByText('★ highlighted')).toBeInTheDocument();
  });

  it('highlighter mode: taps paint and clear gold instead of opening previews', async () => {
    const user = userEvent.setup();
    renderSaved();
    const a = byLabel('Historical Jesus');
    await screen.findByTestId(`map-node-${a.id}`);
    const toggle = screen.getByRole('button', { name: 'Paint topics gold (highlighter)' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('highlighter-banner')).toHaveTextContent('Highlighter on.');
    // React Query delivers cache updates on the next tick
    fireEvent.click(tile(a.id));
    await waitFor(() => expect(tile(a.id)).toHaveAttribute('data-highlighted', 'true'));
    expect(screen.queryByTestId('preview-card')).toBeNull();
    fireEvent.click(tile(a.id));
    await waitFor(() => expect(tile(a.id)).not.toHaveAttribute('data-highlighted'));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('highlighter-banner')).toBeNull();
    fireEvent.click(tile(a.id));
    expect(screen.getByTestId('preview-card')).toBeInTheDocument();
  });

  it('adds a sticky note from the detail sheet; it appears on the canvas and in the sheet', async () => {
    const user = userEvent.setup();
    const { client } = renderSaved();
    const n = byLabel('Camus and Absurdism');
    fireEvent.click(await screen.findByTestId(`map-node-${n.id}`));
    await user.click(screen.getByRole('button', { name: `Open details for ${n.label}` }));
    const sheet = screen.getByRole('dialog', { name: n.label });
    await user.click(within(sheet).getByRole('button', { name: 'Add a note' }));
    await user.type(within(sheet).getByLabelText(`Note on ${n.label}`), 'Read The Stranger');
    await user.click(within(sheet).getByRole('button', { name: 'Save note' }));
    expect(within(sheet).getByText('Read The Stranger')).toBeInTheDocument();
    const saved = client().getQueryData<GraphState>(graphKey(id))!;
    const note = saved.annotations.find((x) => x.text === 'Read The Stranger')!;
    expect(note.nodeId).toBe(n.id);
    expect(screen.getByTestId(`map-note-${note.id}`)).toHaveTextContent('Read The Stranger');
  });

  it('edits an existing note in place', async () => {
    const user = userEvent.setup();
    renderSaved();
    const existing = demo.annotations[0]!;
    const n = demo.nodes[existing.nodeId!]!;
    fireEvent.click(await screen.findByTestId(`map-node-${n.id}`));
    await user.click(screen.getByRole('button', { name: `Open details for ${n.label}` }));
    const sheet = screen.getByRole('dialog', { name: n.label });
    await user.click(within(sheet).getByRole('button', { name: `Edit note: ${existing.text}` }));
    const box = within(sheet).getByLabelText('Edit note');
    await user.clear(box);
    await user.type(box, 'Q source: check Kloppenborg');
    await user.click(within(sheet).getByRole('button', { name: 'Save note' }));
    expect(screen.getByTestId(`map-note-${existing.id}`)).toHaveTextContent('Q source: check Kloppenborg');
  });
});

describe('useUserOps', () => {
  it('applies optimistically, then records the server seq', async () => {
    const { client } = renderSaved();
    await screen.findByTestId('conversation-map');
    const qc = client();
    const post = vi.fn(async () => ({ batch: { seq: 77 } as never }));
    const n = byLabel('Sunday Service');
    const { result } = renderHook(() => useUserOps(id, post), { wrapper: hookWrapper(qc) });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current(highlightOps(n, true));
    });
    expect(qc.getQueryData<GraphState>(graphKey(id))!.nodes[n.id]!.highlighted).toBe(true);
    await act(() => pending);
    expect(post).toHaveBeenCalledWith(id, highlightOps(n, true));
    expect(qc.getQueryData<GraphState>(graphKey(id))!.lastSeq).toBe(77);
  });

  it('rolls back by refetching when the server refuses', async () => {
    const { client } = renderSaved();
    await screen.findByTestId('conversation-map');
    const qc = client();
    const post = vi.fn(async () => {
      throw new Error('forbidden');
    });
    const n = byLabel('Sunday Service');
    const { result } = renderHook(() => useUserOps(id, post), { wrapper: hookWrapper(qc) });
    await act(async () => {
      await expect(result.current(highlightOps(n, true))).rejects.toThrow('forbidden');
    });
    await waitFor(() => expect(qc.getQueryData<GraphState>(graphKey(id))!.nodes[n.id]!.highlighted).toBe(false));
  });
});

/** renderHook wrapper that shares the app's QueryClient, API and auth (mock mode). */
function hookWrapper(qc: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <HookProviders qc={qc}>{children}</HookProviders>;
  };
}

const sharedApi = createMockApi();
function HookProviders({ qc, children }: { qc: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider client={null} mock>
        <ApiProvider api={sharedApi}>{children}</ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

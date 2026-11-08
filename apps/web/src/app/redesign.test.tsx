import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HIGHLIGHTS_TITLE } from '../features/library/FavoritesScreen';
import { SIDEBAR_TITLE } from '../features/library/LibraryDrawer';
import { installFlowDomStubs } from '../features/map/testing';
import { createMockApi } from '../lib/api';
import { loadDemoGraph } from '../lib/fixtures';
import { resetUiFlags, setUiFlags, UI_FLAG_DEFAULTS, uiFlag } from '../lib/uiFlags';
import { renderApp } from '../test/render';
import { Sheet, StarFrame } from '../ui';

// /c/:id renders A3's React Flow map, which needs these jsdom stubs
beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();

describe('ui flags', () => {
  it('every redesign flag is off by default (hidden, not deleted), except the shipped Text view', () => {
    const on = Object.entries(UI_FLAG_DEFAULTS).filter(([, v]) => v);
    expect(on.map(([k]) => k)).toEqual(['conversationTextView']);
    expect(uiFlag('sidebarFolders')).toBe(false);
  });

  it('can be switched on for a session and reset', () => {
    setUiFlags({ sidebarFolders: true });
    expect(uiFlag('sidebarFolders')).toBe(true);
    resetUiFlags();
    expect(uiFlag('sidebarFolders')).toBe(false);
  });
});

describe('Home (wave 1)', () => {
  it('hides the tagline, the orb hint and the Settings icon; the (flagged) orb no longer pulses', () => {
    setUiFlags({ homeMicOrb: true }); // the wave-0 orb, replaced in wave 2
    renderApp();
    expect(screen.getByRole('heading', { name: 'Welcome, Demo' })).toBeInTheDocument();
    expect(screen.queryByText('Where will your conversation take you?')).not.toBeInTheDocument();
    expect(screen.queryByText(/Everyone is asked to agree first/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    const orb = screen.getByRole('button', { name: 'Start a conversation' });
    expect(orb).not.toHaveAttribute('aria-describedby');
    expect(orb).toHaveClass('orb-still');
    expect(orb).not.toHaveClass('orb');
  });

  it('the flags bring each item back', () => {
    setUiFlags({
      homeTagline: true,
      homeOrbHint: true,
      homeSettingsButton: true,
      homeOrbPulse: true,
      homeMicOrb: true,
    });
    renderApp();
    expect(screen.getByText('Where will your conversation take you?')).toBeInTheDocument();
    const orb = screen.getByRole('button', { name: 'Start a conversation' });
    expect(orb).toHaveAccessibleDescription('Tap to start. Everyone is asked to agree first.');
    expect(orb).toHaveClass('orb');
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('sidebar (wave 1)', () => {
  async function openSidebar(api = createMockApi()) {
    const user = userEvent.setup();
    renderApp({ api });
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const sidebar = screen.getByRole('dialog', { name: SIDEBAR_TITLE });
    await within(sidebar).findByRole('link', { name: new RegExp(demo.conversation.title) });
    return { user, sidebar, api };
  }

  it('is called "Constellate" and links to Highlights', async () => {
    const { sidebar } = await openSidebar();
    expect(SIDEBAR_TITLE).toBe('Constellate');
    expect(within(sidebar).getByRole('link', { name: 'Highlights' })).toHaveAttribute('href', '/favorites');
    expect(within(sidebar).queryByText('Favourites')).not.toBeInTheDocument();
  });

  it('hides search, the Settings row, folders, the Recent heading, row tags and the row menu; keeps the star', async () => {
    const { sidebar } = await openSidebar();
    expect(within(sidebar).queryByRole('searchbox')).not.toBeInTheDocument();
    expect(within(within(sidebar).getByRole('navigation', { name: 'Sections' })).queryByText('Settings')).toBeNull();
    expect(within(sidebar).queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: 'All conversations' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Recent conversations')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Group')).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: /^Options for/ })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: `Star ${demo.conversation.title}` })).toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: 'Generate Brain' })).not.toBeInTheDocument();
  });

  it('ends with "Brain" (navigates only, no rebuild) and a minimal Settings link at the very bottom', async () => {
    const api = createMockApi();
    const rebuild = vi.spyOn(api, 'rebuildBrain');
    const { user, sidebar } = await openSidebar(api);
    const links = within(sidebar).getAllByRole('link');
    expect(links.at(-2)).toHaveAccessibleName('Brain');
    expect(links.at(-1)).toHaveAccessibleName('Settings');
    expect(links.at(-1)).toHaveAttribute('href', '/settings'); // Delete my data stays reachable
    await user.click(links.at(-2)!);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/brain$/);
    await screen.findByRole('heading', { name: 'Brain' });
    expect(rebuild).not.toHaveBeenCalled();
  });
});

describe('renames', () => {
  it('the Favourites page is now titled "Highlights" (the route stays /favorites)', async () => {
    renderApp({ route: '/favorites' });
    expect(HIGHLIGHTS_TITLE).toBe('Highlights');
    expect(screen.getByRole('heading', { level: 1, name: 'Highlights' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Starred conversations' })).toBeInTheDocument();
  });
});

describe('type tokens', () => {
  // vitest runs in apps/web (CSS imports are stubbed in tests, so read the files)
  const tokensCss = readFileSync(resolve(process.cwd(), 'src/ui/tokens.css'), 'utf8');
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  it('defines --font and --font-display as the self-hosted serif (Fraunces)', () => {
    expect(tokensCss).toMatch(/--font: 'Fraunces Variable'/);
    expect(tokensCss).toMatch(/--font-display: 'Fraunces Variable'/);
    expect(indexHtml).not.toMatch(/fonts\.googleapis|fonts\.gstatic/); // no CDN: works offline
  });
});

describe('star-chart frame', () => {
  it('is a reusable ui primitive', () => {
    render(
      <StarFrame as="section" aria-label="Panel">
        content
      </StarFrame>,
    );
    expect(screen.getByRole('region', { name: 'Panel' })).toHaveClass('star-frame');
  });

  it('frames every sheet', () => {
    render(
      <Sheet open onClose={() => {}} title="Framed">
        body
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Framed' })).toHaveClass('star-frame');
  });
});

describe('diary (wave 1)', () => {
  it('hides recall cards', async () => {
    const user = userEvent.setup();
    renderApp({ route: `/c/${demo.conversation.id}` });
    const open = await screen.findByRole('button', { name: 'Open diary' });
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);
    const diary = screen.getByRole('dialog', { name: 'Diary' });
    expect(diary).toHaveClass('star-frame');
    expect(within(diary).queryByRole('region', { name: 'Recall cards' })).not.toBeInTheDocument();
    expect(within(diary).getByRole('region', { name: 'Promises' })).toBeInTheDocument();
  });
});

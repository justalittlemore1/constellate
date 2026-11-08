import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_UI_FLAGS_ON, setUiFlags } from '../../lib/uiFlags';
import { createMockApi } from '../../lib/api';
import { loadDemoGraph } from '../../lib/fixtures';
import { renderApp } from '../../test/render';

const demo = loadDemoGraph().conversation;

async function openDrawer() {
  const api = createMockApi();
  const user = userEvent.setup();
  renderApp({ api });
  await user.click(screen.getByRole('button', { name: 'Open menu' }));
  const drawer = screen.getByRole('dialog', { name: 'Constellate' });
  await within(drawer).findByRole('link', { name: new RegExp(demo.title) });
  return { api, user, drawer };
}

describe('sidebar with every flag on (the features hidden in the redesign still work)', () => {
  beforeEach(() => setUiFlags(ALL_UI_FLAGS_ON));

  it('lists recent conversations with Solo / Group tags and links to the map', async () => {
    const { drawer } = await openDrawer();
    const link = within(drawer).getByRole('link', { name: new RegExp(demo.title) });
    expect(link).toHaveAttribute('href', `/c/${demo.id}`);
    expect(within(link).getByText('Group')).toBeInTheDocument();
  });

  it('searches by title', async () => {
    const { user, drawer } = await openDrawer();
    await user.type(within(drawer).getByRole('searchbox', { name: 'Search conversations' }), 'zzz');
    expect(within(drawer).queryByRole('link', { name: new RegExp(demo.title) })).not.toBeInTheDocument();
    expect(within(drawer).getByText('No conversations match that title.')).toBeInTheDocument();
    await user.clear(within(drawer).getByRole('searchbox'));
    await user.type(within(drawer).getByRole('searchbox'), 'camus');
    expect(within(drawer).getByRole('link', { name: new RegExp(demo.title) })).toBeInTheDocument();
  });

  it('creates, renames and deletes folders, and moves a conversation between them', async () => {
    const { api, user, drawer } = await openDrawer();

    // create
    await user.click(within(drawer).getByRole('button', { name: 'New folder' }));
    await user.type(within(drawer).getByRole('textbox', { name: 'New folder name' }), 'Philosophy{Enter}');
    await within(drawer).findByRole('button', { name: /^Philosophy/ });
    expect((await api.listFolders()).map((f) => f.name)).toEqual(['Philosophy']);

    // move the conversation into it
    await user.click(within(drawer).getByRole('button', { name: `Options for ${demo.title}` }));
    await user.selectOptions(within(drawer).getByRole('combobox', { name: 'Move to folder' }), 'Philosophy');
    await waitFor(async () => {
      const [folder] = await api.listFolders();
      expect((await api.listConversations())[0]!.folderId).toBe(folder!.id);
    });

    // filter by folder
    await user.click(within(drawer).getByRole('button', { name: /^Philosophy/ }));
    expect(within(drawer).getByRole('heading', { name: 'Philosophy' })).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: new RegExp(demo.title) })).toBeInTheDocument();

    // rename
    await user.click(within(drawer).getByRole('button', { name: 'Rename folder Philosophy' }));
    const input = within(drawer).getByRole('textbox', { name: 'Rename folder Philosophy' });
    await user.clear(input);
    await user.type(input, 'Big questions{Enter}');
    await within(drawer).findByRole('button', { name: /^Big questions/ });
    expect((await api.listFolders())[0]!.name).toBe('Big questions');

    // delete (conversation stays, back to no folder)
    await user.click(within(drawer).getByRole('button', { name: 'Delete folder Big questions' }));
    await user.click(within(drawer).getByRole('button', { name: 'Delete folder' }));
    await waitFor(async () => expect(await api.listFolders()).toEqual([]));
    expect((await api.listConversations())[0]!.folderId).toBeNull();
    expect(within(drawer).getByRole('link', { name: new RegExp(demo.title) })).toBeInTheDocument();
  });

  it('Escape in a rename field cancels the edit without closing the drawer', async () => {
    const { user, drawer } = await openDrawer();
    await user.click(within(drawer).getByRole('button', { name: 'New folder' }));
    await user.type(within(drawer).getByRole('textbox', { name: 'New folder name' }), 'Temp');
    await user.keyboard('{Escape}');
    expect(within(drawer).queryByRole('textbox', { name: 'New folder name' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Constellate' })).toBeInTheDocument();
  });

  it('toggles a favourite', async () => {
    const { api, user, drawer } = await openDrawer();
    const star = within(drawer).getByRole('button', { name: `Star ${demo.title}` });
    expect(star).toHaveAttribute('aria-pressed', String(demo.isFavorite));
    await user.click(star);
    await waitFor(async () => expect((await api.listConversations())[0]!.isFavorite).toBe(!demo.isFavorite));
    expect(star).toHaveAttribute('aria-pressed', String(!demo.isFavorite));
  });

  it('Generate Brain goes to the Brain and asks it to rebuild', async () => {
    const { user, drawer } = await openDrawer();
    await user.click(within(drawer).getByRole('button', { name: 'Generate Brain' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/brain');
  });
});

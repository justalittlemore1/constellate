import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApi, type Api } from '../lib/api';
import { applyPrefs, clampTextSize, usePrefs, usePrefsEffect } from '../lib/prefs';
import { renderApp } from '../test/render';
import { SettingsScreen } from './SettingsScreen';
import { makeStars } from './Starfield';

function WithPrefs() {
  usePrefsEffect();
  return <SettingsScreen />;
}

describe('settings', () => {
  it('Reduce motion turns motion off app-wide and stills the starfield', async () => {
    usePrefs.getState().reset();
    const user = userEvent.setup();
    renderApp({ route: '/settings', element: <WithPrefs /> });
    expect(document.documentElement.dataset.motion).toBe('full');

    await user.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    expect(screen.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset.motion).toBe('reduce');
    expect(usePrefs.getState().reduceMotion).toBe(true);
    expect(JSON.parse(localStorage.getItem('constellate.prefs')!).state.reduceMotion).toBe(true);
  });

  it('starfield renders a static frame when Reduce motion is on', () => {
    usePrefs.getState().set({ reduceMotion: true });
    renderApp({ route: '/' });
    expect(screen.getByTestId('starfield')).toHaveAttribute('data-animated', 'false');
    usePrefs.getState().reset();
  });

  it('low-stimulation mode hides the starfield', () => {
    usePrefs.getState().set({ lowStimulation: true });
    renderApp({ route: '/' });
    expect(screen.queryByTestId('starfield')).not.toBeInTheDocument();
    usePrefs.getState().reset();
  });

  it('text size sets --text-size within 100–150 %', () => {
    usePrefs.getState().reset();
    renderApp({ route: '/settings', element: <WithPrefs /> });
    fireEvent.change(screen.getByRole('slider', { name: 'Text size' }), { target: { value: '1.25' } });
    expect(document.documentElement.style.getPropertyValue('--text-size')).toBe('1.25');
    expect(screen.getByText('125 %')).toBeInTheDocument();
    expect(clampTextSize(3)).toBe(1.5);
    expect(clampTextSize(0.2)).toBe(1);
    applyPrefs({ reduceMotion: false, lowStimulation: true, textSize: 9 });
    expect(document.documentElement.style.getPropertyValue('--text-size')).toBe('1.5');
    expect(document.documentElement.dataset.lowStim).toBe('true');
  });

  it('Delete my data needs a typed confirmation, then removes everything', async () => {
    const api = createMockApi();
    const user = userEvent.setup();
    renderApp({ route: '/settings', api });
    await user.click(screen.getByRole('button', { name: 'Delete my data' }));
    const confirm = screen.getByRole('button', { name: 'Delete everything' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Type DELETE to confirm' }), 'delete');
    await user.click(confirm);
    await waitFor(async () => expect(await api.listConversations()).toEqual([]));
    expect(
      await screen.findByText('Deleted 1 conversation, 0 folders, 0 Brain concepts and 1 recording.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });
});

describe('delete my data: server outcomes (DELETE /me/data)', () => {
  const rows = { conversations: 3, folders: 2, concepts: 8, conceptLinks: 5 };

  async function confirmDelete(api: Api) {
    const user = userEvent.setup();
    renderApp({ route: '/settings', api });
    await user.click(screen.getByRole('button', { name: 'Delete my data' }));
    await user.type(screen.getByRole('textbox', { name: 'Type DELETE to confirm' }), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    return user;
  }

  it('502: rows are gone but recordings are left — says so, and Try again finishes the job', async () => {
    const api = createMockApi();
    const calls = vi
      .fn<Api['deleteMyData']>()
      .mockResolvedValueOnce({ outcome: 'recordings-left', deleted: rows })
      .mockResolvedValueOnce({
        outcome: 'deleted',
        deleted: { conversations: 0, folders: 0, concepts: 0, conceptLinks: 0, recordings: 3 },
      });
    api.deleteMyData = calls;
    const user = await confirmDelete(api);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Deleted 3 conversations, 2 folders and 8 Brain concepts, but some recordings couldn’t be removed yet. Try again to remove them.',
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
    expect(screen.queryByRole('button', { name: 'Delete everything' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(calls).toHaveBeenCalledTimes(2);
    // the final message covers the whole deletion, not just the leftover recordings
    expect(
      await screen.findByText('Deleted 3 conversations, 2 folders, 8 Brain concepts and 3 recordings.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('503: says nothing was deleted and lets the user try again', async () => {
    const api = createMockApi();
    api.deleteMyData = async () => ({ outcome: 'nothing-deleted' });
    await confirmDelete(api);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing was deleted: the server couldn’t reach the database. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Delete everything' })).toBeEnabled();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
    expect(await api.listConversations()).not.toEqual([]); // the data is untouched
  });

  it('a failed request is reported without claiming either way', async () => {
    const api = createMockApi();
    api.deleteMyData = async () => {
      throw new Error('Failed to fetch');
    };
    await confirmDelete(api);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request didn’t go through (Failed to fetch). Check your connection and try again.',
    );
    expect(screen.getByRole('button', { name: 'Delete everything' })).toBeEnabled();
  });
});

describe('starfield', () => {
  it('places stars deterministically', () => {
    expect(makeStars(5)).toEqual(makeStars(5));
    expect(makeStars(5, 1)).not.toEqual(makeStars(5, 2));
    for (const s of makeStars(50)) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(1);
    }
  });
});

import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../lib/api';
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
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });
});

describe('delete my data, partial failure', () => {
  it('says what could not be deleted and stays on Settings', async () => {
    const api = createMockApi();
    api.deleteMyData = async () => ({
      conversationsTotal: 2,
      conversationsDeleted: 1,
      foldersDeleted: true,
      conceptsDeleted: true,
    });
    const user = userEvent.setup();
    renderApp({ route: '/settings', api });
    await user.click(screen.getByRole('button', { name: 'Delete my data' }));
    await user.type(screen.getByRole('textbox', { name: 'Type DELETE to confirm' }), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not everything was deleted: 1 conversation was deleted, but 1 of 2 conversations could not be removed.',
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
    expect(screen.getByRole('dialog', { name: 'Delete all your data?' })).toBeInTheDocument();
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

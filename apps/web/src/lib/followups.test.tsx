import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PhoneFrame } from '../app/PhoneFrame';
import { installFlowDomStubs } from '../features/map/testing';
import { renderApp } from '../test/render';
import { Button, Sheet, ToastProvider, useToast } from '../ui';
import { createMockApi, type Api } from './api';
import { missingConfig } from './env';
import { loadDemoGraph } from './fixtures';
import { usePrefs } from './prefs';

// /c/:id renders A3's React Flow map, which needs these jsdom stubs
beforeAll(() => installFlowDomStubs());

describe('production config', () => {
  it('a real production build must name its server and Supabase project', () => {
    expect(missingConfig({ PROD: true })).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_SERVER_WS_URL',
      'VITE_SERVER_HTTP_URL',
    ]);
    expect(
      missingConfig({
        PROD: true,
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon',
        VITE_SERVER_WS_URL: 'wss://s/live',
        VITE_SERVER_HTTP_URL: ' ',
      }),
    ).toEqual(['VITE_SERVER_HTTP_URL']);
    expect(missingConfig({ PROD: true, VITE_USE_MOCKS: '1' })).toEqual([]); // mock builds need nothing
    expect(missingConfig({ PROD: false })).toEqual([]); // dev uses localhost defaults
  });
});

describe('motion and preferences', () => {
  it('the OS reduced-motion setting stills the starfield', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      renderApp();
      expect(screen.getByTestId('starfield')).toHaveAttribute('data-animated', 'false');
    } finally {
      window.matchMedia = original;
    }
  });

  it('preferences are read back after a reload', async () => {
    usePrefs.getState().reset();
    localStorage.setItem(
      'constellate.prefs',
      JSON.stringify({ state: { reduceMotion: true, lowStimulation: false, textSize: 1.4 }, version: 0 }),
    );
    await usePrefs.persist.rehydrate();
    expect(usePrefs.getState()).toMatchObject({ reduceMotion: true, lowStimulation: false, textSize: 1.4 });
    usePrefs.getState().reset();
  });
});

describe('mock-mode gating', () => {
  it('without mock mode or Supabase settings nothing loads and no demo data is shown', async () => {
    renderApp({ route: '/', element: undefined, authClient: undefined, mock: false });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t configured/);
    expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });
});

describe('promises outside mock mode', () => {
  it('are shown read-only when the API cannot save promise edits', async () => {
    const base = createMockApi();
    const api: Api = { ...base, capabilities: { editCommitments: false } };
    const user = userEvent.setup();
    renderApp({ route: `/c/${loadDemoGraph().conversation.id}`, api });
    const open = await screen.findByRole('button', { name: 'Open diary' });
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);
    const section = screen.getByRole('region', { name: 'Promises' });
    expect(section).toHaveTextContent('When ___, I will send Sam the reading list');
    expect(section).toHaveTextContent('Not done yet');
    expect(screen.queryByRole('checkbox', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'When should you do this?' })).not.toBeInTheDocument();
  });
});

describe('sheet background', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const toast = useToast();
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Sheet">
          <Button onClick={() => toast('Saved')}>Save</Button>
        </Sheet>
      </>
    );
  }

  it('the screens behind an open sheet are inert, and toasts are still announced', async () => {
    const user = userEvent.setup();
    render(
      <PhoneFrame>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </PhoneFrame>,
    );
    const content = document.getElementById('app-content')!;
    expect(content).not.toHaveAttribute('inert');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(content).toHaveAttribute('inert');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const status = screen.getByRole('status');
    expect(content.contains(status)).toBe(false);
    expect(status).toHaveTextContent('Saved');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(content).not.toHaveAttribute('inert'));
  });
});

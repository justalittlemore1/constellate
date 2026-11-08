import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { loadDemoGraph, loadDemoOps } from '../lib/fixtures';
import { renderApp } from '../test/render';

describe('app shell', () => {
  it('renders Home with the user name and a labelled microphone button', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'Welcome, Demo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a conversation' })).toBeInTheDocument();
    expect(screen.getByTestId('starfield')).toBeInTheDocument();
  });

  it('the first Tab on Home lands on the primary action', async () => {
    renderApp();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Start a conversation' })).toHaveFocus();
  });

  it('mic orb opens a new live conversation (consent is asked on the live screen)', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Start a conversation' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/live/new');
  });

  it('"Try a demo conversation" starts a transcript replay of the demo fixture', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Try a demo conversation' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/live/new?replay=demo-religion');
  });

  it('hamburger opens the library drawer as a dialog', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Open library' }));
    expect(screen.getByRole('dialog', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Brain' })).toBeInTheDocument();
  });

  it('unknown routes show a not-found page with a way home', () => {
    renderApp({ route: '/nope' });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  });
});

describe('mock-mode fixtures', () => {
  it('load and parse in the browser bundle', () => {
    expect(Object.keys(loadDemoGraph().nodes).length).toBeGreaterThan(10);
    expect(loadDemoOps().length).toBeGreaterThan(10);
  });
});

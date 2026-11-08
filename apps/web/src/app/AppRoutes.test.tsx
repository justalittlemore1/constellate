import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { loadDemoGraph, loadDemoOps } from '../lib/fixtures';
import { renderApp } from '../test/render';

describe('app shell', () => {
  it('renders Home with the user name and a labelled record button', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'Welcome, Demo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
    expect(screen.getByTestId('starfield')).toBeInTheDocument();
  });

  it('the first Tab on Home lands on the primary action', async () => {
    renderApp();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Start recording' })).toHaveFocus();
  });

  it('the record button opens a new live conversation (consent is asked on the live screen)', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/live/new');
  });

  it('"Try a demo conversation" starts a transcript replay of the demo fixture', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Try a demo conversation' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/live/demo?fixture=demo-religion');
  });

  it('hamburger opens the sidebar ("Constellate") as a dialog', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const sidebar = screen.getByRole('dialog', { name: 'Constellate' });
    expect(within(sidebar).getByRole('link', { name: 'Brain' })).toHaveAttribute('href', '/brain');
  });

  it('/live/:id is the live screen (A6), which asks for consent before anything starts', async () => {
    renderApp({ route: '/live/new' });
    expect(await screen.findByRole('dialog', { name: 'Before we start' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Recording controls' })).toBeInTheDocument();
    expect(screen.queryByText(/Placeholder/)).not.toBeInTheDocument();
  });

  it('the demo route opens the live screen in transcript replay', async () => {
    renderApp({ route: '/live/demo?fixture=demo-religion' });
    expect(await screen.findByRole('dialog', { name: 'Play the demo conversation' })).toBeInTheDocument();
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

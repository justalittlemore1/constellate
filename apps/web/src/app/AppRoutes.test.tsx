import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { loadDemoGraph, loadDemoOps } from '../lib/fixtures';
import { AppRoutes } from './AppRoutes';

describe('app shell', () => {
  it('renders Home with a labelled microphone button', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a conversation' })).toBeInTheDocument();
  });
});

describe('mock-mode fixtures', () => {
  it('load and parse in the browser bundle', () => {
    expect(Object.keys(loadDemoGraph().nodes).length).toBeGreaterThan(10);
    expect(loadDemoOps().length).toBeGreaterThan(10);
  });
});

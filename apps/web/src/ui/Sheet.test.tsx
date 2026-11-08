import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PhoneFrame } from '../app/PhoneFrame';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Toggle } from './Toggle';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Details">
        <Button>First action</Button>
        <Button>Last action</Button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('is a labelled modal dialog that traps focus, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();
    await user.tab(); // wraps
    expect(close).toHaveFocus();
    await user.tab({ shift: true }); // wraps backwards
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe('Sheet open on the first render', () => {
  it('portals into the PhoneFrame overlay and takes focus', () => {
    render(
      <PhoneFrame>
        <Sheet open onClose={() => {}} title="Consent">
          <Button>Start</Button>
        </Sheet>
      </PhoneFrame>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Consent' });
    expect(document.getElementById('overlay-root')!.contains(dialog)).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});

describe('Toggle', () => {
  it('is a labelled switch reporting its state', async () => {
    function T() {
      const [on, setOn] = useState(false);
      return <Toggle label="Reduce motion" checked={on} onChange={setOn} />;
    }
    render(<T />);
    const sw = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});

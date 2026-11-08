import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { ConversationMap } from './ConversationMap';
import { OutlineView } from './OutlineView';
import { installFlowDomStubs } from './testing';

beforeAll(() => installFlowDomStubs());
const demo = loadDemoGraph();
const ordered = Object.values(demo.nodes).sort((a, b) => a.seq - b.seq);

describe('OutlineView', () => {
  it('lists every node in conversation order as a tree item with an accessible name', () => {
    render(<OutlineView state={demo} activeNodeId={null} onOpen={() => {}} />);
    const tree = screen.getByRole('tree', { name: /outline/i });
    const items = within(tree).getAllByRole('treeitem');
    expect(items).toHaveLength(ordered.length);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(ordered[i]!.label);
      expect(item).toHaveAttribute('aria-posinset', String(i + 1));
      expect(item).toHaveAttribute('aria-setsize', String(ordered.length));
    });
  });

  it('writes statuses and relationships out in words', () => {
    render(<OutlineView state={demo} activeNodeId={null} onOpen={() => {}} />);
    const back = ordered.filter((n) => n.label === 'Resurrection Accounts')[1]!;
    expect(screen.getByTestId(`outline-item-${back.id}`)).toHaveTextContent(
      'returns to Resurrection Accounts from 03:50',
    );
    const soccer = ordered.find((n) => n.label === 'Intramural Soccer')!;
    expect(screen.getByTestId(`outline-item-${soccer.id}`)).toHaveTextContent('mentioned for later, not picked up');
    const parked = ordered.find((n) => n.kind === 'parked')!;
    expect(screen.getByTestId(`outline-item-${parked.id}`)).toHaveTextContent('parked thought');
    const noted = demo.annotations[0]!;
    expect(screen.getByTestId(`outline-item-${noted.nodeId}`)).toHaveTextContent(`Note: ${noted.text}`);
  });

  it('indents by level and puts threads deepest', () => {
    render(<OutlineView state={demo} activeNodeId={null} onOpen={() => {}} />);
    const l1 = ordered.find((n) => n.kind === 'topic' && n.level === 1)!;
    const l2 = ordered.find((n) => n.kind === 'topic' && n.level === 2)!;
    const th = ordered.find((n) => n.kind === 'pending')!;
    expect(screen.getByTestId(`outline-item-${l1.id}`)).toHaveAttribute('aria-level', '1');
    expect(screen.getByTestId(`outline-item-${l2.id}`)).toHaveAttribute('aria-level', '2');
    expect(screen.getByTestId(`outline-item-${th.id}`)).toHaveAttribute('aria-level', '3');
  });

  it('marks the topic being discussed now', () => {
    render(<OutlineView state={demo} activeNodeId={ordered[2]!.id} onOpen={() => {}} />);
    const item = screen.getByTestId(`outline-item-${ordered[2]!.id}`);
    expect(item).toHaveAttribute('aria-current', 'step');
    expect(item).toHaveTextContent('being discussed now');
  });

  it('roving focus: one tab stop, arrows / Home / End move, Enter opens', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<OutlineView state={demo} activeNodeId={null} onOpen={onOpen} />);
    const items = screen.getAllByRole('treeitem');
    expect(items.filter((el) => el.tabIndex === 0)).toHaveLength(1);
    await user.tab();
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(items[2]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items[items.length - 1]).toHaveFocus();
    await user.keyboard('{Home}{Enter}');
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: ordered[0]!.id }));
  });
});

describe('Map ↔ Outline', () => {
  it('switches to the outline and opens the detail sheet from it', async () => {
    const user = userEvent.setup();
    render(<ConversationMap state={demo} flags={{ outlineToggle: true }} />);
    await user.click(screen.getByRole('button', { name: 'Show as outline' }));
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Broad' })).toBeNull();
    await user.click(screen.getByTestId(`outline-item-${ordered[1]!.id}`));
    expect(screen.getByRole('dialog', { name: ordered[1]!.label })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Show as map' }));
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByTestId('conversation-map')).toBeInTheDocument();
  });
});
